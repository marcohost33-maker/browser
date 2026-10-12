#!/usr/bin/env node
// external-tool-evidence — supply-chain inventory and advisory lookup for
// executable CI tooling that is NOT in the npm dependency graph (today: the
// pinned lychee release binary used by docs-ci and docs-external-links).
//
// A SHA-256 pin proves which archive ran, not what it contains or whether it is
// affected by a known advisory. This script
//   1. checks that every workflow pins exactly the version/asset/SHA-256 listed
//      in scripts/external-tools.json,
//   2. downloads the tool's Cargo.lock at the pinned source commit and verifies
//      it against the SHA-256 in the manifest,
//   3. writes an SPDX 2.3 inventory (tool + every Cargo.lock package),
//   4. queries OSV (https://api.osv.dev) for every crate and version and writes
//      the findings with severity, summary and aliases.
//
// Limits, stated in the output too: Cargo.lock is a SUPERSET of what the
// release binary links (all features, targets and dev-dependencies), and no
// build provenance binds the binary to that lock file. A finding therefore
// means "present in the lock", not "reachable in the binary".
//
// Policy (`advisory_policy` in the manifest): "report" records findings and
// never fails on them; "block" fails on every finding whose id or alias is not
// in `accepted_advisories` ({id, reason}). Evidence errors (pin drift, lock hash
// mismatch, OSV unreachable or malformed) fail under either policy.
//
// OSV identity: only crates.io registry entries are queried by name/version, a
// git source by its locked commit; workspace/path members and other registries
// are listed as "unqueried" (under "block" the non-workspace ones block).
//
// Usage: node scripts/external-tool-evidence.mjs --spdx <out.json> --audit <out.json>
// Exit 0 ok, 3 blocked by policy (both evidence files written), 1 evidence
// error (no complete evidence), 2 usage error.

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(REPO, 'scripts', 'external-tools.json');
const OSV = 'https://api.osv.dev/v1';
const OSV_BATCH = 1000;
const POLICIES = new Set(['report', 'block']);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function readManifest(file = MANIFEST) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    throw new Error('external-tools.json: unsupported schema or no tools');
  }
  if (!POLICIES.has(manifest.advisory_policy)) {
    throw new Error(`external-tools.json: unknown advisory_policy ${JSON.stringify(manifest.advisory_policy)}`);
  }
  if (!Array.isArray(manifest.accepted_advisories)
      || manifest.accepted_advisories.some((entry) => !entry?.id || !entry?.reason)) {
    throw new Error('external-tools.json: accepted_advisories entries need id and reason');
  }
  return manifest;
}

/** Every workflow listed for a tool must pin its version, asset name and SHA-256. */
export function checkWorkflowPins(manifest, root = REPO) {
  const errors = [];
  for (const tool of manifest.tools) {
    const upper = tool.name.toUpperCase();
    for (const workflow of tool.workflows) {
      const text = readFileSync(path.join(root, workflow), 'utf8');
      // Every occurrence, not the first: a second job with its own pin must not
      // escape the check.
      const all = (key) => [...text.matchAll(new RegExp(`^\\s*${upper}_${key}:\\s*"([^"]*)"`, 'gm'))]
        .map((match) => match[1]);
      for (const [key, expected] of [['VERSION', tool.version], ['SHA256', tool.asset.sha256]]) {
        const found = all(key);
        if (found.length === 0) errors.push(`${workflow}: no ${upper}_${key} pin`);
        for (const value of found) {
          if (value !== expected) errors.push(`${workflow}: ${upper}_${key} ${value} != ${expected}`);
        }
      }
      if (!text.includes(tool.asset.name)) errors.push(`${workflow}: does not download ${tool.asset.name}`);
    }
  }
  return errors;
}

/** [[package]] entries of a Cargo.lock (version 3/4 format). */
export function parseCargoLock(text) {
  const packages = [];
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const field = (name) => new RegExp(`^${name} = "([^"]*)"`, 'm').exec(block)?.[1] ?? null;
    const entry = { name: field('name'), version: field('version'), source: field('source') };
    if (!entry.name || !entry.version) throw new Error(`Cargo.lock package without name/version: ${block.slice(0, 80)}`);
    packages.push(entry);
  }
  if (packages.length === 0) throw new Error('Cargo.lock holds no packages');
  return packages;
}

