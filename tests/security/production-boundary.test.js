import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadBaseline, CspValidationError } from '../../src/security/csp.js';
import {
  applyHardenedSecurityHeaders,
  buildHardenedHeaderMap,
  validateApprovedEndpointOrigins,
  validateHardenedBaseline,
  validateSecurityHeaderValues,
  validateServedHeaderMap,
} from '../../src/security/header-values.js';

const clone = globalThis.structuredClone ?? ((value) => JSON.parse(JSON.stringify(value)));
const REAL = loadBaseline();

function mutatedHeader(name, value) {
  const baseline = clone(REAL);
  baseline.additional_headers[name] = value;
  return baseline;
}

test('HSTS preload is blocked until the deployment and rollback gate is accepted', () => {
  const baseline = mutatedHeader(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  );
  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /preload is blocked/.test(error)), errors.join(' | '));
  assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
});

test('Permissions-Policy rejects empty, trailing and unreviewed directives', () => {
  for (const value of [
    `${REAL.additional_headers['Permissions-Policy']},`,
    `,${REAL.additional_headers['Permissions-Policy']}`,
    `${REAL.additional_headers['Permissions-Policy']}, interest-cohort=()`,
  ]) {
    const errors = validateSecurityHeaderValues(mutatedHeader('Permissions-Policy', value));
    assert.ok(errors.length >= 1, `expected ${JSON.stringify(value)} to fail`);
  }
});

test('approved endpoint policy rejects non-public and noncanonical targets', () => {
  for (const origin of [
    'https://0.0.0.0',
    'https://10.0.0.1',
    'https://100.64.0.1',
    'https://127.0.0.1',
    'https://169.254.169.254',
    'https://172.16.0.1:8443',
    'https://192.0.2.1',
    'https://192.168.1.10',
    'https://198.18.0.1',
    'https://198.51.100.1',
    'https://203.0.113.1',
    'https://224.0.0.1',
    'https://[::]',
    'https://[::1]',
    'https://[fd00::1]',
    'https://[fe80::1]',
    'https://[ff02::1]',
    'https://[2001:db8::1]',
    'https://[::ffff:c0a8:101]',
    'https://localhost',
    'https://app.localhost',
    'https://mcp.example.com.',
  ]) {
    const errors = validateApprovedEndpointOrigins([origin]);
    assert.ok(errors.length >= 1, `expected ${origin} to fail`);
  }
});

test('alternative numeric IPv4 spellings fail canonical-origin validation', () => {
  for (const origin of [
    'https://2130706433',
    'https://0x7f000001',
    'https://0177.0.0.1',
    'https://[::ffff:192.168.1.1]',
  ]) {
    const errors = validateApprovedEndpointOrigins([origin]);
    assert.ok(errors.length >= 1, `expected ${origin} to fail`);
  }
});

test('canonical IPv6 literals with embedded or reserved non-public addresses hit the non-public gate', () => {
  for (const origin of [
    'https://[::c0a8:101]', // IPv4-compatible ::/96 form of 192.168.1.1 (Codex bypass)
    'https://[::ffff:c0a8:101]', // IPv4-mapped 192.168.1.1
    'https://[64:ff9b::c0a8:101]', // NAT64 well-known prefix embedding 192.168.1.1
    'https://[::ffff:7f00:1]', // IPv4-mapped 127.0.0.1
    'https://[fc00::1]', // unique local
    'https://[fd12:3456::1]', // unique local
    'https://[fe80::1]', // link-local
    'https://[fec0::1]', // deprecated site-local
    'https://[ff02::1]', // multicast
    'https://[2001:db8::1]', // documentation
    'https://[2002:c0a8:101::]', // 6to4 embedding private 192.168.1.1
    'https://[2002:7f00:1::]', // 6to4 embedding loopback 127.0.0.1
    'https://[::]', // unspecified
    'https://[::1]', // loopback
  ]) {
    const errors = validateApprovedEndpointOrigins([origin]);
    assert.ok(
      errors.some((error) => /non-public\/reserved/.test(error)),
      `expected ${origin} to be rejected as a non-public/reserved literal (got ${JSON.stringify(errors)})`,
    );
  }
});

