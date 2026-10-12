// The docs-ci link-check gate must be able to fail on a broken fragment. The
// judging logic is tested here on every run; the real binary runs when
// LYCHEE_BIN points at it (docs-ci link-check runs scripts/check-lychee-fragments.mjs
// with the pinned binary directly, so CI never depends on this skip).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CONTROLS, evaluateControl, runControls } from '../../scripts/check-lychee-fragments.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const control = (name) => CONTROLS.find((entry) => entry.name.startsWith(name));

test('every control fixture exists and only the target is a tracked-style .md', () => {
  for (const entry of CONTROLS) {
    assert.ok(existsSync(path.join(repositoryRoot, entry.file)), entry.file);
    assert.ok(entry.file.endsWith('.markdown'), `${entry.file} would enter the repository-wide check`);
  }
  const target = readFileSync(path.join(repositoryRoot, 'tests/fixtures/lychee-fragments/target.md'), 'utf8');
  assert.match(target, /^## Known heading$/m);
  assert.doesNotMatch(target, /no-such-heading/i);
});

test('a negative control fails when lychee accepts the broken link', () => {
  assert.match(
    evaluateControl(control('unknown fragment'), { status: 0, output: 'OK' }),
    /accepted the broken link/,
  );
});

test('a negative control fails when lychee exits non-zero without naming the fragment', () => {
  // A crash or usage error is not a detected broken fragment.
  assert.match(
    evaluateControl(control('unknown fragment'), { status: 2, output: 'error: unexpected argument' }),
    /without reporting target\.md#no-such-heading/,
  );
  assert.match(
    evaluateControl(control('missing file'), { status: 2, output: 'no-such-file.md (at 3:1) | Cannot find fragment' }),
    /without reporting/,
  );
});

test('the positive control fails when lychee rejects the valid fragment', () => {
  assert.match(evaluateControl(control('valid fragment'), { status: 2, output: 'x' }), /exited 2/);
  assert.equal(evaluateControl(control('valid fragment'), { status: 0, output: 'OK' }), null);
});

test('the real lychee binary passes all fragment controls', { skip: !process.env.LYCHEE_BIN && 'set LYCHEE_BIN to the pinned lychee binary' }, () => {
  assert.deepEqual(runControls(process.env.LYCHEE_BIN), []);
});