const spdxId = (text) => text.replace(/[^A-Za-z0-9.-]/g, '-');

export function buildSpdx(tool, packages, created = new Date().toISOString()) {
  const toolId = `SPDXRef-Tool-${spdxId(tool.name)}`;
  const crates = packages.map((entry, index) => ({
    SPDXID: `SPDXRef-Crate-${index}-${spdxId(entry.name)}`,
    name: entry.name,
    versionInfo: entry.version,
    downloadLocation: entry.source?.startsWith('registry+')
      ? `https://crates.io/api/v1/crates/${entry.name}/${entry.version}/download`
      : 'NOASSERTION',
    filesAnalyzed: false,
    externalRefs: [{
      referenceCategory: 'PACKAGE-MANAGER',
      referenceType: 'purl',
      referenceLocator: `pkg:cargo/${entry.name}@${entry.version}`,
    }],
    comment: entry.source ? `Cargo.lock source ${entry.source}` : 'workspace member (no source)',
  }));
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${tool.name}-${tool.version}-external-tool`,
    documentNamespace: `https://spdx.org/spdxdocs/${tool.name}-${tool.version}-${randomUUID()}`,
    creationInfo: { created, creators: ['Tool: browser scripts/external-tool-evidence.mjs'] },
    comment: 'Packages are the Cargo.lock at the pinned source commit: a superset of the linked binary; no build provenance binds the binary to it.',
    packages: [{
      SPDXID: toolId,
      name: tool.name,
      versionInfo: tool.version,
      downloadLocation: `${tool.repository}/releases/download/${tool.release_tag}/${tool.asset.name}`,
      filesAnalyzed: false,
      checksums: [{ algorithm: 'SHA256', checksumValue: tool.asset.sha256 }],
      externalRefs: [{
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: `pkg:github/${tool.repository.split('/').slice(-2).join('/')}@${tool.release_tag}`,
      }],
    }, ...crates],
    relationships: [
      { spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: toolId },
      ...crates.map((crate) => ({
        spdxElementId: toolId,
        relationshipType: 'DEPENDS_ON',
        relatedSpdxElement: crate.SPDXID,
      })),
    ],
  };
}

async function postJson(fetchImpl, url, body) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

// The crates.io index in both spellings Cargo writes into a lock file.
const CRATES_IO_SOURCES = new Set([
  'registry+https://github.com/rust-lang/crates.io-index',
  'sparse+https://index.crates.io/',
]);
const GIT_COMMIT = /#([0-9a-f]{40})$/;
// Upper bound on querybatch continuation rounds per chunk; OSV paginates only
// past 1,000 ids per query or 3,000 per batch, so this is far above real use.
const OSV_MAX_PAGES = 100;

/**
 * The OSV identity of one Cargo.lock package, or why it has none (#60 review).
 * OSV identifies a package by ecosystem and name; a crates.io name/version query
 * is right only for a crates.io registry entry. A workspace/path member
 * (`source` absent) or a crate from another registry merely SHARES a name with
 * whatever crates.io holds, so querying crates.io would attach that crate's
 * advisories (or miss the real ones). A git source is queried by its locked
 * commit, which OSV supports without a package.
 */
export function osvQueryFor(entry) {
  if (entry.source !== null && CRATES_IO_SOURCES.has(entry.source)) {
    return { query: { package: { ecosystem: 'crates.io', name: entry.name }, version: entry.version } };
  }
  if (entry.source === null) {
    return { unqueried: 'workspace or path member: no registry identity' };
  }
  if (entry.source.startsWith('git+')) {
    const commit = GIT_COMMIT.exec(entry.source)?.[1];
    return commit
      ? { query: { commit } }
      : { unqueried: 'git source without a locked 40-hex commit' };
  }
  return { unqueried: 'source is not the crates.io registry' };
}

