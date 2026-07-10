#!/usr/bin/env node
// CLI for the CSP serializer (M1B). Emits the served header set from
// docs/security/csp-baseline.json and doubles as the CI enforcement gate.
//
// Usage:
//   node src/security/serialize-cli.js            # print CSP header string
//   node src/security/serialize-cli.js --json     # print full header map as JSON
//   node src/security/serialize-cli.js --check     # validate only; exit 1 on violation
//   node src/security/serialize-cli.js --baseline <path>   # override source file
//
// Per-deployment policy generation (resolution #3 in CSP_AND_SECURITY_HEADERS.md)
// can pass a curated allowlist via CSP_APPROVED_ENDPOINTS (comma-separated
// exact origins). The baseline itself stays 'self'-only.

import {
  loadBaseline,
  buildHeaderMap,
  serializeCsp,
  validateBaseline,
  DEFAULT_BASELINE_PATH,
  CspValidationError,
} from './csp.js';

function parseArgs(argv) {
  const opts = { mode: 'header', baseline: DEFAULT_BASELINE_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.mode = 'json';
    else if (a === '--check') opts.mode = 'check';
    else if (a === '--header') opts.mode = 'header';
    else if (a === '--baseline') opts.baseline = argv[++i];
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return opts;
}

function approvedEndpointsFromEnv() {
  const raw = process.env.CSP_APPROVED_ENDPOINTS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const approvedEndpoints = approvedEndpointsFromEnv();

  let baseline;
  try {
    baseline = loadBaseline(opts.baseline);
  } catch (err) {
    process.stderr.write(`failed to load baseline: ${err.message}\n`);
    process.exit(1);
  }

  if (opts.mode === 'check') {
    const errors = validateBaseline(baseline, { approvedEndpoints });
    if (errors.length > 0) {
      process.stderr.write('CSP baseline REJECTED:\n');
      for (const e of errors) process.stderr.write(`  - ${e}\n`);
      process.exit(1);
    }
    process.stdout.write('CSP baseline OK: connect-src exfil boundary enforced.\n');
    process.exit(0);
  }

  try {
    if (opts.mode === 'json') {
      const headers = buildHeaderMap(baseline, { approvedEndpoints });
      process.stdout.write(`${JSON.stringify(headers, null, 2)}\n`);
    } else {
      // header mode: validate (fail-closed) then print the CSP string.
      buildHeaderMap(baseline, { approvedEndpoints });
      process.stdout.write(`${serializeCsp(baseline.directives)}\n`);
    }
  } catch (err) {
    if (err instanceof CspValidationError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

main();