test('transition-form IPv6 literals embedding a non-public IPv4 are rejected (Teredo, ISATAP, 6to4-relay)', () => {
  // Canonical (WHATWG-URL-normalized) spellings — the form a browser actually
  // resolves an origin to. Each smuggles a private/link-local IPv4 through a
  // transition encoding that a naive allowlist would miss.
  for (const origin of [
    'https://[2001:0:808:808::f5ff:fffe]', // Teredo, client IPv4 = 10.0.0.1 (XOR-obfuscated)
    'https://[2001:0:a00:1::fefe:fefe]', // Teredo, server IPv4 = 10.0.0.1 (plain)
    'https://[2620:0:2d0:200:0:5efe:a00:1]', // ISATAP interface id embedding 10.0.0.1
    'https://[2620:0:2d0::5efe:a9fe:a9fe]', // ISATAP embedding 169.254.169.254 (metadata)
    'https://192.88.99.1', // 6to4 Relay Anycast (RFC 7526, deprecated)
  ]) {
    const errors = validateApprovedEndpointOrigins([origin]);
    assert.ok(
      errors.some((error) => /non-public\/reserved/.test(error)),
      `expected ${origin} to be rejected as a non-public/reserved literal (got ${JSON.stringify(errors)})`,
    );
  }
});

test('remaining IANA special-purpose IPv6 prefixes are refused outright', () => {
  // Not-globally-reachable prefixes that carry no decodable embedded IPv4, so
  // the whole prefix must be refused. 64:ff9b:1::/48 is the NAT64 local-use
  // residual that literal decoding provably cannot cover (RFC 8215 puts the
  // IPv4 at a network-specific offset).
  for (const origin of [
    'https://[100::]', // 100::/64 discard-only (RFC 6666)
    'https://[100::1]',
    'https://[64:ff9b:1::1]', // NAT64 local-use (RFC 8215) — the documented residual
    'https://[2001:2::1]', // benchmarking (RFC 5180)
    'https://[2001:10::1]', // ORCHID, deprecated (RFC 4843)
    'https://[2001:2f:ffff::1]', // ORCHIDv2 upper edge (RFC 7343)
    'https://[3fff::1]', // documentation (RFC 9637)
    'https://[3fff:fff:ffff::1]', // 3fff::/20 upper edge
    'https://[5f00::1]', // SRv6 SIDs (RFC 9602)
  ]) {
    const errors = validateApprovedEndpointOrigins([origin]);
    assert.ok(
      errors.some((error) => /non-public\/reserved/.test(error)),
      `expected ${origin} to be rejected as a non-public/reserved literal (got ${JSON.stringify(errors)})`,
    );
  }
});

test('address space adjacent to the special-purpose prefixes is not over-blocked', () => {
  // Guards the boundary arithmetic: each of these sits one step outside a
  // prefix added above and is ordinary global unicast.
  for (const origin of [
    'https://[100:0:0:1::1]', // outside 100::/64 (g3 non-zero)
    'https://[101::1]', // outside 100::/64 (different g0)
    'https://[64:ff9b:2::1]', // outside the NAT64 local-use /48
    'https://[2001:3::1]', // AMT, outside the benchmarking /48
    'https://[2001:30::1]', // outside ORCHIDv2 /28
    'https://[4000::1]', // outside 3fff::/20
    'https://[3ffe::1]', // below 3fff::/20
    'https://[5f01::1]', // outside 5f00::/16
  ]) {
    assert.deepEqual(
      validateApprovedEndpointOrigins([origin]),
      [],
      `expected ${origin} to remain accepted`,
    );
  }
});

test('transition-form IPv6 literals embedding only public IPv4 stay accepted', () => {
  for (const origin of [
    'https://[2001:0:808:808::fefe:fefe]', // Teredo, server+client both 8.8.8.8 / 1.1.1.1
    'https://[2620:0:2d0:200:0:5efe:808:808]', // ISATAP embedding 8.8.8.8
    'https://192.88.98.1', // adjacent public /24, must not be over-blocked
  ]) {
    assert.deepEqual(
      validateApprovedEndpointOrigins([origin]),
      [],
      `expected ${origin} to remain accepted`,
    );
  }
});

