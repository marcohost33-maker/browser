// Shared fixtures for TUF client tests that build their own trusted state.
// Same deterministic Ed25519 derivation as the differential corpus generator,
// so rebuilt metadata verifies against the corpus root.
import { execFileSync } from 'node:child_process';
import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
} from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseTufMetadataBytes } from '../../spike/tuf-offline-metadata/strict-json.js';
import {
  canonicalBytes,
  keyIdFor,
  sha256,
} from '../../spike/tuf-offline-metadata/tuf-offline.js';

const GENERATOR = 'spike/tuf-offline-metadata/differential/generate-corpus.mjs';
const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export const METADATA_URL = 'https://repo.test/metadata/';

export function decode(value) {
  return Buffer.from(value, 'base64');
}

export async function corpusFixture(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const corpusPath = join(dir, 'corpus.json');
  execFileSync(process.execPath, [GENERATOR, corpusPath], { stdio: 'ignore' });
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
  const item = corpus.cases.find((entry) => entry.name === 'valid-pretty-envelope');
  if (!item) throw new Error('valid differential fixture missing');
  return {
    dir,
    corpus,
    root: decode(item.trusted_root_b64),
    timestamp: decode(item.timestamp_b64),
    snapshot: decode(item.snapshot_b64),
    targets: decode(item.targets_b64),
  };
}

function corpusSigner(name) {
  const seed = Buffer.from(sha256(`browser-tuf-differential-key:${name}`), 'hex');
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicHex = createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('hex');
  const keyId = keyIdFor({ keytype: 'ed25519', scheme: 'ed25519', keyval: { public: publicHex } });
  return { privateKey, keyId };
}

function resignedRaw(metadata, signerName) {
  const signer = corpusSigner(signerName);
  metadata.signatures = [{
    keyid: signer.keyId,
    sig: signBytes(null, canonicalBytes(metadata.signed), signer.privateKey).toString('hex'),
  }];
  return Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function fileDescriptor(raw, version) {
  return { version, length: raw.length, hashes: { sha256: sha256(raw) } };
}

/** The corpus chain with all three top-level versions set to `version`, re-signed. */
export function chainAtVersion(fx, version) {
  const targets = parseTufMetadataBytes(fx.targets);
  targets.signed.version = version;
  const targetsRaw = resignedRaw(targets, 'targetsA');

  const snapshot = parseTufMetadataBytes(fx.snapshot);
  snapshot.signed.version = version;
  snapshot.signed.meta['targets.json'] = fileDescriptor(targetsRaw, version);
  const snapshotRaw = resignedRaw(snapshot, 'snapshotA');

  const timestamp = parseTufMetadataBytes(fx.timestamp);
  timestamp.signed.version = version;
  timestamp.signed.meta['snapshot.json'] = fileDescriptor(snapshotRaw, version);
  const timestampRaw = resignedRaw(timestamp, 'timestampA');

  return { timestamp: timestampRaw, snapshot: snapshotRaw, targets: targetsRaw };
}

/**
 * A mirror that serves one fixed bundle: `N.root.json` from `roots` (N = 2, 3,
 * ...), and the same timestamp/snapshot/targets bytes for any requested
 * version, so malformed or mismatching cases reach the verifier unchanged.
 */
export function bundleMirror({ roots = [], timestamp, snapshot, targets }, requests = []) {
  return async (url) => {
    const href = String(url);
    requests.push(href);
    const path = href.slice(METADATA_URL.length);
    let body = null;
    const rootMatch = /^(\d+)\.root\.json$/.exec(path);
    if (rootMatch) body = roots[Number(rootMatch[1]) - 2] ?? null;
    else if (path === 'timestamp.json') body = timestamp;
    else if (/^(\d+\.)?snapshot\.json$/.test(path)) body = snapshot;
    else if (/^(\d+\.)?targets\.json$/.test(path)) body = targets;
    if (body === null || body === undefined) return new Response('missing', { status: 404 });
    const bytes = Buffer.from(body);
    return new Response(bytes, {
      status: 200,
      headers: { 'content-length': String(bytes.length) },
    });
  };
}

/** Trusted state must be private to this account; create it like the client does. */
export async function writePrivate(path, bytes) {
  await writeFile(path, bytes, { mode: 0o600 });
}
