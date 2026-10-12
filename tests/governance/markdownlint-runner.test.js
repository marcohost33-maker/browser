// docs:lint runner: discovery must lint exactly the files the previous
// markdownlint-cli2 configuration linted, the configuration must actually be
// applied, and a violation must fail the run (a gate that cannot fail proves
// nothing).

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CONFIG_FILE,
  findMarkdownFiles,
  lintRepository,
  main,
  MarkdownDiscoveryError,
  readLintConfig,
  stripJsonComments,
} from '../../scripts/markdownlint.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const RUNNER = path.join(repositoryRoot, 'scripts', 'markdownlint.js');

// Creates a symlink, or on Windows without the symlink privilege a directory
// junction (which Node also reports as a symbolic link). Returns false when the
// platform can create neither, so the caller skips instead of passing vacuously.
async function link(target, linkPath, kind) {
  try {
    await symlink(target, linkPath, kind);
    return true;
  } catch (error) {
    if (error?.code !== 'EPERM' || process.platform !== 'win32') throw error;
    if (kind !== 'dir') return false;
    await symlink(path.resolve(path.dirname(linkPath), target), linkPath, 'junction');
    return true;
  }
}

function runCli(root) {
  return spawnSync(process.execPath, [RUNNER, root], { encoding: 'utf8' });
}

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

test('a violation is reported by lintRepository with file, line and rule', async () => {
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

test('the CLI exits 1 on a rule violation, 0 on a clean tree (actual process exit)', async () => {
  const violating = await fixture({ 'README.md': '# Root\n\n## Heading\nno blank line after the heading\n' });
  const failed = runCli(violating);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /^README\.md:3 MD022\/blanks-around-headings /m);
  assert.equal(await main(violating), 1);

  const clean = await fixture({ 'README.md': '# Root\n\nText.\n' });
  const passed = runCli(clean);
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, /markdownlint: 1 files, 0 issues/);
});

test('a symlinked Markdown file fails discovery instead of being skipped', async (t) => {
  const root = await fixture({ 'README.md': '# Root\n', 'docs/real.md': '# Real\n' });
  if (!await link('real.md', path.join(root, 'docs', 'alias.md'), 'file')) {
    t.skip('file symlinks need the Windows symlink privilege; covered on Linux CI');
    return;
  }
  await assert.rejects(findMarkdownFiles(root), (error) => error instanceof MarkdownDiscoveryError
    && error.code === 'SYMLINK_IN_MARKDOWN_DISCOVERY'
    && error.path === 'docs/alias.md');
});

test('a symlinked directory fails discovery and the CLI exits 2 naming it', async () => {
  const root = await fixture({ 'README.md': '# Root\n', 'real/inner.md': '# Inner\n' });
  assert.ok(await link('real', path.join(root, 'linked'), 'dir'));
  await assert.rejects(findMarkdownFiles(root), (error) => error instanceof MarkdownDiscoveryError
    && error.code === 'SYMLINK_IN_MARKDOWN_DISCOVERY'
    && error.path === 'linked');
  const cli = runCli(root);
  assert.equal(cli.status, 2, cli.stdout + cli.stderr);
  assert.match(cli.stderr, /SYMLINK_IN_MARKDOWN_DISCOVERY: linked/);
});

test('a FIFO named *.md fails discovery instead of being skipped', async (t) => {
  // Windows has no FIFOs; an MSYS `mkfifo` there emulates one with a regular file.
  if (process.platform === 'win32') {
    t.skip('no FIFOs on Windows; covered on Linux CI');
    return;
  }
  const root = await fixture({ 'README.md': '# Root\n' });
  const made = spawnSync('mkfifo', [path.join(root, 'pipe.md')]);
  assert.equal(made.status, 0, `mkfifo failed: ${made.error?.message ?? made.stderr}`);
  await assert.rejects(findMarkdownFiles(root), (error) => error instanceof MarkdownDiscoveryError
    && error.code === 'UNSUPPORTED_ENTRY_IN_MARKDOWN_DISCOVERY'
    && error.path === 'pipe.md');
});

test('a symlinked node_modules or .git is still skipped by name', async () => {
  const root = await fixture({ 'README.md': '# Root\n', 'vendor/pkg/README.md': '#bad\n' });
  assert.ok(await link('vendor', path.join(root, 'node_modules'), 'dir'));
  await mkdir(path.join(root, 'sub'));
  assert.ok(await link(path.join('..', 'vendor'), path.join(root, 'sub', '.git'), 'dir'));
  assert.deepEqual(await findMarkdownFiles(root), ['README.md', 'vendor/pkg/README.md']);
});

// Binds the "every *.md" coverage claim to the repository itself instead of a
// one-off count: each Markdown file git tracks must be among the linted files.
test('discovery covers every Markdown file git tracks', async () => {
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--', '*.md'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).split('\0').filter(Boolean);
  assert.ok(tracked.length > 0, 'git ls-files returned no Markdown file');
  const discovered = await findMarkdownFiles(repositoryRoot);
  assert.equal(new Set(discovered).size, discovered.length, 'discovery lists a file twice');
  const missing = tracked.filter((file) => !discovered.includes(file));
  assert.deepEqual(missing, [], 'tracked Markdown files the runner does not lint');
});

test('the repository documentation itself lints clean', async () => {
  const { files, issues } = await lintRepository(repositoryRoot);
  assert.ok(files.length > 50, 'discovery found the repository documentation');
  assert.ok(files.includes('.github/pull_request_template.md'));
  assert.ok(!files.some((file) => file.split('/').includes('node_modules')));
  assert.deepEqual(issues, []);
});
