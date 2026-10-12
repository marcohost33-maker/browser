#!/usr/bin/env node
// check-lychee-fragments — positive and negative controls for the required
// docs-ci link-check, run with the SAME pinned lychee binary, the SAME
// lychee.toml and the SAME `--offline` flag as the repository-wide check.
//
// Without them, removing `include_fragments` from lychee.toml (or a lychee that
// stops resolving fragments offline) would leave every gate green: the tracked
// documentation holds few or no repository-relative links with a `#fragment`.
//
// The control sources use the `.markdown` extension so the repository-wide
// `git ls-files '*.md'` check never sees the deliberately broken links; lychee
// parses `.markdown` as Markdown. The link target is a tracked, clean `.md`.
//
// A negative control counts only if lychee fails AND names the broken link and
// the kind of failure; an exit code alone could be a crash or a usage error.
//
// Usage: node scripts/check-lychee-fragments.mjs <path-to-lychee-binary>
// Exit 0 all controls behave, 1 a control misbehaves, 2 usage error.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = 'tests/fixtures/lychee-fragments';

export const CONTROLS = Object.freeze([
  {
    name: 'valid fragment is accepted',
    file: `${FIXTURES}/valid-fragment.markdown`,
    expect: 'pass',
  },
  {
    name: 'unknown fragment of an existing file is reported',
    file: `${FIXTURES}/unknown-fragment.markdown`,
    expect: 'fail',
    mustName: 'target.md#no-such-heading',
    reason: /fragment/i,
  },
  {
    name: 'missing file is reported',
    file: `${FIXTURES}/missing-file.markdown`,
    expect: 'fail',
    mustName: 'no-such-file.md',
    reason: /not found/i,
  },
]);

/** Judges one lychee run against its control. Returns null or a failure text. */
export function evaluateControl(control, { status, output }) {
  if (status === null) return `${control.name}: lychee did not exit (signal or spawn failure)`;
  if (control.expect === 'pass') {
    return status === 0 ? null : `${control.name}: lychee exited ${status}\n${output}`;
  }
  if (status === 0) return `${control.name}: lychee accepted the broken link\n${output}`;
  if (!output.includes(control.mustName) || !control.reason.test(output)) {
    return `${control.name}: lychee exited ${status} without reporting ${control.mustName} (${control.reason})\n${output}`;
  }
  return null;
}

export function runControls(lycheeBin, { root = REPO } = {}) {
  const config = readFileSync(path.join(root, 'lychee.toml'), 'utf8');
  const failures = [];
  if (!/^include_fragments\s*=\s*"full"\s*$/m.test(config)) {
    failures.push('lychee.toml no longer sets include_fragments = "full"');
  }
  for (const control of CONTROLS) {
    const run = spawnSync(lycheeBin, ['--config', 'lychee.toml', '--offline', control.file], {
      cwd: root,
      encoding: 'utf8',
    });
    if (run.error) {
      failures.push(`${control.name}: cannot run ${lycheeBin}: ${run.error.message}`);
      continue;
    }
    const failure = evaluateControl(control, {
      status: run.status,
      output: `${run.stdout}\n${run.stderr}`.replaceAll('\\', '/'),
    });
    if (failure) failures.push(failure);
  }
  return failures;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const lycheeBin = process.argv[2];
  if (!lycheeBin || process.argv.length > 3) {
    process.stderr.write('usage: node scripts/check-lychee-fragments.mjs <path-to-lychee-binary>\n');
    process.exitCode = 2;
  } else {
    const failures = runControls(lycheeBin);
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
    process.stdout.write(`lychee fragment controls: ${CONTROLS.length} controls, ${failures.length} failure(s)\n`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  }
}
