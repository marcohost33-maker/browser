import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conformanceKeyIdFor,
  tufCanonicalJson,
} from '../../spike/tuf-conformance/top-level-client.js';

test('conformance key IDs include unrecognized key fields like securesystemslib', () => {
  const key = {
    keytype: 'ecdsa',
    keyval: {
      public: '-----BEGIN PUBLIC KEY-----\n'
        + 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEu+ebm3VUg6U2b0IIeR6NFZU7uxkL\n'
        + 'R1sVLxV8SEW7G+AMXMasEQf5daxfwVMP1kuEkhGs3mBYLkYXlWDh9BNSxg==\n'
        + '-----END PUBLIC KEY-----\n',
    },
    scheme: 'ecdsa-sha2-nistp256',
    'x-tuf-on-ci-online-uri': 'gcpkms:projects/python-tuf-kms/locations/global/'
      + 'keyRings/git-repo-demo/cryptoKeys/online/cryptoKeyVersions/1',
  };

  assert.equal(
    conformanceKeyIdFor(key),
    'a54e905f3e03bb0cccdc954bd40d4d29b5c1a2a95c2777f10f9c63a503c7f777',
  );
});

test('conformance canonical JSON sorts object keys by Unicode code point', () => {
  assert.equal(
    tufCanonicalJson({ '💩': 2, '\uE000': 1 }),
    '{"\uE000":1,"💩":2}',
  );
});

test('conformance canonical JSON uses OLPC quote/backslash escaping only', () => {
  assert.equal(
    tufCanonicalJson({ value: 'quote" slash\\ newline\n' }),
    '{"value":"quote\\" slash\\\\ newline\n"}',
  );
});
