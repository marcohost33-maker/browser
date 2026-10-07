#!/usr/bin/env node
// docs:lint — markdownlint over every Markdown file of the repository.
//
// The rules are the `markdownlint` library itself; only file discovery and output
// are ours. This replaces markdownlint-cli2, whose file discovery pulls
// globby -> fast-glob -> micromatch -> braces, and braces <= 3.0.3 carries a
// high-severity advisory with no patched release (GHSA-vfj7-8cjw-p6xm). The glob
// layer was the only reason for those packages: this repository lints one fixed
// set of files, which a directory walk describes exactly.
//
// Discovery mirrors the previous configuration (`**/*.md`, dotfiles included,
// `node_modules` and `.git` ignored at any depth) so the linted set does not change.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lint } from 'markdownlint/promise';

export const CONFIG_FILE = '.markdownlint.jsonc';
export const IGNORED_DIRECTORIES = Object.freeze(new Set(['node_modules', '.git']));

/**
 * Removes `//` and `/* *\/` comments outside JSON strings. Trailing commas and
 * other JSONC extensions are not accepted: the result must be plain JSON.
 */
export function stripJsonComments(text) {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
      if (index >= text.length) throw new Error('unterminated string in JSONC');
      index += 1;
      out += text.slice(start, index);
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      if (end < 0) throw new Error('unterminated block comment in JSONC');
      // Keep line breaks so JSON.parse positions still point at the right line.
      out += text.slice(index, end + 2).replace(/[^\n]/g, ' ');
      index = end + 2;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

export async function readLintConfig(repositoryRoot) {
  const text = await readFile(path.join(repositoryRoot, CONFIG_FILE), 'utf8');
  const config = JSON.parse(stripJsonComments(text));
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${CONFIG_FILE} must contain a JSON object`);
  }
  return config;
}

/** Every `*.md` file below `repositoryRoot`, as sorted POSIX-style relative paths. */
export async function findMarkdownFiles(repositoryRoot) {
  const found = [];
  async function walk(relative) {
    const entries = await readdir(path.join(repositoryRoot, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(child);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push(child);
      }
    }
  }
  await walk('');
  return found.sort();
}

function formatIssue(file, issue) {
  const column = issue.errorRange ? `:${issue.errorRange[0]}` : '';
  const detail = issue.errorDetail ? ` [${issue.errorDetail}]` : '';
  const context = issue.errorContext ? ` [Context: ${JSON.stringify(issue.errorContext)}]` : '';
  return `${file}:${issue.lineNumber}${column} ${issue.ruleNames.join('/')} ${issue.ruleDescription}${detail}${context}`;
}

/** Lints the repository; returns the linted files and one formatted line per issue. */
export async function lintRepository(repositoryRoot) {
  const config = await readLintConfig(repositoryRoot);
  const files = await findMarkdownFiles(repositoryRoot);
  const strings = {};
  for (const file of files) strings[file] = await readFile(path.join(repositoryRoot, file), 'utf8');
  const results = await lint({ strings, config, handleRuleFailures: true });
  const issues = [];
  for (const file of files) {
    for (const issue of results[file] ?? []) issues.push(formatIssue(file, issue));
  }
  return { files, issues };
}

export async function main(repositoryRoot = process.cwd()) {
  const { files, issues } = await lintRepository(repositoryRoot);
  for (const line of issues) process.stderr.write(`${line}\n`);
  process.stdout.write(`markdownlint: ${files.length} files, ${issues.length} issues\n`);
  return issues.length === 0 ? 0 : 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv[2] ?? process.cwd());
  } catch (error) {
    process.stderr.write(`markdownlint: ${error?.stack ?? error}\n`);
    process.exitCode = 2;
  }
}
