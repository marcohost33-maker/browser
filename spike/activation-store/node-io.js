// Node.js filesystem adapter for the activation store.
//
// The store only needs a small, explicit set of primitives. Keeping them behind this
// adapter lets the crash harness substitute a durability model or a fault injector
// without changing store code.
//
// Platform notes (libuv v1.x source, checked 2026-09-29):
// - POSIX: exclusive create uses O_CREAT|O_EXCL|O_NOFOLLOW; with O_CREAT|O_EXCL an
//   existing symbolic link is never followed.
// - macOS: FileHandle.sync() maps to F_FULLFSYNC, then F_BARRIERFSYNC, then fsync.
// - Windows: rename() is MoveFileExW(MOVEFILE_REPLACE_EXISTING) without
//   MOVEFILE_WRITE_THROUGH and without POSIX semantics, so replacing a file that
//   another process holds open fails and must be retried by the caller. sync() is
//   FlushFileBuffers, which needs a handle with write access, so syncFile() opens
//   read-write there. Directory handles cannot be flushed; syncDir() reports false
//   instead of claiming durability. unlink() clears the read-only attribute that a
//   0444 mode sets, so immutable objects stay collectable. There is no O_NOFOLLOW.

import { createHash } from 'node:crypto';
import { constants, promises as fsp } from 'node:fs';
import path from 'node:path';

const NO_FOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
const CREATE_EXCLUSIVE = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NO_FOLLOW;
const READ_NO_FOLLOW = constants.O_RDONLY | NO_FOLLOW;
const WINDOWS_DIRECTORY_SYNC_UNSUPPORTED = new Set(['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EBADF']);
const DIGEST_CHUNK_BYTES = 256 * 1024;

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

// Opens a regular file for reading without following a final symbolic link. Returns
// null when the file does not exist and fails with EFBIG when it is larger than
// maxBytes; the caller closes the handle.
async function openBounded(target, maxBytes, flags) {
  let handle;
  try {
    handle = await fsp.open(target, flags);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw ioError('EISDIR', `${target} is not a regular file`);
    if (stats.size > maxBytes) throw ioError('EFBIG', `${target} exceeds ${maxBytes} bytes`);
    return { handle, size: stats.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export function createNodeIo({ platform = process.platform } = {}) {
  const fileSyncFlags = platform === 'win32' ? constants.O_RDWR : READ_NO_FOLLOW;
  return {
    platform,
    join: path.join,
    resolve: path.resolve,
    dirname: path.dirname,
    // Numeric owner of this process on POSIX; null where the platform has no uid.
    currentUserId: typeof process.getuid === 'function' ? process.getuid() : null,

    async lstat(target) {
      try {
        const stats = await fsp.lstat(target);
        return { type: typeOf(stats), size: stats.size, mode: stats.mode, uid: stats.uid };
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
      const opened = await openBounded(target, maxBytes, READ_NO_FOLLOW);
      if (opened === null) return null;
      const { handle, size } = opened;
      try {
        const buffer = Buffer.alloc(size + 1);
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

    // Streams a regular file through SHA-256 in fixed chunks, so verifying a large
    // object never allocates it whole. Same contract as readFile for missing files,
    // links and the byte bound.
    async digestFile(target, maxBytes) {
      const opened = await openBounded(target, maxBytes, READ_NO_FOLLOW);
      if (opened === null) return null;
      const { handle } = opened;
      try {
        const hash = createHash('sha256');
        const chunk = Buffer.alloc(DIGEST_CHUNK_BYTES);
        let size = 0;
        for (;;) {
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, size);
          if (bytesRead === 0) break;
          size += bytesRead;
          if (size > maxBytes) throw ioError('EFBIG', `${target} grew beyond ${maxBytes} bytes`);
          hash.update(chunk.subarray(0, bytesRead));
        }
        return { digest: hash.digest('hex'), size };
      } finally {
        await handle.close();
      }
    },

    // One open descriptor over a regular file, for verify-then-serve: digest() and
    // chunks() both read through the same descriptor, so the bytes served are the
    // bytes verified even if the name is unlinked or replaced meanwhile. Same
    // contract as readFile for missing files, links and the byte bound.
    async openReadable(target, maxBytes) {
      const opened = await openBounded(target, maxBytes, READ_NO_FOLLOW);
      if (opened === null) return null;
      const { handle, size } = opened;
      let closed = false;
      const assertOpen = () => {
        if (closed) throw ioError('EBADF', `${target} is closed`);
      };
      const read = async function* read() {
        const chunk = Buffer.alloc(DIGEST_CHUNK_BYTES);
        let position = 0;
        for (;;) {
          assertOpen();
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
          if (bytesRead === 0) break;
          position += bytesRead;
          if (position > maxBytes) throw ioError('EFBIG', `${target} grew beyond ${maxBytes} bytes`);
          yield chunk.subarray(0, bytesRead);
        }
      };
      return {
        size,
        async digest() {
          const hash = createHash('sha256');
          let total = 0;
          for await (const part of read()) {
            total += part.length;
            hash.update(part);
          }
          return { digest: hash.digest('hex'), size: total };
        },
        // Each yielded chunk is the consumer's own copy.
        async *chunks() {
          for await (const part of read()) yield Buffer.from(part);
        },
        async close() {
          if (closed) return;
          closed = true;
          await handle.close();
        },
      };
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

    // Flushes an existing regular file under its current name (the second half of
    // PostgreSQL's durable_rename). Returns false when the file does not exist.
    async syncFile(target) {
      let handle;
      try {
        handle = await fsp.open(target, fileSyncFlags);
      } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) throw ioError('EISDIR', `${target} is not a regular file`);
        await handle.sync();
        return true;
      } finally {
        await handle.close();
      }
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
