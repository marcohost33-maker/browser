// Gates around the TUF Ed25519 differential (#56/#59 review): the corpus
// decisions under `npm test` (without python-tuf), the root role's keyid-to-role
// binding at the verifier itself, the comparator's completeness checks and the
// mutation study that backs the README's mutation evidence.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseTufMetadataBytes } from '../../spike/tuf-offline-metadata/strict-json.js';
import { updateRootChain } from '../../spike/tuf-offline-metadata/tuf-offline.js';

const DIFF = 'spike/tuf-offline-metadata/differential';
const NOW = new Date('2026-09-27T19:45:00.000Z');

const decode = (value) => Buffer.from(value, 'base64');

async function generated() {
  const dir = await mkdtemp(join(tmpdir(), 'browser-tuf-differential-'));
  const corpusPath = join(dir, 'corpus.json');
  const browserPath = join(dir, 'browser-results.json');
  execFileSync(process.execPath, [`${DIFF}/generate-corpus.mjs`, corpusPath], { stdio: 'ignore' });
  execFileSync(process.execPath, [`${DIFF}/browser-oracle.mjs`, corpusPath, browserPath], { stdio: 'ignore' });
  return {
    dir,
    corpusPath,
    browserPath,
    corpus: JSON.parse(await readFile(corpusPath, 'utf8')),
    browser: JSON.parse(await readFile(browserPath, 'utf8')),
  };
}

const shared = generated();

test('every corpus case gets the Browser decision the corpus expects', async () => {
  const { corpus, browser } = await shared;
  const decisions = new Map(browser.results.map((item) => [item.name, item.decision]));
  assert.equal(decisions.size, corpus.cases.length);
  for (const testCase of corpus.cases) {
    assert.equal(decisions.get(testCase.name), testCase.expected_browser, testCase.name);
  }
});

for (const [name, valid] of [
  // Two keys root lists in root.keys but authorizes for timestamp/snapshot only.
  ['reject-root-signed-by-timestampA-snapshotA-keys', 0],
  // One genuine root key plus the targets-only key: threshold 2 is reached only
  // if the targets key is counted for root.
  ['reject-root-signed-by-rootA-and-targetsA-keys', 1],
]) {
  test(`root v2 ${name.slice('reject-root-'.length)} fails the root threshold with ${valid} authorized signature(s)`, async () => {
    const { corpus } = await shared;
    const testCase = corpus.cases.find((entry) => entry.name === name);
    assert.ok(testCase, `${name} missing from the corpus`);
    const trusted = parseTufMetadataBytes(decode(testCase.trusted_root_b64));
    const candidate = parseTufMetadataBytes(decode(testCase.roots_b64[0]));
    const rootKeyids = new Set(candidate.signed.roles.root.keyids);
    // Precondition: every signer is in root.keys, at least one is not a root key.
    for (const signature of candidate.signatures) {
      assert.ok(signature.keyid in trusted.signed.keys);
      assert.ok(signature.keyid in candidate.signed.keys);
    }
    assert.equal(candidate.signatures.length, candidate.signed.roles.root.threshold);
    assert.ok(candidate.signatures.some((signature) => !rootKeyids.has(signature.keyid)));

    assert.throws(
      () => updateRootChain(trusted, [candidate], NOW),
      (error) => error?.code === 'SIGNATURE_THRESHOLD'
        && error.details?.role === 'root'
        && error.details?.valid === valid
        && error.details?.threshold === 2,
    );
  });
}

// --- compare-results.mjs ---------------------------------------------------

async function pinnedTufVersion() {
  const text = await readFile(`${DIFF}/requirements-oracle.txt`, 'utf8');
  return /^tuf==(\S+)/m.exec(text)[1];
}

