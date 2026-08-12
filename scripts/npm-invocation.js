// Resolve how to spawn npm from a Node script, portably and without a shell.
//
// On Windows the npm entrypoint is `npm.cmd`. A bare `spawnSync('npm', …)`
// fails there with ENOENT, and since the CVE-2024-27980 hardening Node also
// refuses to spawn `.cmd`/`.bat` files unless `shell: true` is set. Enabling a
// shell would route our arguments through a command interpreter for no benefit,
// so instead we run npm's own JS entrypoint with the Node binary that is
// already executing this script.
//
// This matters beyond convenience: without it the local gates (`toolchain:check`,
// `audit:ci`) could not run at all on the Windows dev machine, so the LOCAL-FIRST
// workflow silently degraded to "CI is the only place this is ever checked".
//
// No third-party dependencies (matches the repo's zero-runtime-dependency stance).

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @param {string[]} args arguments to pass to npm (e.g. ['--version'])
 * @returns {[string, string[]]} a [command, args] pair safe for spawn without a shell
 */
export function npmInvocation(args = []) {
  // Set by npm when this script runs as an npm lifecycle script.
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && fromEnv.endsWith('.js') && existsSync(fromEnv)) {
    return [process.execPath, [fromEnv, ...args]];
  }
  // Direct `node scripts/…` call: npm ships next to the Node binary.
  const sibling = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(sibling)) {
    return [process.execPath, [sibling, ...args]];
  }
  // POSIX fallback: `npm` is a real executable on PATH and spawns without a shell.
  return ['npm', args];
}
