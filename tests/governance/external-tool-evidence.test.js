// external-tool-evidence: pins, inventory and advisory policy for CI tooling
// outside the npm graph. Network access (Cargo.lock download, OSV) is replaced by
// fakes here; security-ci runs the real lookup.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildSpdx,
  checkWorkflowPins,
  evaluateAdvisories,
  main,
  parseCargoLock,
  queryOsv,
  readManifest,
} from '../../scripts/external-tool-evidence.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
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

test('queryOsv collects ids, follows pagination and refuses malformed answers', async () => {
  const packages = parseCargoLock(LOCK);
  const calls = [];
  const fake = async (url, init) => {
    calls.push(url);
    const body = JSON.parse(init.body);
    if (url.endsWith('/querybatch')) {
      return json({ results: [{}, { vulns: [{ id: 'GHSA-a' }], next_page_token: 't1' }] });
    }
    assert.equal(body.page_token, 't1');
    return json({ vulns: [{ id: 'RUSTSEC-b' }] });
  };
  assert.deepEqual(await queryOsv(packages, fake), [
    { package: 'rustls_webpki', version: '0.103.9', ids: ['GHSA-a', 'RUSTSEC-b'] },
  ]);
  assert.equal(calls.length, 2);
  await assert.rejects(queryOsv(packages, async () => json({ results: [{}] })), /incomplete/);
  await assert.rejects(queryOsv(packages, async () => json({}, 503)), /HTTP 503/);
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
