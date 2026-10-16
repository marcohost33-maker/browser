// external-tool-evidence: pins, inventory and advisory policy for CI tooling
// outside the npm graph. Network access (Cargo.lock download, OSV) is replaced by
// fakes here; security-ci runs the real lookup.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildSpdx,
  checkWorkflowPins,
  evaluateAdvisories,
  evaluateUnqueried,
  EXIT_BLOCKED,
  main,
  osvQueryFor,
  parseCargoLock,
  queryOsv,
  readManifest,
} from '../../scripts/external-tool-evidence.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');
const LOCK = [
  'version = 4',
  '',
  '[[package]]',
  'name = "lychee"',
  'version = "0.24.2"',
  '',
  '[[package]]',
  'name = "rustls_webpki"',
  'version = "0.103.9"',
  'source = "registry+https://github.com/rust-lang/crates.io-index"',
  'checksum = "00"',
  '',
].join('\n');

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

test('every workflow pins the lychee version, asset and SHA-256 of the manifest', () => {
  assert.deepEqual(checkWorkflowPins(readManifest()), []);
});

test('a workflow whose SHA-256 drifts from the manifest is reported', async () => {
  const manifest = readManifest();
  const root = await mkdtemp(path.join(tmpdir(), 'browser-tool-pins-'));
  for (const workflow of manifest.tools[0].workflows) {
    const text = await readFile(path.join(repositoryRoot, workflow), 'utf8');
    await mkdir(path.dirname(path.join(root, workflow)), { recursive: true });
    await writeFile(path.join(root, workflow), text.replace(manifest.tools[0].asset.sha256, '0'.repeat(64)));
  }
  const errors = checkWorkflowPins(manifest, root);
  assert.equal(errors.length, manifest.tools[0].workflows.length);
  assert.match(errors[0], /LYCHEE_SHA256 0{64} != /);
});

test('a second, drifting pin in the same workflow is reported too', async () => {
  const manifest = readManifest();
  const root = await mkdtemp(path.join(tmpdir(), 'browser-tool-pins-'));
  for (const workflow of manifest.tools[0].workflows) {
    const text = await readFile(path.join(repositoryRoot, workflow), 'utf8');
    await mkdir(path.dirname(path.join(root, workflow)), { recursive: true });
    await writeFile(path.join(root, workflow), `${text}\n  second:\n    env:\n      LYCHEE_VERSION: "0.0.1"\n`);
  }
  const errors = checkWorkflowPins(manifest, root);
  assert.equal(errors.length, manifest.tools[0].workflows.length);
  assert.match(errors[0], /LYCHEE_VERSION 0\.0\.1 != 0\.24\.2/);
});

test('parseCargoLock reads every package and refuses an empty lock', () => {
  assert.deepEqual(parseCargoLock(LOCK), [
    { name: 'lychee', version: '0.24.2', source: null },
    { name: 'rustls_webpki', version: '0.103.9', source: 'registry+https://github.com/rust-lang/crates.io-index' },
  ]);
  assert.throws(() => parseCargoLock('version = 4\n'), /no packages/);
});

test('the SPDX inventory names the pinned archive and every lock package', () => {
  const tool = readManifest().tools[0];
  const doc = buildSpdx(tool, parseCargoLock(LOCK), '2026-10-12T00:00:00Z');
  assert.equal(doc.spdxVersion, 'SPDX-2.3');
  assert.equal(doc.packages.length, 3);
  assert.deepEqual(doc.packages[0].checksums, [{ algorithm: 'SHA256', checksumValue: tool.asset.sha256 }]);
  assert.equal(doc.packages[2].externalRefs[0].referenceLocator, 'pkg:cargo/rustls_webpki@0.103.9');
  const ids = doc.packages.map((entry) => entry.SPDXID);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^SPDXRef-[A-Za-z0-9.-]+$/);
  assert.equal(doc.relationships.length, 3);
});

const CRATES_IO = 'registry+https://github.com/rust-lang/crates.io-index';
const crate = (name, version, source = CRATES_IO) => ({ name, version, source });

