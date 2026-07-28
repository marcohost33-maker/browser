#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADR_HEADING = /^#\s+ADR-([0-9]{3}[a-z]?)\b/im;
const ADR_LINK = /\((?:\.\/)?(ADR-[0-9]{3}[a-z]?-[-A-Za-z0-9_.]+\.md)(?:#[^)]+)?\)/g;
const ADR_FILE = /^ADR-([0-9]{3}[a-z]?)-.+\.md$/;

function normalizeAdrId(value) {
  return value.toLowerCase();
}

export async function collectGovernanceIssues(repositoryRoot = process.cwd()) {
  const adrDirectory = path.join(repositoryRoot, 'docs', 'adr');
  const directoryEntries = await readdir(adrDirectory, { withFileTypes: true });
  const filenames = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  const knownFiles = new Set(filenames);
  const adrOwners = new Map();
  const issues = [];

  for (const filename of filenames) {
    const fileMatch = filename.match(ADR_FILE);
    if (!fileMatch) {
      issues.push(`${filename}: filename must start with ADR-<NNN>[suffix]-`);
      continue;
    }

    const content = await readFile(path.join(adrDirectory, filename), 'utf8');
    const headingMatch = content.match(ADR_HEADING);
    if (!headingMatch) {
      issues.push(`${filename}: first-level ADR heading is missing`);
      continue;
    }

    const filenameId = normalizeAdrId(fileMatch[1]);
    const headingId = normalizeAdrId(headingMatch[1]);
    if (filenameId !== headingId) {
      issues.push(`${filename}: filename ADR-${fileMatch[1]} does not match heading ADR-${headingMatch[1]}`);
    }

    const existingOwner = adrOwners.get(headingId);
    if (existingOwner) {
      issues.push(`ADR-${headingMatch[1]} is duplicated by ${existingOwner} and ${filename}`);
    } else {
      adrOwners.set(headingId, filename);
    }

    for (const match of content.matchAll(ADR_LINK)) {
      const target = match[1];
      if (!knownFiles.has(target)) {
        issues.push(`${filename}: local ADR link target does not exist: ${target}`);
      }
    }
  }

  return issues.sort();
}

export async function main(repositoryRoot = process.cwd()) {
  const issues = await collectGovernanceIssues(repositoryRoot);
  if (issues.length > 0) {
    process.stderr.write('Documentation governance check failed:\n');
    for (const issue of issues) process.stderr.write(`- ${issue}\n`);
    return 1;
  }

  process.stdout.write('Documentation governance check passed.\n');
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv[2] ?? process.cwd());
}
