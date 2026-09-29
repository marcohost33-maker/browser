// In-memory filesystem with explicit crash-durability semantics, used to enumerate the
// states a store can observe after a process crash or a power loss.
//
// Every mutation is logged against a durable checkpoint. From the log the model can
// reconstruct the post-crash states permitted by two persistence models, in the
// spirit of ALICE (Pillai et al., OSDI 2014) and Ferrite (Bornholt et al., ASPLOS 2016):
//
// - posix-strict: each directory persists its entry changes independently and in
//   order; only fsync(directory) makes them durable. File contents persist only
//   through fsync(file); an unsynced file is observed empty (the classic zero-length
//   file after a power loss). Cross-directory renames persist per side.
// - ordered-prefix: metadata operations persist as one global prefix in program order
//   (an ordered metadata journal); fsync(directory), when available, is a barrier.
//   Contents follow the same fsync rule. With `directorySync: false` the model stands
//   for a platform that cannot flush directory handles and relies on journal order.
//   With `fileSyncBarrier: true` every file fsync is also a journal barrier: the
//   write-ahead-log hypothesis for NTFS, where flushing a file forces the log up to
//   that file's last change and the log is sequential. It is a hypothesis until a
//   Windows power-loss run exists; the matrix names it as such.
//
// A process crash keeps every completed operation visible but not yet durable.

import { createHash } from 'node:crypto';

export class ModelFsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModelFsError';
    this.code = code;
  }
}

function fsError(code, path) {
  return new ModelFsError(code, `${code}: ${path}`);
}