test('queryOsv continues a paginated batch through /querybatch with only the open queries (#60 review)', async () => {
  const packages = [crate('a', '1.0.0'), crate('b', '2.0.0'), crate('c', '3.0.0')];
  const calls = [];
  const fake = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (calls.length === 1) {
      return json({ results: [
        { vulns: [{ id: 'GHSA-a1' }] },
        { vulns: [{ id: 'GHSA-b1' }], next_page_token: 't1' },
        {},
      ] });
    }
    if (calls.length === 2) return json({ results: [{ vulns: [{ id: 'GHSA-b2' }], next_page_token: 't2' }] });
    return json({ results: [{ vulns: [{ id: 'GHSA-b3' }] }] });
  };
  const { findings, unqueried } = await queryOsv(packages, fake);
  assert.deepEqual(findings, [
    { package: 'a', version: '1.0.0', source: CRATES_IO, ids: ['GHSA-a1'] },
    { package: 'b', version: '2.0.0', source: CRATES_IO, ids: ['GHSA-b1', 'GHSA-b2', 'GHSA-b3'] },
  ]);
  assert.deepEqual(unqueried, []);
  assert.equal(calls.length, 3);
  for (const call of calls) assert.ok(call.url.endsWith('/v1/querybatch'), `${call.url} must be the batch endpoint`);
  assert.deepEqual(calls[1].body, {
    queries: [{ package: { ecosystem: 'crates.io', name: 'b' }, version: '2.0.0', page_token: 't1' }],
  });
  assert.deepEqual(calls[2].body.queries.map((query) => query.page_token), ['t2']);
});

test('queryOsv refuses malformed, incomplete or non-terminating answers', async () => {
  const packages = [crate('a', '1.0.0')];
  await assert.rejects(queryOsv(packages, async () => json({ results: [] })), /incomplete/);
  await assert.rejects(queryOsv(packages, async () => json({}, 503)), /HTTP 503/);
  await assert.rejects(queryOsv(packages, async () => json({ results: [null] })), /malformed result/);
  await assert.rejects(
    queryOsv(packages, async () => json({ results: [{ vulns: [{}] }] })),
    /malformed vulnerability/,
  );
  await assert.rejects(
    queryOsv(packages, async () => json({ results: [{ next_page_token: 7 }] })),
    /malformed next_page_token/,
  );
  await assert.rejects(
    queryOsv(packages, async () => json({ results: [{ next_page_token: 'same' }] })),
    /repeated a page token/,
  );
  // Ends on its own after 500 pages, so a missing round cap shows up as an
  // accepted answer rather than as a hang.
  let page = 0;
  await assert.rejects(
    queryOsv(packages, async () => {
      page += 1;
      return json({ results: [page < 500 ? { next_page_token: `p${page}` } : {}] });
    }),
    /still paginating/,
  );
});

