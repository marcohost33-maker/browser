// Issue #11 (M1B/M1D), ASI01 half: prompt-injection E2E — HONEST GAP, not a
// green test.
//
// The acceptance criterion is: "malicious MCP tool-result content must not
// execute as instruction; human-review boundary holds." Testing that
// requires an actual MCP client that receives tool-result content AND a
// renderer that either does or does not treat it as instructions.
//
// Neither exists yet. Evidence (verified when this file was written; the
// precondition-check test below re-verifies it on every run):
//   - src/ contains exactly security/csp.js, security/header-values.js,
//     security/serialize-cli.js — a header/CSP validator, nothing that
//     receives, parses or renders MCP content.
//   - Issue #11's own body: "No runtime code yet -> no exfil/injection E2E.
//     Once the MCP client runtime lands: ..." — this half is explicitly
//     gated on work that has not landed.
//   - contracts/MCP_CONSUMER_PROFILE.md / docs/security/THREAT_MODEL.md
//     describe the INTENDED control ("all MCP result content is untrusted
//     data, human-review-only, never executed as instructions") — a design
//     commitment in prose, not shipped code.
//
// Per the hard rule "no test that goes green because it checks nothing": a
// test asserting behaviour of code that does not exist would have to invent
// a fake renderer and grade it against our own expectations — a
// self-fulfilling test, not a security proof. The honest response is a
// documented, explicit SKIP with the reason on record, not a fabricated
// pass.
//
// Re-run the precondition check before reusing/removing this skip. If MCP
// client / result-rendering code has landed since, this file must be
// rewritten against the REAL renderer — not left skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');

function listSrcFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSrcFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

test('precondition check: no MCP client / result-content renderer exists in src/ yet', () => {
  const files = listSrcFilesRecursive(SRC_DIR).map((f) => path.relative(SRC_DIR, f));
  const mcpRelated = files.filter((f) => /mcp|result.?content|renderer|tool.?result/i.test(f));
  assert.deepEqual(
    mcpRelated,
    [],
    `expected NO MCP-client/result-renderer files in src/ (found: ${mcpRelated.join(', ')}) — ` +
      'if this fails, the precondition for the skip below no longer holds: replace the skip ' +
      'below with a real test against the new renderer instead of leaving it skipped.',
  );
});

test(
  'ASI01 prompt-injection E2E: malicious MCP tool-result content must not execute as instruction',
  {
    skip:
      'Schutz fehlt: no MCP client and no result-content renderer exist in src/ today (see the ' +
      'precondition check above and Issue #11: "No runtime code yet -> no exfil/injection E2E. Once ' +
      'the MCP client runtime lands: ..."). There is no real code path to test without inventing one — ' +
      'that would be a self-graded test, not evidence. Un-skip and rewrite this test against the real ' +
      'renderer once the ENG-01 contract + MCP client land (contracts/MCP_CONSUMER_PROFILE.md).',
  },
  () => {
    assert.fail('placeholder — see skip reason; do NOT implement against invented/mocked renderer code');
  },
);
