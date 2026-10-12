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
      error: null,
    })),
  };
}

async function compare({ python, browser }) {
  const base = await shared;
  const dir = await mkdtemp(join(tmpdir(), 'browser-tuf-compare-'));
  const pythonPath = join(dir, 'python.json');
  const browserPath = join(dir, 'browser.json');
  await writeFile(pythonPath, JSON.stringify(python ?? await honestPython(base.corpus)));
  await writeFile(browserPath, JSON.stringify(browser ?? base.browser));
  return spawnSync(process.execPath, [
    `${DIFF}/compare-results.mjs`,
    base.corpusPath,
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