test('only crates.io registry entries are queried by name; git by commit; the rest is listed (#60 review)', async () => {
  const commit = 'a'.repeat(40);
  assert.deepEqual(osvQueryFor(crate('x', '1.0.0')).query, {
    package: { ecosystem: 'crates.io', name: 'x' }, version: '1.0.0',
  });
  assert.deepEqual(osvQueryFor(crate('x', '1.0.0', 'sparse+https://index.crates.io/')).query, {
    package: { ecosystem: 'crates.io', name: 'x' }, version: '1.0.0',
  });
  assert.deepEqual(osvQueryFor(crate('x', '1.0.0', `git+https://github.com/o/x?branch=main#${commit}`)).query, { commit });
  for (const source of [null, 'git+https://github.com/o/x?branch=main', 'registry+https://example.test/index',
    'sparse+https://index.crates.io.evil/', 'registry+https://github.com/rust-lang/crates.io-index-fork']) {
    const identity = osvQueryFor(crate('x', '1.0.0', source));
    assert.equal(identity.query, undefined, `source ${source} must not be queried as crates.io`);
    assert.equal(typeof identity.unqueried, 'string');
  }

  const packages = [
    crate('lychee-lib', '0.24.2', null),
    crate('registry-crate', '1.0.0'),
    crate('git-crate', '0.1.0', `git+https://github.com/o/git-crate#${commit}`),
    crate('other-registry', '1.0.0', 'registry+https://example.test/index'),
  ];
  const sent = [];
  const { unqueried } = await queryOsv(packages, async (url, init) => {
    const { queries } = JSON.parse(init.body);
    sent.push(...queries);
    return json({ results: queries.map(() => ({})) });
  });
  assert.deepEqual(sent, [
    { package: { ecosystem: 'crates.io', name: 'registry-crate' }, version: '1.0.0' },
    { commit },
  ]);
  assert.deepEqual(unqueried.map((entry) => entry.package), ['lychee-lib', 'other-registry']);
  assert.deepEqual(evaluateUnqueried(unqueried, { advisory_policy: 'report' }), []);
  assert.deepEqual(
    evaluateUnqueried(unqueried, { advisory_policy: 'block' }).map((entry) => entry.package),
    ['other-registry'],
  );
});

test('a blocking run writes both evidence files and exits 3, distinct from evidence errors (#60 review)', async () => {
  const lock = `${LOCK}\n[[package]]\nname = "alt"\nversion = "1.0.0"\nsource = "registry+https://example.test/index"\n`;
  const base = readManifest();
  const manifestFor = (policy) => ({
    ...base,
    advisory_policy: policy,
    tools: [{ ...base.tools[0], cargo_lock: { ...base.tools[0].cargo_lock, sha256: sha256Hex(lock) } }],
  });
  const fake = async (url, init) => {
    if (url === base.tools[0].cargo_lock.url) return new Response(lock, { status: 200 });
    if (url.endsWith('/v1/querybatch')) {
      const { queries } = JSON.parse(init.body);
      return json({ results: queries.map(() => ({ vulns: [{ id: 'RUSTSEC-x' }] })) });
    }
    if (url.endsWith('/v1/vulns/RUSTSEC-x')) return json({ id: 'RUSTSEC-x', aliases: [] });
    throw new Error(`unexpected request ${url}`);
  };
  for (const [policy, expected] of [['report', 0], ['block', EXIT_BLOCKED]]) {
    const dir = await mkdtemp(path.join(tmpdir(), 'browser-tool-evidence-'));
    const files = ['--spdx', path.join(dir, 's.json'), '--audit', path.join(dir, 'a.json')];
    assert.equal(await main(files, fake, { manifest: manifestFor(policy) }), expected, policy);
    const audit = JSON.parse(await readFile(path.join(dir, 'a.json'), 'utf8'));
    assert.equal(JSON.parse(await readFile(path.join(dir, 's.json'), 'utf8')).spdxVersion, 'SPDX-2.3');
    assert.deepEqual(audit.tools[0].unqueried.map((entry) => entry.package), ['lychee', 'alt']);
    assert.deepEqual(audit.tools[0].blocking, policy === 'block'
      ? ['rustls_webpki@0.103.9 RUSTSEC-x', 'alt@1.0.0 not queried: source is not the crates.io registry']
      : []);
  }
  assert.equal(EXIT_BLOCKED, 3);
});

// The two security-ci steps around the upload, extracted from the workflow text
// and run with a POSIX shell the way the runner does (bash -e).
function workflowStep(text, name) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.ok(start >= 0, `step "${name}" missing`);
  const indent = lines[start].indexOf('-');
  let end = start + 1;
  while (end < lines.length && !(lines[end].trim().startsWith('- ') && lines[end].indexOf('-') === indent)
    && !(lines[end].trim() !== '' && lines[end].search(/\S/) < indent)) end += 1;
  const block = lines.slice(start, end);
  const runAt = block.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  const run = runAt < 0 ? null : block.slice(runAt + 1)
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(lines[start + runAt + 1].search(/\S/)))
    .join('\n');
  return { start, block: block.join('\n'), run };
}