// A python-tuf result as the real oracle writes it, with the keyid totals
// taken from the corpus. The comparator is under test here, not the oracle.
async function honestPython(corpus) {
  const roots = corpus.cases.flatMap((entry) => [entry.trusted_root_b64, ...entry.roots_b64]);
  return {
    oracle: 'python-tuf',
    version: await pinnedTufVersion(),
    keyid_check: {
      method: 'sha256(securesystemslib.formats.encode_canonical(key))',
      roots_checked: roots.length,
      keys_checked: roots.reduce(
        (sum, raw) => sum + Object.keys(JSON.parse(decode(raw)).signed.keys).length,
        0,
      ),
      mismatches: [],
    },
    results: corpus.cases.map((entry) => ({
      name: entry.name,
      decision: entry.expected_python_tuf ?? 'accept',
      error: entry.expected_python_error
        ? { name: entry.expected_python_error, category: 'repository', message: 'as the case expects' }
        : null,
    })),
  };
}

async function compare({ python, browser, corpus }) {
  const base = await shared;
  const dir = await mkdtemp(join(tmpdir(), 'browser-tuf-compare-'));
  const pythonPath = join(dir, 'python.json');
  const browserPath = join(dir, 'browser.json');
  let corpusPath = base.corpusPath;
  if (corpus) {
    corpusPath = join(dir, 'corpus.json');
    await writeFile(corpusPath, JSON.stringify(corpus));
  }
  await writeFile(pythonPath, JSON.stringify(python ?? await honestPython(corpus ?? base.corpus)));
  await writeFile(browserPath, JSON.stringify(browser ?? base.browser));
  return spawnSync(process.execPath, [
    `${DIFF}/compare-results.mjs`,
    corpusPath,
    browserPath,
    pythonPath,
    join(dir, 'report.json'),
  ], { encoding: 'utf8' });
}

test('compare-results passes complete, matching oracle results (positive control)', async () => {
  const result = await compare({});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS independent keyid check/);
});

// Each forgery must fail for ITS reason, not merely with some nonzero exit.
const KEYID_FAIL = /FAIL independent keyid check/;
const pythonForgeries = [
  ['one root checked', KEYID_FAIL, (p) => { p.keyid_check.roots_checked = 1; }],
  ['keys_checked missing', KEYID_FAIL, (p) => { delete p.keyid_check.keys_checked; }],
  ['one key fewer checked', KEYID_FAIL, (p) => { p.keyid_check.keys_checked -= 1; }],
  ['keyid method missing', KEYID_FAIL, (p) => { delete p.keyid_check.method; }],
  ['keyid check missing', KEYID_FAIL, (p) => { delete p.keyid_check; }],
  ['unpinned python-tuf version', /python-tuf 6\.0\.0 is not the pinned/, (p) => { p.version = '6.0.0'; }],
  ['foreign oracle identity', /expected oracle python-tuf, got "python-tuf-fork"/, (p) => { p.oracle = 'python-tuf-fork'; }],
  ['duplicated verdict, last one matching', /python-tuf repeats a decision/, (p) => {
    const last = p.results.at(-1);
    p.results.splice(p.results.length - 1, 0, {
      ...last,
      decision: last.decision === 'accept' ? 'reject' : 'accept',
    });
  }],
  // A rejection for another reason than the case is about, and one that only says
  // the oracle script misused the python-tuf API (found 2026-11-16, see
  // pr_nr/NR/agreeing-rejections-for-the-wrong-reason.md).
  ['rollback rejected for an unrelated reason', /FAIL reject-targets-rollback-against-trusted-state/, (p) => {
    p.results.find((item) => item.name === 'reject-targets-rollback-against-trusted-state')
      .error = { name: 'ExpiredMetadataError', message: 'forged' };
  }],
  ['rejection that is a misuse of the oracle API', /FAIL reject-expired-timestamp/, (p) => {
    p.results.find((item) => item.name === 'reject-expired-timestamp')
      .error = { name: 'RuntimeError', message: 'Cannot update timestamp after snapshot' };
  }],
  ['extra verdict for an unknown case', /python-tuf decided an unknown case no-such-case/, (p) => {
    p.results.push({ name: 'no-such-case', decision: 'reject', error: null });
  }],
  ['missing verdict', /missing oracle result for/, (p) => { p.results.pop(); }],
  ['decision outside accept/reject', /decision for \S+ is "maybe"/, (p) => { p.results[0].decision = 'maybe'; }],
];

