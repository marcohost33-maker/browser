// Fault injection for the activation store io interface.
//
// `createCrashingIo` simulates a process that dies immediately before its N-th
// mutating filesystem call. After the crash every further call, including reads and
// the store's own cleanup in `finally` blocks, fails as well: a killed process runs
// no cleanup code, so none may change the observable state.
//
// `createLyingIo` builds the negative controls: it acknowledges fsync calls without
// performing them, which a sound crash matrix must detect.

export class SimulatedCrash extends Error {
  constructor(point) {
    super(`simulated crash before mutating operation ${point}`);
    this.name = 'SimulatedCrash';
    this.code = 'SIMULATED_CRASH';
    this.point = point;
  }
}

// `crashAt` counts mutating calls from 1; `crashWhen(kind, path)` crashes before the
// first mutating call it matches. Either trigger kills the simulated process.
export function createCrashingIo(io, { crashAt = Number.POSITIVE_INFINITY, crashWhen = () => false } = {}) {
  const trace = [];
  const openHandles = new Set();
  let crashed = false;
  let crashPoint = null;

  const alive = () => {
    if (crashed) throw new SimulatedCrash(crashPoint);
  };

  const die = async () => {
    crashed = true;
    crashPoint = trace.length + 1;
    // The operating system closes the descriptors of a dead process. Closing does not
    // change persisted state; it only prevents descriptor leaks in the harness.
    for (const handle of openHandles) {
      try {
        await handle.close();
      } catch {
        // ignored: the process is already dead
      }
    }
    openHandles.clear();
  };

  const mutate = async (kind, path, perform) => {
    alive();
    if (trace.length + 1 === crashAt || crashWhen(kind, path)) {
      await die();
      throw new SimulatedCrash(trace.length + 1);
    }
    trace.push({ kind, path });
    return perform();
  };

  const read = (fn) => async (...args) => {
    alive();
    return fn(...args);
  };

  const wrapped = {
    platform: io.platform,
    join: io.join,
    resolve: io.resolve,
    dirname: io.dirname,
    lstat: read(io.lstat),
    readdir: read(io.readdir),
    readFile: read(io.readFile),
    mkdir: (path, mode) => mutate('mkdir', path, () => io.mkdir(path, mode)),
    rename: (from, to) => mutate('rename', `${from} -> ${to}`, () => io.rename(from, to)),
    link: (from, to) => mutate('link', `${from} -> ${to}`, () => io.link(from, to)),
    unlink: (path) => mutate('unlink', path, () => io.unlink(path)),
    syncDir: (path) => mutate('syncDir', path, () => io.syncDir(path)),
    async createExclusive(path, mode) {
      const handle = await mutate('create', path, () => io.createExclusive(path, mode));
      openHandles.add(handle);
      return {
        write: (bytes) => mutate('write', path, () => handle.write(bytes)),
        sync: () => mutate('sync', path, () => handle.sync()),
        async close() {
          alive();
          openHandles.delete(handle);
          return handle.close();
        },
      };
    },
  };

  return {
    io: wrapped,
    get trace() {
      return trace;
    },
    get crashed() {
      return crashed;
    },
  };
}

export function createLyingIo(io, { skipFileSync = false, skipDirectorySync = () => false } = {}) {
  return {
    ...io,
    async syncDir(path) {
      if (skipDirectorySync(path)) return true;
      return io.syncDir(path);
    },
    async createExclusive(path, mode) {
      const handle = await io.createExclusive(path, mode);
      if (!skipFileSync) return handle;
      return {
        write: (bytes) => handle.write(bytes),
        async sync() {},
        close: () => handle.close(),
      };
    },
  };
}