test('dotted-quad IPv6 spellings of non-public hosts are rejected (canonicalized before allowlisting)', () => {
  for (const origin of [
    'https://[::192.168.1.1]', // IPv4-compatible dotted-quad → canonicalizes to ::c0a8:101
    'https://[::ffff:192.168.1.1]', // IPv4-mapped dotted-quad
    'https://[64:ff9b::192.168.1.1]', // NAT64 dotted-quad
  ]) {
    const errors = validateApprovedEndpointOrigins([origin]);
    assert.ok(
      errors.length >= 1,
      `expected ${origin} to be rejected (got ${JSON.stringify(errors)})`,
    );
  }
});

test('canonical public IPv6 origins remain accepted', () => {
  for (const origin of [
    'https://[2606:4700:4700::1111]',
    'https://[2001:4860:4860::8888]',
    'https://[2620:fe::fe]',
    'https://[2002:808:808::]', // 6to4 embedding public 8.8.8.8 stays accepted
  ]) {
    assert.deepEqual(
      validateApprovedEndpointOrigins([origin]),
      [],
      `expected ${origin} to remain accepted`,
    );
  }
});

test('only explicit plain-HTTP loopback development origins are accepted', () => {
  for (const origin of [
    'http://localhost:3000',
    'http://127.0.0.1:8000',
    'http://[::1]:9000',
  ]) {
    assert.deepEqual(validateApprovedEndpointOrigins([origin]), []);
  }

  for (const origin of [
    'http://127.0.0.2:8000',
    'http://app.localhost:3000',
    'https://127.0.0.1:8443',
  ]) {
    assert.ok(validateApprovedEndpointOrigins([origin]).length >= 1);
  }
});

test('hardened validation rejects a non-public origin even when connect-src lists it', () => {
  const origin = 'https://192.168.1.10';
  const baseline = clone(REAL);
  baseline.directives['connect-src'] = ["'self'", origin];
  const errors = validateHardenedBaseline(baseline, { approvedEndpoints: [origin] });
  assert.ok(errors.some((error) => /non-public\/reserved/.test(error)), errors.join(' | '));
  assert.throws(
    () => buildHardenedHeaderMap(baseline, { approvedEndpoints: [origin] }),
    CspValidationError,
  );
});

test('final served-header validation detects missing, changed and duplicate protected headers', () => {
  const expected = buildHardenedHeaderMap(REAL);
  assert.deepEqual(validateServedHeaderMap(expected, REAL), []);

  const missing = { ...expected };
  delete missing['Content-Security-Policy'];
  assert.ok(validateServedHeaderMap(missing, REAL).some((error) => /missing/.test(error)));

  const changed = { ...expected, 'Referrer-Policy': 'unsafe-url' };
  assert.ok(validateServedHeaderMap(changed, REAL).some((error) => /differs/.test(error)));

  const duplicateEntries = [
    ...Object.entries(expected),
    ['referrer-policy', expected['Referrer-Policy']],
  ];
  assert.ok(
    validateServedHeaderMap(duplicateEntries, REAL).some((error) => /duplicate/.test(error)),
  );
});

test('final served-header validation permits unrelated operational headers', () => {
  const expected = buildHardenedHeaderMap(REAL);
  const actual = { ...expected, 'Cache-Control': 'no-store', 'Content-Type': 'text/html' };
  assert.deepEqual(validateServedHeaderMap(actual, REAL), []);
});

test('applyHardenedSecurityHeaders verifies the Node response boundary', () => {
  const values = new Map();
  const response = {
    setHeader(name, value) {
      values.set(name, value);
    },
    getHeaders() {
      return Object.fromEntries(values);
    },
  };

  const applied = applyHardenedSecurityHeaders(response, REAL);
  assert.deepEqual(Object.fromEntries(values), applied);
});

test('applyHardenedSecurityHeaders fails when response accessors are incomplete', () => {
  assert.throws(
    () => applyHardenedSecurityHeaders({ setHeader() {} }, REAL),
    TypeError,
  );
});
