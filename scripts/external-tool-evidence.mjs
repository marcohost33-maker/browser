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
// Usage: node scripts/external-tool-evidence.mjs --spdx <out.json> --audit <out.json>
// Exit 0 ok, 1 blocked by policy or evidence error, 2 usage error.

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
      const version = new RegExp(`^\\s*${upper}_VERSION:\\s*"([^"]*)"`, 'm').exec(text)?.[1];
      const digest = new RegExp(`^\\s*${upper}_SHA256:\\s*"([^"]*)"`, 'm').exec(text)?.[1];
      if (version !== tool.version) errors.push(`${workflow}: ${upper}_VERSION ${version} != ${tool.version}`);
      if (digest !== tool.asset.sha256) errors.push(`${workflow}: ${upper}_SHA256 ${digest} != ${tool.asset.sha256}`);
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

/** OSV ids per crate version; follows per-query pagination. */
export async function queryOsv(packages, fetchImpl = fetch) {
  const findings = [];
  for (let start = 0; start < packages.length; start += OSV_BATCH) {
    const chunk = packages.slice(start, start + OSV_BATCH);
    const queries = chunk.map((entry) => ({
      package: { ecosystem: 'crates.io', name: entry.name },
      version: entry.version,
    }));
    const body = await postJson(fetchImpl, `${OSV}/querybatch`, { queries });
    if (!Array.isArray(body?.results) || body.results.length !== chunk.length) {
      throw new Error('OSV querybatch returned a malformed or incomplete result list');
    }
    for (const [index, result] of body.results.entries()) {
      const ids = (result.vulns ?? []).map((vuln) => vuln.id);
      let token = result.next_page_token;
      while (token) {
        const page = await postJson(fetchImpl, `${OSV}/query`, { ...queries[index], page_token: token });
        ids.push(...(page.vulns ?? []).map((vuln) => vuln.id));
        token = page.next_page_token;
      }
      if (ids.length > 0) findings.push({ package: chunk[index].name, version: chunk[index].version, ids });
    }
  }
  return findings;
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

export async function main(argv = process.argv.slice(2), fetchImpl = fetch) {
  const options = parseArgs(argv);
  if (!options) {
    process.stderr.write('usage: node scripts/external-tool-evidence.mjs --spdx <out.json> --audit <out.json>\n');
    return 2;
  }
  const manifest = readManifest();
  const pinErrors = checkWorkflowPins(manifest);
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
    const findings = await queryOsv(packages, fetchImpl);
    const { rows, blocking } = evaluateAdvisories(findings, await describe(findings, fetchImpl), manifest);
    blocked += blocking.length;
    tools.push({
      name: tool.name,
      version: tool.version,
      asset_sha256: tool.asset.sha256,
      cargo_lock_sha256: tool.cargo_lock.sha256,
      packages: packages.length,
      packages_with_advisories: findings.length,
      advisories: rows,
      blocking: blocking.map((row) => `${row.package}@${row.version} ${row.id}`),
      scope: 'Cargo.lock superset of the binary; reachability in the binary not assessed',
    });
    process.stdout.write(
      `${tool.name} ${tool.version}: ${packages.length} Cargo.lock packages, `
      + `${findings.length} with OSV advisories (${rows.length} advisory rows), `
      + `${blocking.length} blocking under policy ${manifest.advisory_policy}\n`,
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
  return blocked === 0 ? 0 : 1;
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
