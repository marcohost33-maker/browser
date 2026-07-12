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

test('canonical public origins remain distinct for duplicate detection', () => {
  assert.ok(
    validateApprovedEndpointOrigins([
      'https://mcp.example.com',
      'https://mcp.example.com',
    ]).some((error) => /duplicated/.test(error)),
  );
});