function vulnIds(result, where) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`OSV ${where} returned a malformed result`);
  }
  const vulns = result.vulns ?? [];
  if (!Array.isArray(vulns) || vulns.some((vuln) => typeof vuln?.id !== 'string' || vuln.id === '')) {
    throw new Error(`OSV ${where} returned malformed vulnerability entries`);
  }
  const token = result.next_page_token;
  if (token !== undefined && token !== null && typeof token !== 'string') {
    throw new Error(`OSV ${where} returned a malformed next_page_token`);
  }
  return { ids: vulns.map((vuln) => vuln.id), token: token || null };
}

/**
 * OSV ids per Cargo.lock package. Pagination follows the batch contract: a
 * result with `next_page_token` is continued by ANOTHER /v1/querybatch request
 * that carries only the queries still open, each with its own token (#60
 * review: the token was sent to /v1/query before). Packages without an OSV
 * identity are returned in `unqueried`, never silently dropped.
 */
export async function queryOsv(packages, fetchImpl = fetch) {
  const findings = [];
  const unqueried = [];
  const queryable = [];
  for (const entry of packages) {
    const identity = osvQueryFor(entry);
    if (identity.query) queryable.push({ entry, query: identity.query });
    else unqueried.push({ package: entry.name, version: entry.version, source: entry.source, reason: identity.unqueried });
  }
  for (let start = 0; start < queryable.length; start += OSV_BATCH) {
    const chunk = queryable.slice(start, start + OSV_BATCH);
    const ids = chunk.map(() => []);
    let open = chunk.map((item, index) => ({ index, query: item.query, token: null }));
    for (let round = 0; open.length > 0; round += 1) {
      if (round >= OSV_MAX_PAGES) throw new Error(`OSV querybatch still paginating after ${OSV_MAX_PAGES} rounds`);
      const queries = open.map(({ query, token }) => (token === null ? query : { ...query, page_token: token }));
      const body = await postJson(fetchImpl, `${OSV}/querybatch`, { queries });
      if (!Array.isArray(body?.results) || body.results.length !== open.length) {
        throw new Error('OSV querybatch returned a malformed or incomplete result list');
      }
      const next = [];
      for (const [position, result] of body.results.entries()) {
        const page = vulnIds(result, 'querybatch');
        const item = open[position];
        ids[item.index].push(...page.ids);
        if (page.token !== null) {
          if (page.token === item.token) throw new Error('OSV querybatch repeated a page token');
          next.push({ ...item, token: page.token });
        }
      }
      open = next;
    }
    for (const [index, { entry }] of chunk.entries()) {
      const unique = [...new Set(ids[index])];
      if (unique.length > 0) {
        findings.push({ package: entry.name, version: entry.version, source: entry.source, ids: unique });
      }
    }
  }
  return { findings, unqueried };
}

