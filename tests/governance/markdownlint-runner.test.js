// docs:lint runner: discovery must lint exactly the files the previous
// markdownlint-cli2 configuration linted, the configuration must actually be
// applied, and a violation must fail the run (a gate that cannot fail proves
// nothing).

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CONFIG_FILE,
  findMarkdownFiles,
  lintRepository,
  readLintConfig,
  stripJsonComments,
} from '../../scripts/markdownlint.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'browser-markdownlint-'));
  const config = await readFile(path.join(repositoryRoot, CONFIG_FILE), 'utf8');
  await writeFile(path.join(root, CONFIG_FILE), config);
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
  }
  return root;
}

test('stripJsonComments removes comments but never touches string contents', () => {
  const text = [
    '// leading comment',
    '{',
    '  "url": "https://example.test/a//b", // trailing',
    '  /* block',
    '     comment */ "quote": "a \\" // not a comment",',
    '  "n": 1',
    '}',
  ].join('\n');
  assert.deepEqual(JSON.parse(stripJsonComments(text)), {
    url: 'https://example.test/a//b',
    quote: 'a " // not a comment',
    n: 1,
  });
  assert.equal(stripJsonComments('/* a\nb */{}').split('\n').length, 2, 'line numbers are preserved');
  assert.throws(() => stripJsonComments('{} /* open'), /unterminated block comment/);
  assert.throws(() => stripJsonComments('{"a": "open'), /unterminated string/);
});

test('the repository configuration keeps the documented rule decisions', async () => {
  const config = await readLintConfig(repositoryRoot);
  assert.deepEqual(config, { default: true, MD013: false, MD060: false });
});

test('discovery includes dotfile directories and skips node_modules and .git at any depth', async () => {
  const root = await fixture({
    'README.md': '# Root\n',
    'docs/deep/a.md': '# A\n',
    '.github/template.md': '# Template\n',
    'node_modules/pkg/README.md': '#bad\n',
    'spike/harness/node_modules/pkg/README.md': '#bad\n',
    '.git/notes.md': '#bad\n',
    'docs/not-markdown.txt': '#bad\n',
  });
  assert.deepEqual(await findMarkdownFiles(root), [
    '.github/template.md',
    'README.md',
    'docs/deep/a.md',
  ]);
});

test('a violation fails the lint and is reported with file, line and rule', async () => {
  const root = await fixture({
    'README.md': '# Root\n\n## Heading\nno blank line after the heading\n',
    'clean.md': '# Clean\n\nText.\n',
  });
  const { files, issues } = await lintRepository(root);
  assert.deepEqual(files, ['README.md', 'clean.md']);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /^README\.md:3 MD022\/blanks-around-headings /);
});

test('disabled rules stay disabled and inline configuration is honoured', async () => {
  const root = await fixture({
    'long.md': `# Long\n\n${'x'.repeat(300)}\n`,
    'inline.md': '<!-- markdownlint-disable MD041 -->\nNo heading on the first line.\n',
  });
  assert.deepEqual((await lintRepository(root)).issues, []);
});

test('the repository documentation itself lints clean', async () => {
  const { files, issues } = await lintRepository(repositoryRoot);
  assert.ok(files.length > 50, 'discovery found the repository documentation');
  assert.ok(files.includes('.github/pull_request_template.md'));
  assert.ok(!files.some((file) => file.split('/').includes('node_modules')));
  assert.deepEqual(issues, []);
});
