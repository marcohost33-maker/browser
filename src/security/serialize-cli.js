#!/usr/bin/env node
// CLI for the complete APP-01 CSP/security-header/deployment-origin gate.
//
// Usage:
//   node src/security/serialize-cli.js
//   node src/security/serialize-cli.js --json
//   node src/security/serialize-cli.js --check
//   node src/security/serialize-cli.js --baseline <path>
//
// CSP_APPROVED_ORIGINS contains comma-separated canonical origins, not full MCP
// endpoint URLs. CSP_APPROVED_ENDPOINTS is a temporary deprecated alias.

import {
  loadBaseline,
  serializeCsp,
  DEFAULT_BASELINE_PATH,
  CspValidationError,
} from './csp.js';
import {
  buildHardenedHeaderMap,
  validateHardenedBaseline,
} from './header-values.js';

function failUsage(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { mode: 'header', baseline: DEFAULT_BASELINE_PATH };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.mode = 'json';
    else if (arg === '--check') opts.mode = 'check';
    else if (arg === '--header') opts.mode = 'header';
    else if (arg === '--baseline') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        failUsage('--baseline requires a path');
      }
      opts.baseline = argv[++i];
    } else {
      failUsage(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function parseOriginList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function approvedOriginsFromEnv() {
  const current = process.env.CSP_APPROVED_ORIGINS;
  const legacy = process.env.CSP_APPROVED_ENDPOINTS;

  if (current && legacy) {
    failUsage(
      'set only CSP_APPROVED_ORIGINS; CSP_APPROVED_ENDPOINTS is a deprecated alias and both cannot be used together',
    );
  }

  if (legacy) {
    process.stderr.write(
      'warning: CSP_APPROVED_ENDPOINTS is deprecated; use CSP_APPROVED_ORIGINS (values are origins, not endpoint URLs)\n',
    );
  }

  return parseOriginList(current || legacy);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const approvedEndpoints = approvedOriginsFromEnv();

  let baseline;
  try {
    baseline = loadBaseline(opts.baseline);
  } catch (err) {
    process.stderr.write(`failed to load baseline: ${err.message}\n`);
    process.exit(1);
  }

  if (opts.mode === 'check') {
    const errors = validateHardenedBaseline(baseline, { approvedEndpoints });
    if (errors.length > 0) {
      process.stderr.write('CSP/security-header baseline REJECTED:\n');
      for (const error of errors) process.stderr.write(`  - ${error}\n`);
      process.exit(1);
    }
    process.stdout.write(
      'CSP/security-header baseline OK: exfiltration, endpoint and header-value boundaries enforced.\n',
    );
    process.exit(0);
  }

  try {
    const headers = buildHardenedHeaderMap(baseline, { approvedEndpoints });
    if (opts.mode === 'json') {
      process.stdout.write(`${JSON.stringify(headers, null, 2)}\n`);
    } else {
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
