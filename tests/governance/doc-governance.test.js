import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectGovernanceIssues } from '../../scripts/check-doc-governance.js';

async function repositoryWith(adrs) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-doc-governance-'));
  const directory = path.join(root, 'docs', 'adr');
  await mkdir(directory, { recursive: true });
  await Promise.all(
    Object.entries(adrs).map(([filename, content]) =>
      writeFile(path.join(directory, filename), content, 'utf8'),
    ),
  );
  return root;
}

test('accepts a canonical ADR and an explicitly suffixed sub-ADR', async () => {
  const root = await repositoryWith({
    'ADR-007-package.md': '# ADR-007 — Package\n\nSee [hardening](ADR-007a-hardening.md).\n',
    'ADR-007a-hardening.md': '# ADR-007a — Hardening\n',
  });

  assert.deepEqual(await collectGovernanceIssues(root), []);
});

test('rejects duplicate ADR identifiers', async () => {
  const root = await repositoryWith({
    'ADR-007-package.md': '# ADR-007 — Package\n',
    'ADR-007-other.md': '# ADR-007 — Other\n',
  });

  const issues = await collectGovernanceIssues(root);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /ADR-007 is duplicated/);
});

test('rejects a filename and heading identifier mismatch', async () => {
  const root = await repositoryWith({
    'ADR-008-runtime.md': '# ADR-009 — Runtime\n',
  });

  const issues = await collectGovernanceIssues(root);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /does not match heading/);
});

test('rejects broken local ADR links', async () => {
  const root = await repositoryWith({
    'ADR-007-package.md': '# ADR-007 — Package\n\nSee [missing](ADR-007a-missing.md).\n',
  });

  const issues = await collectGovernanceIssues(root);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /link target does not exist/);
});