for (const [label, reason, forge] of pythonForgeries) {
  test(`compare-results fails on a python-tuf result with ${label}`, async () => {
    const python = await honestPython((await shared).corpus);
    forge(python);
    const result = await compare({ python });
    assert.notEqual(result.status, 0, `${label} accepted:\n${result.stdout}`);
    assert.match(result.stdout + result.stderr, reason);
  });
}

test('compare-results fails on a duplicated Browser verdict whose last copy matches', async () => {
  const browser = structuredClone((await shared).browser);
  const first = browser.results[0];
  browser.results.splice(1, 0, { ...first, decision: first.decision === 'accept' ? 'reject' : 'accept' });
  browser.results.push(first);
  browser.results.shift();
  const result = await compare({ browser });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /browser-tuf-spike repeats a decision for/);
});

// --- A7-R14: own error class per oracle and a positive control per rejection ---
// Agreeing "reject" verdicts are evidence only with the reason each oracle gives
// and with an accepted control that takes the same oracle path. Each forgery below
// passed the comparator at ee2f8e2 and must fail now, for its named reason.

test('every reject case of the corpus names both reasons and a positive control', async () => {
  const { corpus } = await shared;
  const rejects = corpus.cases.filter((entry) => entry.expected_browser === 'reject');
  assert.ok(rejects.length >= 19);
  for (const entry of rejects) {
    assert.equal(typeof entry.expected_browser_code, 'string', entry.name);
    if (!entry.must_agree) continue;
    assert.equal(typeof entry.expected_python_error, 'string', entry.name);
    assert.ok(
      corpus.cases.some((other) => other.name === entry.positive_control && other.expected_browser === 'accept'),
      `${entry.name}: control ${entry.positive_control}`,
    );
  }
});

function withoutCase(base, name) {
  const corpus = structuredClone(base.corpus);
  corpus.cases = corpus.cases.filter((entry) => entry.name !== name);
  const browser = structuredClone(base.browser);
  browser.results = browser.results.filter((entry) => entry.name !== name);
  return { corpus, browser };
}

