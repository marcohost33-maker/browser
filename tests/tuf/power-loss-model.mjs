// Power-loss states of one recorded refresh (BR64-04, the part a SIGKILL cannot show).
//
// A process kill keeps the kernel page cache, so it only tests the ORDER of the
// write protocol. What survives a power cut is decided by the persistence rules of
// the file system. This module follows the abstract persistence model of ALICE
// (Pillai et al., "All File Systems Are Not Created Equal", OSDI 2014): record the
// exact operations of one run, then construct every on-disk state a crash after
// each prefix of those operations may leave, under explicit rules:
//
//   P1 file data is durable only after fsync of that file (an inode never synced
//      has durable length 0); data written but not synced may or may not survive;
//   P2 a directory operation (create, rename, unlink) is atomic, but durable only
//      after fsync of its directory; until then ANY subset of the pending
//      operations may survive, applied in their original order (reordering);
//   P3 an fsync of the directory makes every operation before it durable.
//
// This is deliberately stricter than ext4 data=ordered (which, for instance,
// orders data before a replacing rename): a protocol that is safe here does not rely
// on such file-system-specific guarantees. Not modelled: torn writes inside one
// write call, metadata other than directory entries (modes, times), devices that lie
// about flushes, and directories other than the metadata directory itself.
//
// Input: the files of the directory before the run (all durable) and the operation
// record written by process-kill-worker.mjs (`opsLog`). Output: deduplicated states.
import { createHash } from 'node:crypto';

const EMPTY = Buffer.alloc(0);
const MAX_VARIANTS_PER_PREFIX = 256;

function hashState(files) {
  const hash = createHash('sha256');
  for (const name of [...files.keys()].sort()) {
    hash.update(name).update('\0').update(files.get(name)).update('\0');
  }
  return hash.digest('hex');
}

/** Every subset of `items`, smallest first (bounded by the caller's cap). */
function* subsets(items) {
  const total = 2 ** items.length;
  for (let mask = 0; mask < total; mask += 1) {
    yield items.filter((_, index) => (mask & (2 ** index)) !== 0);
  }
}

function applyDirectoryOp(entries, op) {
  if (op.kind === 'bind') entries.set(op.name, op.inode);
  else if (op.kind === 'rename') {
    if (!entries.has(op.from)) return; // its create was not among the survivors
    entries.set(op.to, entries.get(op.from));
    entries.delete(op.from);
  } else if (op.kind === 'unlink') entries.delete(op.name);
}

/**
 * @param {Map<string, Buffer>} initialFiles  directory content before the run
 * @param {Array<object>} ops                 operation record of the run
 * @returns {{ states: Array<{ prefix: number, files: Map<string, Buffer>, hash: string }>,
 *            finalStates: Array<object>, opCount: number }}
 */
export function powerLossStates(initialFiles, ops) {
  const inodes = [];
  const durableEntries = new Map();
  for (const [name, content] of initialFiles) {
    inodes.push({ current: content, durable: content });
    durableEntries.set(name, inodes.length - 1);
  }
  let currentEntries = new Map(durableEntries);
  let pending = []; // directory operations since the last directory fsync

  const byHash = new Map();
  const finalStates = [];

  const crashStatesAt = (prefix) => {
    const variants = [];
    for (const surviving of subsets(pending)) {
      const entries = new Map(durableEntries);
      for (const op of surviving) applyDirectoryOp(entries, op);
      const reachable = [...new Set(entries.values())];
      const unsynced = reachable.filter((id) => !inodes[id].current.equals(inodes[id].durable));
      for (const early of subsets(unsynced)) {
        const files = new Map();
        for (const [name, id] of entries) {
          files.set(name, early.includes(id) ? inodes[id].current : inodes[id].durable);
        }
        variants.push(files);
        if (variants.length > MAX_VARIANTS_PER_PREFIX) {
          throw new Error(`more than ${MAX_VARIANTS_PER_PREFIX} crash states after op ${prefix}`);
        }
      }
    }
    for (const files of variants) {
      const hash = hashState(files);
      if (!byHash.has(hash)) byHash.set(hash, { prefix, files, hash });
      if (prefix === ops.length) finalStates.push({ prefix, files, hash });
    }
  };

  crashStatesAt(0);
  ops.forEach((op, index) => {
    if (op.op === 'open-write') {
      const existing = currentEntries.get(op.name);
      if (!op.exclusive && existing !== undefined) {
        inodes[existing].current = EMPTY; // truncate in place, same inode
      } else {
        inodes.push({ current: EMPTY, durable: EMPTY });
        const inode = inodes.length - 1;
        currentEntries.set(op.name, inode);
        pending.push({ kind: 'bind', name: op.name, inode });
      }
    } else if (op.op === 'write') {
      inodes[currentEntries.get(op.name)].current = Buffer.from(op.data, 'base64');
    } else if (op.op === 'fsync') {
      const inode = inodes[currentEntries.get(op.name)];
      inode.durable = inode.current;
    } else if (op.op === 'rename') {
      currentEntries.set(op.to, currentEntries.get(op.from));
      currentEntries.delete(op.from);
      pending.push({ kind: 'rename', from: op.from, to: op.to });
    } else if (op.op === 'unlink') {
      currentEntries.delete(op.name);
      pending.push({ kind: 'unlink', name: op.name });
    } else if (op.op === 'fsync-dir') {
      if (op.name === '.') {
        // P3: everything before it is durable, entries exactly as they are now.
        durableEntries.clear();
        for (const [name, id] of currentEntries) durableEntries.set(name, id);
        pending = [];
      }
      // A sync of an ancestor (directory creation) does not touch these entries.
    } else if (op.op === 'mkdir') {
      // The metadata directory itself exists before a refresh; nothing to model.
    } else {
      throw new Error(`unknown operation ${op.op}`);
    }
    crashStatesAt(index + 1);
  });
  currentEntries = null;

  return { states: [...byHash.values()], finalStates, opCount: ops.length };
}