const shell = spawnSync('sh', ['-c', 'exit 0']);
const shellMissing = shell.error ? 'no POSIX sh on PATH' : false;

test('security-ci uploads the advisory evidence before it enforces a blocking policy (#60 review)', { skip: shellMissing }, async () => {
  const text = await readFile(path.join(repositoryRoot, '.github', 'workflows', 'security-ci.yml'), 'utf8');
  const evidence = workflowStep(text, 'inventory and advisories of external CI tooling');
  const upload = workflowStep(text, 'upload immutable security evidence');
  const enforce = workflowStep(text, 'enforce the external tooling advisory policy');
  assert.ok(evidence.start < upload.start && upload.start < enforce.start, 'evidence -> upload -> enforce');
  assert.match(evidence.block, /^\s*id: external-tools\s*$/m);
  assert.doesNotMatch(upload.block, /^\s*if:/m, 'the upload keeps the default success() condition');
  assert.match(enforce.block, /EXTERNAL_TOOLS_EXIT: \$\{\{ steps\.external-tools\.outputs\.exit_code \}\}/);

  const dir = await mkdtemp(path.join(tmpdir(), 'browser-security-ci-'));
  const runStep = (script, env) => spawnSync('sh', ['-e', '-c', script], {
    env: { ...process.env, ...env }, encoding: 'utf8',
  });
  for (const [rc, stepExit] of [[0, 0], [3, 0], [1, 1], [2, 2]]) {
    const output = path.join(dir, `out-${rc}`);
    await writeFile(output, '');
    // A shell function shadows `node`: the step sees exactly this exit code.
    const result = runStep(`node() { return ${rc}; }\n${evidence.run}`, { GITHUB_OUTPUT: output });
    assert.equal(result.status, stepExit, `evidence exit ${rc}: ${result.stderr}`);
    assert.equal((await readFile(output, 'utf8')).trim(), `exit_code=${rc}`);
  }
  for (const [recorded, status] of [['0', 0], ['3', 1], ['', 1]]) {
    const result = runStep(enforce.run, { EXTERNAL_TOOLS_EXIT: recorded });
    assert.equal(result.status, status, `enforce with recorded exit "${recorded}"`);
  }
});

test('policy "report" never blocks; "block" blocks every finding not accepted by id or alias', () => {
  const findings = [{ package: 'x', version: '1', ids: ['GHSA-a', 'RUSTSEC-b'] }];
  const details = new Map([
    ['GHSA-a', { id: 'GHSA-a', aliases: ['CVE-1'] }],
    ['RUSTSEC-b', { id: 'RUSTSEC-b', aliases: [] }],
  ]);
  const report = evaluateAdvisories(findings, details, { advisory_policy: 'report', accepted_advisories: [] });
  assert.equal(report.rows.length, 2);
  assert.deepEqual(report.blocking, []);
  const block = evaluateAdvisories(findings, details, {
    advisory_policy: 'block',
    accepted_advisories: [{ id: 'CVE-1', reason: 'not reachable offline' }],
  });
  assert.deepEqual(block.blocking.map((row) => row.id), ['RUSTSEC-b']);
  assert.equal(block.rows[0].accepted_as, 'CVE-1');
});

test('a Cargo.lock that does not match the pinned SHA-256 fails the evidence run', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'browser-tool-evidence-'));
  const fake = async () => new Response(LOCK, { status: 200 });
  await assert.rejects(
    main(['--spdx', path.join(dir, 's.json'), '--audit', path.join(dir, 'a.json')], fake),
    /Cargo\.lock SHA-256 [0-9a-f]{64} != pinned/,
  );
});

test('usage errors exit 2 without touching the network', async () => {
  const noNetwork = async () => { throw new Error('network used'); };
  assert.equal(await main(['--spdx', 'only-one.json'], noNetwork), 2);
  assert.equal(await main(['--audit', 'a.json', '--spdx'], noNetwork), 2);
});
