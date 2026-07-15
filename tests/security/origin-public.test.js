import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateApprovedEndpointOrigins,
} from '../../src/security/header-values.js';

test('canonical public HTTPS origins remain accepted', () => {
  for (const origin of [
    'https://mcp.example.com',
    'https://mcp.example.com:8443',
    'https://8.8.8.8',
    'https://1.1.1.1:8443',
    'https://[2606:4700:4700::1111]',
  ]) {
    assert.deepEqual(
      validateApprovedEndpointOrigins([origin]),
      [],
      `expected ${origin} to remain accepted`,
    );
  }
});

test('192.0.1.0/24 is ordinary public space and is no longer over-blocked', () => {
  // Only 192.0.0.0/24 (Protocol Assignments) and 192.0.2.0/24 (TEST-NET-1) are
  // special-use; 192.0.1.5 must be accepted as an exact public origin.
  assert.deepEqual(
    validateApprovedEndpointOrigins(['https://192.0.1.5']),
    [],
    'expected 192.0.1.5 to be accepted as public',
  );
});

test('192.0.0.0/24 and 192.0.2.0/24 special-use ranges remain blocked', () => {
  for (const origin of ['https://192.0.0.1', 'https://192.0.2.5']) {
    assert.ok(
      validateApprovedEndpointOrigins([origin]).some((e) => /non-public\/reserved/.test(e)),
      `expected ${origin} to remain blocked as non-public`,
    );
  }
});

test('canonical public origins remain distinct for duplicate detection', () => {
  assert.ok(
    validateApprovedEndpointOrigins([
      'https://mcp.example.com',
      'https://mcp.example.com',
    ]).some((error) => /duplicated/.test(error)),
  );
});
