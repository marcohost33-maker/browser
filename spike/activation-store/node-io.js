// Node.js filesystem adapter for the activation store.
//
// The store only needs a small, explicit set of primitives. Keeping them behind this
// adapter lets the crash harness substitute a durability model or a fault injector
// without changing store code.
//
// Platform notes (libuv v1.x source, checked 2026-09-27):
// - POSIX: exclusive create uses O_CREAT|O_EXCL|O_NOFOLLOW; with O_CREAT|O_EXCL an
//   existing symbolic link is never followed.
// - macOS: FileHandle.sync() maps to F_FULLFSYNC, then F_BARRIERFSYNC, then fsync.
// - Windows: rename() is MoveFileExW(MOVEFILE_REPLACE_EXISTING) without POSIX
//   semantics, so replacing a file that another process holds open fails and must be
//   retried by the caller; sync() is FlushFileBuffers; directory handles cannot be
//   flushed, so syncDir() reports false instead of claiming durability.

import { constants, promises as fsp } from 'node:fs';
import path from 'node:path';

const NO_FOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
const CREATE_EXCLUSIVE = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NO_FOLLOW;
const READ_NO_FOLLOW = constants.O_RDONLY | NO_FOLLOW;
const WINDOWS_DIRECTORY_SYNC_UNSUPPORTED = new Set(['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EBADF']);

function ioError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function typeOf(stats) {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'dir';
  if (stats.isFile()) return 'file';
  return 'other';
}

export function createNodeIo({ platform = process.platform } = {}) {
  return {
    platform,
    join: path.join,
    resolve: path.resolve,
    dirname: path.dirname,

    async lstat(target) {
      try {
        const stats = await fsp.lstat(target);
        return { type: typeOf(stats), size: stats.size, mode: stats.mode };
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    },

    // Returns true when created and false when the name already exists (any type).
    async mkdir(target, mode) {
      try {
        await fsp.mkdir(target, { mode });
        return true;
      } catch (error) {
        if (error?.code === 'EEXIST') return false;
        throw error;
      }
    },

    async readdir(target) {
      return (await fsp.readdir(target)).sort();
    },

    // Reads a regular file without following a final symbolic link. Returns null when
    // the file does not exist and fails with EFBIG before reading more than maxBytes.
    async readFile(target, maxBytes) {
      let handle;
      try {
        handle = await fsp.open(target, READ_NO_FOLLOW);
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) throw ioError('EISDIR', `${target} is not a regular file`);
        if (stats.size > maxBytes) throw ioError('EFBIG', `${target} exceeds ${maxBytes} bytes`);
        const buffer = Buffer.alloc(stats.size + 1);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        // Reading one byte past the observed size detects a file that grew concurrently.
        if (offset > maxBytes) throw ioError('EFBIG', `${target} grew beyond ${maxBytes} bytes`);
        return buffer.subarray(0, offset);
      } finally {
        await handle.close();
      }
    },

    // Exclusive create: fails with EEXIST if any entry, including a symlink, exists.
    async createExclusive(target, mode) {
      const handle = await fsp.open(target, CREATE_EXCLUSIVE, mode);
      return {
        async write(bytes) {
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
            offset += bytesWritten;
          }
        },
        async sync() {
          await handle.sync();
        },
        async close() {
          await handle.close();
        },
      };
    },

    async rename(from, to) {
      await fsp.rename(from, to);
    },

    // Creates a new name for an existing file; never replaces. False on EEXIST.
    async link(existing, target) {
      try {
        await fsp.link(existing, target);
        return true;
      } catch (error) {
        if (error?.code === 'EEXIST') return false;
        throw error;
      }
    },

    async unlink(target) {
      await fsp.unlink(target);
    },

    // Flushes a directory's entries. Returns false where the platform cannot do it.
    async syncDir(target) {
      let handle;
      try {
        handle = await fsp.open(target, constants.O_RDONLY);
        await handle.sync();
        return true;
      } catch (error) {
        if (platform === 'win32' && WINDOWS_DIRECTORY_SYNC_UNSUPPORTED.has(error?.code)) return false;
        throw error;
      } finally {
        await handle?.close();
      }
    },
  };
}