const r14Forgeries = [
  ['a reject case without expected_python_error',
    /FAIL reject-snapshot-hash-mismatch.*names no expected_python_error/,
    (base) => {
      const corpus = structuredClone(base.corpus);
      delete corpus.cases.find((entry) => entry.name === 'reject-snapshot-hash-mismatch').expected_python_error;
      return { corpus };
    }],
  ['a reject case without expected_browser_code',
    /FAIL reject-expired-timestamp.*names no expected_browser_code/,
    (base) => {
      const corpus = structuredClone(base.corpus);
      delete corpus.cases.find((entry) => entry.name === 'reject-expired-timestamp').expected_browser_code;
      return { corpus };
    }],
  ['a Browser rejection for another code than the case is about',
    /FAIL reject-snapshot-rollback-against-trusted-state.*browser code SIGNATURE_THRESHOLD != SNAPSHOT_ROLLBACK/,
    (base) => {
      const browser = structuredClone(base.browser);
      browser.results.find((entry) => entry.name === 'reject-snapshot-rollback-against-trusted-state')
        .error.code = 'SIGNATURE_THRESHOLD';
      return { browser };
    }],
  ['a profile observation rejected by an oracle fault outside the misuse list',
    /FAIL profile-observation-decimal-integer-spelling.*not a python-tuf verdict/,
    async (base) => {
      const python = await honestPython(base.corpus);
      Object.assign(python.results.find((entry) => entry.name === 'profile-observation-decimal-integer-spelling'), {
        decision: 'reject',
        error: { name: 'ValueError', category: 'oracle-fault', message: 'forged' },
      });
      return { python };
    }],
  ['a reject case whose positive control is missing from the corpus',
    /FAIL reject-timestamp-rollback-against-trusted-state.*positive control accept-newer-timestamp-over-trusted-timestamp is not in the corpus/,
    (base) => withoutCase(base, 'accept-newer-timestamp-over-trusted-timestamp')],
  ['a positive control with another oracle setup',
    /FAIL reject-timestamp-rollback-against-trusted-state.*positive control valid-pretty-envelope has another oracle setup/,
    (base) => {
      const corpus = structuredClone(base.corpus);
      corpus.cases.find((entry) => entry.name === 'reject-timestamp-rollback-against-trusted-state')
        .positive_control = 'valid-pretty-envelope';
      return { corpus };
    }],
  // Codex r65FJwJ / A7-R17 B7-1: the same expiry code can come from another expired role
  // when only the reject case's reference time moves; its control no longer shares the setup.
  ['a reject case judged at another reference time than its control',
    /FAIL reject-expired-timestamp.*has another oracle setup/,
    (base) => {
      const corpus = structuredClone(base.corpus);
      corpus.cases.find((entry) => entry.name === 'reject-expired-timestamp').now = '2028-01-01T00:00:00Z';
      return { corpus };
    }],
  // The 2026-11-16 failure: the preload step misused, every rollback "rejected"
  // with the expected class. Only the control shows the path cannot accept.
  ['a positive control that python-tuf rejected',
    /FAIL reject-snapshot-rollback-against-trusted-state.*positive control accept-newer-chain-over-trusted-state was not accepted by both oracles/,
    async (base) => {
      const python = await honestPython(base.corpus);
      Object.assign(python.results.find((entry) => entry.name === 'accept-newer-chain-over-trusted-state'), {
        decision: 'reject',
        error: { name: 'BadVersionNumberError', category: 'repository', message: 'forged' },
      });
      return { python };
    }],
];

for (const [label, reason, forge] of r14Forgeries) {
  test(`compare-results fails on ${label}`, async () => {
    const result = await compare(await forge(await shared));
    assert.notEqual(result.status, 0, `${label} accepted:\n${result.stdout}`);
    assert.match(result.stdout + result.stderr, reason);
  });
}

// --- mutation-study.mjs -----------------------------------------------------

const NESTED = process.env.BROWSER_TUF_MUTATION_STUDY === '1'
  && 'runs inside a mutation study copy';

test('the mutation study kills both role-binding mutants with the Browser differential', { skip: NESTED }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-tuf-mutation-report-'));
  const reportPath = join(dir, 'mutations.json');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    `${DIFF}/mutation-study.mjs`,
    reportPath,
    '--detectors', 'differential',
    '--mutants', 'role-binding-removed,role-binding-skipped-for-root',
  ], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.baseline.clean, true);
  assert.deepEqual(
    report.mutants.map((mutant) => [mutant.id, mutant.status]),
    [['role-binding-removed', 'killed'], ['role-binding-skipped-for-root', 'killed']],
  );
  const rootOnly = report.mutants[1].detectors.differential.browser_mismatches;
  assert.deepEqual(rootOnly, [
    'reject-root-signed-by-timestampA-snapshotA-keys',
    'reject-root-signed-by-rootA-and-targetsA-keys',
  ]);
});

test('the mutation study refuses --require-all when a mutant needs an unselected detector', { skip: NESTED }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-tuf-mutation-report-'));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    `${DIFF}/mutation-study.mjs`,
    join(dir, 'mutations.json'),
    '--detectors', 'differential',
    '--mutants', 'keyid-non-canonical',
    '--require-all',
  ], { encoding: 'utf8', env });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = JSON.parse(await readFile(join(dir, 'mutations.json'), 'utf8'));
  assert.equal(report.mutants[0].status, 'not-evaluated');
});