function components(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw fsError('EINVAL', String(path));
  return path.split('/').filter((part) => part.length > 0);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Deterministic PRNG for reproducible state sampling.
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const METADATA_KINDS = new Set(['create', 'mkdir', 'link', 'unlink', 'rename', 'symlink']);

export class ModelFs {
  constructor({ directorySync = true, fileSyncBarrier = false } = {}) {
    this.directorySync = directorySync;
    this.fileSyncBarrier = fileSyncBarrier;
    this.nextInode = 1;
    this.types = new Map();
    this.entries = new Map();
    this.data = new Map();
    this.targets = new Map();
    this.rootId = this._allocate('dir');
    this.log = [];
    this.checkpoint();
  }

  _allocate(type) {
    const id = this.nextInode;
    this.nextInode += 1;
    this.types.set(id, type);
    if (type === 'dir') this.entries.set(id, new Map());
    if (type === 'file') this.data.set(id, Buffer.alloc(0));
    return id;
  }

  // Declares the current state durable (setup finished, or a machine rebooted).
  checkpoint() {
    this.base = {
      entries: new Map([...this.entries].map(([id, map]) => [id, new Map(map)])),
      data: new Map([...this.data].map(([id, bytes]) => [id, Buffer.from(bytes)])),
    };
    this.log = [];
  }

  clone() {
    const copy = Object.create(ModelFs.prototype);
    copy.directorySync = this.directorySync;
    copy.fileSyncBarrier = this.fileSyncBarrier;
    copy.nextInode = this.nextInode;
    copy.rootId = this.rootId;
    copy.types = new Map(this.types);
    copy.targets = new Map(this.targets);
    copy.entries = new Map([...this.entries].map(([id, map]) => [id, new Map(map)]));
    copy.data = new Map([...this.data].map(([id, bytes]) => [id, Buffer.from(bytes)]));
    copy.base = this.base;
    copy.log = [...this.log];
    return copy;
  }

  // ------------------------------------------------------------------ resolution

  _lookup(path) {
    let current = this.rootId;
    const parts = components(path);
    for (let index = 0; index < parts.length; index += 1) {
      const type = this.types.get(current);
      if (type === 'symlink') throw fsError('ELOOP', path);
      if (type !== 'dir') throw fsError('ENOTDIR', path);
      const next = this.entries.get(current).get(parts[index]);
      if (next === undefined) return { parent: current, name: parts[index], id: undefined, missingParent: index < parts.length - 1 };
      if (index === parts.length - 1) return { parent: current, name: parts[index], id: next, missingParent: false };
      current = next;
    }
    return { parent: null, name: '', id: this.rootId, missingParent: false };
  }

  _parentFor(path) {
    const found = this._lookup(path);
    if (found.missingParent) throw fsError('ENOENT', path);
    if (found.parent === null) throw fsError('EEXIST', path);
    return found;
  }

  // ------------------------------------------------------------- test helpers

  writeFileNow(path, bytes) {
    const found = this._parentFor(path);
    if (found.id !== undefined) throw fsError('EEXIST', path);
    const id = this._allocate('file');
    this.data.set(id, Buffer.from(bytes));
    this.entries.get(found.parent).set(found.name, id);
    this.log.push({ kind: 'create', dir: found.parent, name: found.name, inode: id });
    this.log.push({ kind: 'write', inode: id, data: Buffer.from(bytes) });
  }

  symlinkNow(target, path) {
    const found = this._parentFor(path);
    if (found.id !== undefined) throw fsError('EEXIST', path);
    const id = this._allocate('symlink');
    this.targets.set(id, target);
    this.entries.get(found.parent).set(found.name, id);
    this.log.push({ kind: 'symlink', dir: found.parent, name: found.name, inode: id });
  }

  overwriteNow(path, bytes) {
    const found = this._lookup(path);
    if (found.id === undefined || this.types.get(found.id) !== 'file') throw fsError('ENOENT', path);
    this.data.set(found.id, Buffer.from(bytes));
    this.log.push({ kind: 'write', inode: found.id, data: Buffer.from(bytes) });
  }

  // Snapshot of the visible tree: path -> type and content hash.
  listing() {
    const out = [];
    const walk = (id, prefix) => {
      for (const name of [...this.entries.get(id).keys()].sort()) {
        const child = this.entries.get(id).get(name);
        const path = `${prefix}/${name}`;
        const type = this.types.get(child);
        if (type === 'dir') {
          out.push(`${path}/`);
          walk(child, path);
        } else if (type === 'file') {
          out.push(`${path} ${sha256(this.data.get(child))}`);
        } else {
          out.push(`${path} -> ${this.targets.get(child)}`);
        }
      }
    };
    walk(this.rootId, '');
    return out;
  }

  fingerprint() {
    return sha256(this.listing().join('\n'));
  }

  // ------------------------------------------------------------------- io adapter

  io() {
    const model = this;
    const readFile = async (path, maxBytes) => {
      let found;
      try {
        found = model._lookup(path);
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
      if (found.id === undefined) return null;
      const type = model.types.get(found.id);
      if (type === 'symlink') throw fsError('ELOOP', path);
      if (type !== 'file') throw fsError('EISDIR', path);
      const bytes = model.data.get(found.id);
      if (bytes.length > maxBytes) throw fsError('EFBIG', path);
      return Buffer.from(bytes);
    };
    return {
      platform: 'model',
      currentUserId: null,
      join: (...parts) => `/${parts.flatMap((part) => part.split('/')).filter((part) => part.length > 0).join('/')}`,
      resolve: (path) => {
        components(path);
        return path;
      },
      dirname: (path) => {
        const parts = components(path);
        return `/${parts.slice(0, -1).join('/')}`;
      },

      async lstat(path) {
        let found;
        try {
          found = model._lookup(path);
        } catch (error) {
          if (error.code === 'ENOENT') return null;
          throw error;
        }
        if (found.id === undefined) return null;
        const type = model.types.get(found.id);
        return { type, size: type === 'file' ? model.data.get(found.id).length : 0, mode: undefined, uid: undefined };
      },

      async mkdir(path) {
        const found = model._parentFor(path);
        if (model.types.get(found.parent) !== 'dir') throw fsError('ENOTDIR', path);
        if (found.id !== undefined) return false;
        const id = model._allocate('dir');
        model.entries.get(found.parent).set(found.name, id);
        model.log.push({ kind: 'mkdir', dir: found.parent, name: found.name, inode: id });
        return true;
      },

      async readdir(path) {
        const found = model._lookup(path);
        if (found.id === undefined) throw fsError('ENOENT', path);
        if (model.types.get(found.id) !== 'dir') throw fsError('ENOTDIR', path);
        return [...model.entries.get(found.id).keys()].sort();
      },

      readFile,

      async digestFile(path, maxBytes) {
        const bytes = await readFile(path, maxBytes);
        return bytes === null ? null : { digest: sha256(bytes), size: bytes.length };
      },

      // Flushes an existing file under its current name; false when it is missing.
      async syncFile(path) {
        let found;
        try {
          found = model._lookup(path);
        } catch (error) {
          if (error.code === 'ENOENT') return false;
          throw error;
        }
        if (found.id === undefined) return false;
        const type = model.types.get(found.id);
        if (type === 'symlink') throw fsError('ELOOP', path);
        if (type !== 'file') throw fsError('EISDIR', path);
        model.log.push({ kind: 'fsync', inode: found.id, data: Buffer.from(model.data.get(found.id)) });
        return true;
      },

      async createExclusive(path) {
        const found = model._parentFor(path);
        if (found.id !== undefined) throw fsError('EEXIST', path);
        const id = model._allocate('file');
        model.entries.get(found.parent).set(found.name, id);
        model.log.push({ kind: 'create', dir: found.parent, name: found.name, inode: id });
        let closed = false;
        const assertOpen = () => {
          if (closed) throw fsError('EBADF', path);
        };
        return {
          async write(bytes) {
            assertOpen();
            model.data.set(id, Buffer.concat([model.data.get(id), Buffer.from(bytes)]));
            model.log.push({ kind: 'write', inode: id, data: Buffer.from(model.data.get(id)) });
          },
          async sync() {
            assertOpen();
            model.log.push({ kind: 'fsync', inode: id, data: Buffer.from(model.data.get(id)) });
          },
          async close() {
            closed = true;
          },
        };
      },

      async rename(from, to) {
        const source = model._lookup(from);
        if (source.id === undefined) throw fsError('ENOENT', from);
        const target = model._parentFor(to);
        if (target.id !== undefined && model.types.get(target.id) === 'dir') throw fsError('EISDIR', to);
        if (source.parent === target.parent && source.name === target.name) return;
        model.entries.get(source.parent).delete(source.name);
        model.entries.get(target.parent).set(target.name, source.id);
        model.log.push({
          kind: 'rename',
          fromDir: source.parent,
          fromName: source.name,
          toDir: target.parent,
          toName: target.name,
          inode: source.id,
        });
      },

      async link(existing, path) {
        const source = model._lookup(existing);
        if (source.id === undefined) throw fsError('ENOENT', existing);
        const target = model._parentFor(path);
        if (target.id !== undefined) return false;
        model.entries.get(target.parent).set(target.name, source.id);
        model.log.push({ kind: 'link', dir: target.parent, name: target.name, inode: source.id });
        return true;
      },

      async unlink(path) {
        const found = model._lookup(path);
        if (found.id === undefined) throw fsError('ENOENT', path);
        if (model.types.get(found.id) === 'dir') throw fsError('EISDIR', path);
        model.entries.get(found.parent).delete(found.name);
        model.log.push({ kind: 'unlink', dir: found.parent, name: found.name, inode: found.id });
      },

      async syncDir(path) {
        if (!model.directorySync) return false;
        const found = model._lookup(path);
        if (found.id === undefined) throw fsError('ENOENT', path);
        if (model.types.get(found.id) !== 'dir') throw fsError('ENOTDIR', path);
        model.log.push({ kind: 'dirsync', dir: found.id });
        return true;
      },
    };
  }

  // --------------------------------------------------------- crash reconstruction

  // Contents that survive a power loss: the data captured by the last fsync, else the
  // checkpointed data, else empty.
  _durableData() {
    const durable = new Map(this.base.data);
    for (const entry of this.log) {
      if (entry.kind === 'fsync') durable.set(entry.inode, entry.data);
    }
    return durable;
  }

  // Per-directory ordered effects of every metadata operation, plus how many effects of
  // each directory were made durable by its last fsync.
  _directoryEffects() {
    const effects = new Map();
    const mandatory = new Map();
    const push = (dir, effect) => {
      if (!effects.has(dir)) effects.set(dir, []);
      effects.get(dir).push(effect);
    };
    for (const entry of this.log) {
      switch (entry.kind) {
        case 'create':
        case 'mkdir':
        case 'link':
        case 'symlink':
          push(entry.dir, { set: [[entry.name, entry.inode]], remove: [] });
          break;
        case 'unlink':
          push(entry.dir, { set: [], remove: [entry.name] });
          break;
        case 'rename':
          if (entry.fromDir === entry.toDir) {
            push(entry.toDir, { set: [[entry.toName, entry.inode]], remove: [entry.fromName] });
          } else {
            push(entry.fromDir, { set: [], remove: [entry.fromName] });
            push(entry.toDir, { set: [[entry.toName, entry.inode]], remove: [] });
          }
          break;
        case 'dirsync':
          mandatory.set(entry.dir, effects.get(entry.dir)?.length ?? 0);
          break;
        default:
          break;
      }
    }
    return { effects, mandatory };
  }

  _materialize(entries, data) {
    const next = Object.create(ModelFs.prototype);
    next.directorySync = this.directorySync;
    next.fileSyncBarrier = this.fileSyncBarrier;
    next.nextInode = this.nextInode;
    next.rootId = this.rootId;
    next.types = new Map(this.types);
    next.targets = new Map(this.targets);
    next.entries = new Map();
    next.data = new Map();
    const visit = (id) => {
      if (next.entries.has(id)) return;
      const map = new Map(entries.get(id) ?? []);
      next.entries.set(id, map);
      for (const child of map.values()) {
        const type = this.types.get(child);
        if (type === 'dir') visit(child);
        else if (type === 'file') next.data.set(child, Buffer.from(data.get(child) ?? Buffer.alloc(0)));
      }
    };
    visit(this.rootId);
    next.checkpoint();
    return next;
  }

  // posix-strict: `choice(dir, pendingCount)` returns how many pending effects of that
  // directory survive (0..pendingCount). Returns a rebooted, fully durable machine.
  posixStrictState(choice) {
    const { effects, mandatory } = this._directoryEffects();
    const entries = new Map([...this.base.entries].map(([id, map]) => [id, new Map(map)]));
    for (const [dir, list] of effects) {
      const fixed = mandatory.get(dir) ?? 0;
      const pending = list.length - fixed;
      const keep = fixed + Math.max(0, Math.min(pending, choice(dir, pending)));
      if (!entries.has(dir)) entries.set(dir, new Map());
      const map = entries.get(dir);
      for (const effect of list.slice(0, keep)) {
        for (const name of effect.remove) map.delete(name);
        for (const [name, inode] of effect.set) map.set(name, inode);
      }
    }
    return this._materialize(entries, this._durableData());
  }

  pendingDirectories() {
    const { effects, mandatory } = this._directoryEffects();
    const pending = new Map();
    for (const [dir, list] of effects) {
      const count = list.length - (mandatory.get(dir) ?? 0);
      if (count > 0) pending.set(dir, count);
    }
    return pending;
  }

  // Extremes, single-directory flips, per-directory partial prefixes and seeded samples.
  *posixStrictStates({ samples = 16, seed = 1 } = {}) {
    const pending = this.pendingDirectories();
    const dirs = [...pending.keys()].sort((left, right) => left - right);
    yield this.posixStrictState(() => 0);
    yield this.posixStrictState((dir, count) => count);
    for (const flipped of dirs) {
      yield this.posixStrictState((dir, count) => (dir === flipped ? count : 0));
      yield this.posixStrictState((dir, count) => (dir === flipped ? 0 : count));
      for (let keep = 1; keep < pending.get(flipped); keep += 1) {
        yield this.posixStrictState((dir, count) => (dir === flipped ? keep : count));
        yield this.posixStrictState((dir) => (dir === flipped ? keep : 0));
      }
    }
    const random = mulberry32(seed);
    for (let sample = 0; sample < samples; sample += 1) {
      const picks = new Map(dirs.map((dir) => [dir, Math.floor(random() * (pending.get(dir) + 1))]));
      yield this.posixStrictState((dir) => picks.get(dir) ?? 0);
    }
  }

  // ordered-prefix: the first `count` metadata operations after the last barrier. A
  // directory sync is always a barrier; a file sync only under `fileSyncBarrier`.
  *orderedPrefixStates() {
    const metadata = [];
    let barrier = 0;
    for (const entry of this.log) {
      if (METADATA_KINDS.has(entry.kind)) metadata.push(entry);
      else if (entry.kind === 'dirsync' || (entry.kind === 'fsync' && this.fileSyncBarrier)) barrier = metadata.length;
    }
    const durableData = this._durableData();
    for (let count = barrier; count <= metadata.length; count += 1) {
      const entries = new Map([...this.base.entries].map(([id, map]) => [id, new Map(map)]));
      const at = (dir) => {
        if (!entries.has(dir)) entries.set(dir, new Map());
        return entries.get(dir);
      };
      for (const entry of metadata.slice(0, count)) {
        if (entry.kind === 'unlink') at(entry.dir).delete(entry.name);
        else if (entry.kind === 'rename') {
          at(entry.fromDir).delete(entry.fromName);
          at(entry.toDir).set(entry.toName, entry.inode);
        } else at(entry.dir).set(entry.name, entry.inode);
      }
      yield this._materialize(entries, durableData);
    }
  }

  // A process crash: everything completed is visible; nothing new is durable.
  processCrashState() {
    return this.clone();
  }
}