async function describe(findings, fetchImpl) {
  const details = new Map();
  for (const id of new Set(findings.flatMap((finding) => finding.ids))) {
    const response = await fetchImpl(`${OSV}/vulns/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`OSV vulns/${id}: HTTP ${response.status}`);
    const vuln = await response.json();
    details.set(id, {
      id,
      summary: vuln.summary ?? null,
      aliases: vuln.aliases ?? [],
      github_severity: vuln.database_specific?.severity ?? null,
      cvss: (vuln.severity ?? []).map((entry) => entry.score),
    });
  }
  return details;
}

/** Splits findings into blocking and accepted ones under the manifest policy. */
export function evaluateAdvisories(findings, details, manifest) {
  const accepted = new Map(manifest.accepted_advisories.map((entry) => [entry.id, entry.reason]));
  const rows = findings.flatMap((finding) => finding.ids.map((id) => {
    const detail = details.get(id) ?? { id, aliases: [] };
    const match = [id, ...detail.aliases].find((name) => accepted.has(name));
    return { package: finding.package, version: finding.version, ...detail, accepted_as: match ?? null, reason: match ? accepted.get(match) : null };
  }));
  const blocking = manifest.advisory_policy === 'block' ? rows.filter((row) => !row.accepted_as) : [];
  return { rows, blocking };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (!['--spdx', '--audit'].includes(flag) || !value || value.startsWith('--')) return null;
    options[flag.slice(2)] = value;
  }
  return options.spdx && options.audit ? options : null;
}

/**
 * Packages the lookup could not query block under "block": no OSV identity
 * means no evidence that they are free of advisories. Workspace/path members
 * (no `source`) are the tool's own crates, built from the pinned source commit;
 * they are recorded but do not block (their advisories would be the tool's).
 */
export function evaluateUnqueried(unqueried, manifest) {
  return manifest.advisory_policy === 'block' ? unqueried.filter((entry) => entry.source !== null) : [];
}

export const EXIT_BLOCKED = 3;

export async function main(argv = process.argv.slice(2), fetchImpl = fetch, {
  manifest: manifestOverride = null,
  root = REPO,
} = {}) {
  const options = parseArgs(argv);
  if (!options) {
    process.stderr.write('usage: node scripts/external-tool-evidence.mjs --spdx <out.json> --audit <out.json>\n');
    return 2;
  }
  const manifest = manifestOverride ?? readManifest();
  const pinErrors = checkWorkflowPins(manifest, root);
  if (pinErrors.length > 0) {
    for (const error of pinErrors) process.stderr.write(`pin drift: ${error}\n`);
    return 1;
  }
  const tools = [];
  const spdx = [];
  let blocked = 0;
  for (const tool of manifest.tools) {
    const response = await fetchImpl(tool.cargo_lock.url);
    if (!response.ok) throw new Error(`${tool.cargo_lock.url}: HTTP ${response.status}`);
    const lock = Buffer.from(await response.arrayBuffer());
    if (sha256(lock) !== tool.cargo_lock.sha256) {
      throw new Error(`${tool.name} Cargo.lock SHA-256 ${sha256(lock)} != pinned ${tool.cargo_lock.sha256}`);
    }
    const packages = parseCargoLock(lock.toString('utf8'));
    spdx.push(buildSpdx(tool, packages));
    const { findings, unqueried } = await queryOsv(packages, fetchImpl);
    const { rows, blocking } = evaluateAdvisories(findings, await describe(findings, fetchImpl), manifest);
    const unqueriedBlocking = evaluateUnqueried(unqueried, manifest);
    blocked += blocking.length + unqueriedBlocking.length;
    tools.push({
      name: tool.name,
      version: tool.version,
      asset_sha256: tool.asset.sha256,
      cargo_lock_sha256: tool.cargo_lock.sha256,
      packages: packages.length,
      packages_with_advisories: findings.length,
      advisories: rows,
      unqueried,
      blocking: [
        ...blocking.map((row) => `${row.package}@${row.version} ${row.id}`),
        ...unqueriedBlocking.map((entry) => `${entry.package}@${entry.version} not queried: ${entry.reason}`),
      ],
      scope: 'Cargo.lock superset of the binary; reachability in the binary not assessed',
    });
    process.stdout.write(
      `${tool.name} ${tool.version}: ${packages.length} Cargo.lock packages, `
      + `${findings.length} with OSV advisories (${rows.length} advisory rows), `
      + `${unqueried.length} without an OSV identity (not queried), `
      + `${blocking.length + unqueriedBlocking.length} blocking under policy ${manifest.advisory_policy}\n`,
    );
  }
  writeFileSync(options.spdx, `${JSON.stringify(spdx.length === 1 ? spdx[0] : spdx, null, 2)}\n`);
  writeFileSync(options.audit, `${JSON.stringify({
    schema_version: 1,
    generated_at: new Date().toISOString(),
    osv: OSV,
    advisory_policy: manifest.advisory_policy,
    tools,
  }, null, 2)}\n`);
  // 3, not 1: both evidence files are written, so CI can upload them before it
  // enforces the policy (#60 review); 1 stays "no complete evidence".
  return blocked === 0 ? 0 : EXIT_BLOCKED;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`external-tool-evidence: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}
