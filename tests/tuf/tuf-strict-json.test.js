import assert from 'node:assert/strict';
import test from 'node:test';

import { TufSpikeError } from '../../spike/tuf-offline-metadata/tuf-offline.js';
import {
  parseStrictJsonBytes,
  parseTufMetadataBytes,
} from '../../spike/tuf-offline-metadata/strict-json.js';

function assertCode(expectedCode, action) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof TufSpikeError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test('accepts noncanonical envelope whitespace and key order', () => {
  const raw = Buffer.from(
    '{ "signed": { "version": 1, "spec_version": "1.0.35", "meta": {}, "expires": "2027-01-01T00:00:00Z", "_type": "timestamp" }, "signatures": [] }\n',
    'utf8',
  );
  const parsed = parseTufMetadataBytes(raw);

  assert.equal(parsed.signed._type, 'timestamp');
  assert.equal(parsed.signed.version, 1);
});

test('rejects a duplicate top-level key before semantic verification', () => {
  const raw = Buffer.from('{"signed":{},"signed":{},"signatures":[]}', 'utf8');
  assertCode('DUPLICATE_JSON_KEY', () => parseStrictJsonBytes(raw));
});

test('rejects decoded-equivalent duplicate keys including unicode escapes', () => {
  const raw = Buffer.from('{"signed":{"a":1,"\\u0061":2},"signatures":[]}', 'utf8');
  assertCode('DUPLICATE_JSON_KEY', () => parseStrictJsonBytes(raw));
});

test('enforces the byte envelope before attempting to parse malformed input', () => {
  const raw = Buffer.alloc(17, 0xff);
  assertCode('METADATA_TOO_LARGE', () => parseStrictJsonBytes(raw, { maxBytes: 16 }));
});

test('rejects malformed UTF-8', () => {
  const raw = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d]);
  assertCode('INVALID_UTF8', () => parseStrictJsonBytes(raw));
});

test('rejects UTF-8 BOM under the project POUF', () => {
  const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')]);
  assertCode('JSON_BOM_FORBIDDEN', () => parseStrictJsonBytes(raw));
});

test('does not prototype-pollute on __proto__ keys', () => {
  const parsed = parseStrictJsonBytes(Buffer.from('{"__proto__":{"polluted":true}}', 'utf8'));
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(parsed.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
});

test('rejects unsafe numeric values under the restricted POUF', () => {
  const raw = Buffer.from(
    '{"signatures":[],"signed":{"_type":"timestamp","expires":"2027-01-01T00:00:00Z","meta":{},"spec_version":"1.0.35","version":9007199254740992}}',
    'utf8',
  );
  assertCode('INVALID_NUMBER', () => parseTufMetadataBytes(raw));
});

test('uses project error vocabulary for a non-byte raw input', () => {
  assertCode('INVALID_RAW_METADATA', () => parseStrictJsonBytes('{"x":1}'));
});
