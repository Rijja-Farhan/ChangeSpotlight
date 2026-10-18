// Generates test/fixtures/*.diff from real git output.
// Each case builds a throwaway repo in the OS temp dir (never this repo), commits a "before"
// state, applies changes, commits again, and saves the diff between the two commits using the
// same flags the extension will pass. User git config is switched off so output is reproducible.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');

const DIFF_FLAGS = ['diff', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--find-renames'];

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

const lines = (...l) => l.map((x) => x + '\n').join('');
const ten = lines('one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten');

/** Each case: files before (path -> content), then a function that changes the repo. */
const cases = {
  'modify-line': {
    before: { 'a.txt': ten },
    change: (w) => w('a.txt', ten.replace('three', 'THREE')),
  },
  'add-lines': {
    before: { 'a.txt': ten },
    change: (w) => w('a.txt', ten.replace('five\n', 'five\nfive-a\nfive-b\n')),
  },
  'delete-lines': {
    before: { 'a.txt': ten },
    change: (w) => w('a.txt', ten.replace('four\nfive\n', '')),
  },
  'delete-first-line': {
    before: { 'a.txt': ten },
    change: (w) => w('a.txt', ten.replace('one\n', '')),
  },
  'multiple-hunks': {
    before: { 'a.txt': ten },
    change: (w) => w('a.txt', ten.replace('one', 'ONE').replace('four\n', '').replace('eight\n', 'eight\neight-a\n').replace('ten', 'TEN')),
  },
  'multiple-files': {
    before: { 'src/a.ts': ten, 'src/b.ts': ten },
    change: (w) => {
      w('src/a.ts', ten.replace('two', 'TWO'));
      w('src/b.ts', ten.replace('nine', 'NINE'));
    },
  },
  'new-file': {
    before: { 'keep.txt': 'keep\n' },
    change: (w) => w('src/new.tsx', lines('export const A = () => (', '  <div>new</div>', ')')),
  },
  'deleted-file': {
    before: { 'keep.txt': 'keep\n', 'old.txt': lines('a', 'b', 'c') },
    change: (w, rm) => rm('old.txt'),
  },
  'rename-pure': {
    before: { 'old/name.ts': ten },
    change: (w, rm) => {
      rm('old/name.ts');
      w('new/name.ts', ten);
    },
  },
  'rename-edit': {
    before: { 'old.ts': ten },
    change: (w, rm) => {
      rm('old.ts');
      w('new.ts', ten.replace('six', 'SIX'));
    },
  },
  'binary-new': {
    before: { 'keep.txt': 'keep\n' },
    change: (w) => w('img.bin', Buffer.from([0, 1, 2, 3, 0, 255])),
  },
  'binary-modified': {
    before: { 'img.bin': Buffer.from([0, 1, 2, 3]) },
    change: (w) => w('img.bin', Buffer.from([0, 1, 2, 4, 0])),
  },
  'mode-only': {
    before: { 'run.sh': 'echo hi\n' },
    change: (w, rm, git, dir) => fs.chmodSync(path.join(dir, 'run.sh'), 0o755),
  },
  'path-with-space': {
    before: { 'my file.txt': ten },
    change: (w) => w('my file.txt', ten.replace('two', 'TWO')),
  },
  'path-unicode': {
    before: { 'ünï.txt': ten },
    change: (w) => w('ünï.txt', ten.replace('two', 'TWO')),
  },
  'path-quote-tab': {
    before: { 'we"ird\tname.txt': ten },
    change: (w) => w('we"ird\tname.txt', ten.replace('two', 'TWO')),
  },
  'no-newline-at-eof': {
    before: { 'a.txt': 'one\ntwo' },
    change: (w) => w('a.txt', 'one\nTWO'),
  },
  'crlf-content': {
    before: { 'a.txt': 'one\r\ntwo\r\nthree\r\n' },
    change: (w) => w('a.txt', 'one\r\nTWO\r\nthree\r\n'),
  },
  'header-lookalike': {
    before: { 'a.md': lines('intro', '-- x', 'outro') },
    change: (w) => w('a.md', lines('intro', '++ x', 'outro')),
  },
};

function run(name, { before, change }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fixture-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' });
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };
  const remove = (file) => fs.rmSync(path.join(dir, file));
  try {
    git('init', '-q', '-b', 'main');
    for (const [file, content] of Object.entries(before)) write(file, content);
    git('add', '-A');
    git('commit', '-q', '-m', 'before');
    change(write, remove, git, dir);
    git('add', '-A');
    git('commit', '-q', '-m', 'after');
    return git(...DIFF_FLAGS, 'HEAD~1', 'HEAD');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

fs.mkdirSync(OUT, { recursive: true });
const generated = {};
for (const [name, c] of Object.entries(cases)) {
  generated[name] = run(name, c);
  fs.writeFileSync(path.join(OUT, `${name}.diff`), generated[name]);
}

// Cases git does not produce on Linux, derived deterministically:
// the whole diff text with CRLF line endings (as seen when output passes through Windows tools)…
fs.writeFileSync(path.join(OUT, 'crlf-diff-text.diff'), generated['multiple-hunks'].replace(/\n/g, '\r\n'));
// …and malformed input: the hunk header promises 2 added lines but only 1 follows.
fs.writeFileSync(
  path.join(OUT, 'malformed-count.diff'),
  lines('diff --git a/a.txt b/a.txt', 'index 0000001..0000002 100644', '--- a/a.txt', '+++ b/a.txt', '@@ -1 +1,2 @@', '-one', '+ONE', 'diff --git a/b.txt b/b.txt'),
);

console.log(`wrote ${Object.keys(cases).length + 2} fixtures to ${path.relative(process.cwd(), OUT)}`);
