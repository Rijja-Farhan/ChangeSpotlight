import { afterEach, describe, expect, it } from 'vitest';
import { parseDiff } from '@change-spotlight/core';
import { computeChanges, DIFF_FLAGS, findRepo, MAX_UNTRACKED_BYTES, resolveBase, type GitExec } from '../src/git';
import { hermeticEnv, makeRepo, ten, type TempRepo } from './tempRepo';
import { execFile } from 'node:child_process';

// Run the code under test with the hermetic env too, so the developer's own git config can't leak in.
const exec: GitExec = (args, cwd) =>
  new Promise((resolve, reject) =>
    execFile('git', args, { cwd, env: { ...hermeticEnv, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 64 << 20 }, (err, stdout) => {
      if (!err) return resolve({ stdout, code: 0 });
      const code = (err as { code?: unknown }).code;
      return typeof code === 'number' ? resolve({ stdout, code }) : reject(err);
    }),
  );

const repos: TempRepo[] = [];
function repo(options?: Parameters<typeof makeRepo>[0]): TempRepo {
  const r = makeRepo(options);
  repos.push(r);
  return r;
}
afterEach(() => {
  while (repos.length) repos.pop()!.cleanup();
});

/** A repo whose main has one commit, with a feature branch checked out. */
function featureRepo(): TempRepo {
  const r = repo();
  r.write('a.txt', ten);
  r.commitAll('base');
  r.git('switch', '-q', '-c', 'feature');
  return r;
}

describe('findRepo', () => {
  it('finds root and git dirs from a subfolder', async () => {
    const r = featureRepo();
    r.write('sub/x.txt', 'x\n');
    const found = await findRepo(`${r.dir}/sub`, exec);
    expect(found).toEqual({ ok: true, repo: { root: r.dir, gitDir: `${r.dir}/.git`, commonDir: `${r.dir}/.git` } });
  });

  it('reports a folder outside any repo', async () => {
    const r = repo({ init: false });
    expect(await findRepo(r.dir, exec)).toMatchObject({ ok: false, reason: 'not-a-repo' });
  });

  it('uses the per-worktree git dir in a linked worktree', async () => {
    const r = featureRepo();
    const wt = `${r.dir}-wt`;
    r.git('worktree', 'add', '-q', wt, 'main');
    try {
      const found = await findRepo(wt, exec);
      expect(found).toEqual({ ok: true, repo: { root: wt, gitDir: `${r.dir}/.git/worktrees/${wt.split('/').pop()}`, commonDir: `${r.dir}/.git` } });
    } finally {
      r.git('worktree', 'remove', '--force', wt);
    }
  });
});

describe('resolveBase', () => {
  it('uses main and its merge-base', async () => {
    const r = featureRepo();
    const mainSha = r.git('rev-parse', 'main').trim();
    r.write('a.txt', ten + 'more\n');
    r.commitAll('feature work');
    expect(await resolveBase(r.dir, '', exec)).toEqual({
      kind: 'merge-base', ref: 'refs/heads/main', sha: mainSha, mergeBase: mainSha, detached: false, onBase: false,
    });
  });

  it('falls back to master', async () => {
    const r = repo({ branch: 'master' });
    r.commitAll('base');
    r.git('switch', '-q', '-c', 'feature');
    expect(await resolveBase(r.dir, '', exec)).toMatchObject({ kind: 'merge-base', ref: 'refs/heads/master' });
  });

  it('falls back to origin/main, and prefers local main when both exist', async () => {
    const remote = repo();
    remote.write('a.txt', ten);
    remote.commitAll('base');
    const clone = repo({ init: false });
    clone.git('clone', '-q', remote.dir, '.');
    clone.git('switch', '-q', '-c', 'feature');
    expect(await resolveBase(clone.dir, '', exec)).toMatchObject({ ref: 'refs/heads/main' });
    clone.git('branch', '-q', '-D', 'main');
    expect(await resolveBase(clone.dir, '', exec)).toMatchObject({ kind: 'merge-base', ref: 'refs/remotes/origin/main' });
  });

  it('uses a configured base alone', async () => {
    const r = featureRepo();
    r.commitAll('one');
    const dev = r.git('rev-parse', 'HEAD').trim();
    r.git('branch', 'develop');
    r.commitAll('two');
    expect(await resolveBase(r.dir, 'develop', exec)).toMatchObject({ kind: 'merge-base', ref: 'develop', mergeBase: dev });
  });

  it('does not fall back when the configured base is missing', async () => {
    const r = featureRepo();
    expect(await resolveBase(r.dir, 'nope', exec)).toEqual({ kind: 'head', reason: 'base-not-found', ref: 'nope', shallow: false });
  });

  it('reports base-not-found when no default branch exists', async () => {
    const r = repo({ branch: 'trunk' });
    r.commitAll('base');
    expect(await resolveBase(r.dir, '', exec)).toEqual({ kind: 'head', reason: 'base-not-found', shallow: false });
  });

  it('handles a repo with no commits', async () => {
    const r = repo();
    expect(await resolveBase(r.dir, '', exec)).toEqual({ kind: 'empty-tree', reason: 'no-commits' });
  });

  it('handles a detached HEAD', async () => {
    const r = featureRepo();
    r.commitAll('feature');
    r.git('switch', '-q', '--detach', 'HEAD');
    expect(await resolveBase(r.dir, '', exec)).toMatchObject({ kind: 'merge-base', detached: true, onBase: false });
  });

  it('marks being on the base branch itself', async () => {
    const r = repo();
    r.commitAll('base');
    expect(await resolveBase(r.dir, '', exec)).toMatchObject({ kind: 'merge-base', onBase: true });
  });

  it('reports unrelated histories', async () => {
    const r = repo();
    r.commitAll('base');
    r.git('switch', '-q', '--orphan', 'other');
    r.commitAll('unrelated');
    expect(await resolveBase(r.dir, '', exec)).toEqual({ kind: 'head', reason: 'no-merge-base', ref: 'refs/heads/main', shallow: false });
  });
});

describe('computeChanges', () => {
  const reference = (r: TempRepo, from: string) => parseDiff(r.git(...DIFF_FLAGS, from));

  it('matches git diff from the merge-base for committed, staged and unstaged edits', async () => {
    const r = featureRepo();
    r.write('a.txt', ten.replace('line 2', 'LINE 2'));
    r.write('b.txt', 'b\n');
    r.commitAll('committed');
    r.write('a.txt', ten.replace('line 2', 'LINE 2').replace('line 5', 'LINE 5'));
    r.git('add', 'a.txt');
    r.write('a.txt', ten.replace('line 2', 'LINE 2').replace('line 5', 'LINE 5').replace('line 9\n', ''));
    r.git('mv', 'b.txt', 'c.txt');

    const result = await computeChanges(r.dir, '', exec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mergeBase = r.git('merge-base', 'main', 'HEAD').trim();
    expect(result.files).toEqual(reference(r, mergeBase));
    expect(result.files.map((f) => f.path)).toEqual(['a.txt', 'c.txt']);
    expect(result.untracked).toEqual([]);
  });

  it('describes untracked files exactly like git diff --no-index does', async () => {
    const r = featureRepo();
    const files: Record<string, string | Uint8Array> = {
      'plain.txt': 'one\ntwo\n',
      'crlf.txt': 'one\r\ntwo\r\n',
      'no-eol.txt': 'one\ntwo',
      'empty.txt': '',
      'bin.dat': new Uint8Array([1, 0, 2]),
      'with space.txt': 'x\n',
      'nested/dir/deep.tsx': '<div />\n',
    };
    for (const [file, content] of Object.entries(files)) r.write(file, content);

    const result = await computeChanges(r.dir, '', exec);
    if (!result.ok) throw new Error(result.message);
    expect(result.untracked.sort()).toEqual(Object.keys(files).sort());
    for (const file of Object.keys(files)) {
      const [expected] = parseDiff(r.gitAllowFail(...DIFF_FLAGS, '--no-index', '/dev/null', file));
      // git diff --no-index prints no header at all for an empty file
      const actual = result.files.find((f) => f.path === file);
      if (file === 'empty.txt') expect(actual).toMatchObject({ status: 'added', hunks: [] });
      else expect(actual).toEqual(expected);
    }
  });

  it('skips untracked files over the size limit', async () => {
    const r = featureRepo();
    r.write('big.txt', 'x'.repeat(MAX_UNTRACKED_BYTES + 1));
    const result = await computeChanges(r.dir, '', exec);
    expect(result).toMatchObject({ ok: true, untracked: [], skipped: [{ path: 'big.txt', reason: 'too-large' }] });
  });

  it('ignores git-ignored files', async () => {
    const r = featureRepo();
    r.write('.gitignore', 'dist/\n');
    r.commitAll('ignore');
    r.write('dist/out.js', 'x\n');
    const result = await computeChanges(r.dir, '', exec);
    expect(result).toMatchObject({ ok: true, untracked: [] });
  });

  it('shows everything as new in a repo without commits', async () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    r.write('b.txt', 'b\n');
    r.git('add', 'a.txt');
    const result = await computeChanges(r.dir, '', exec);
    if (!result.ok) throw new Error(result.message);
    expect(result.base).toEqual({ kind: 'empty-tree', reason: 'no-commits' });
    expect(result.files.map((f) => [f.path, f.status])).toEqual([['a.txt', 'added'], ['b.txt', 'added']]);
  });

  it('is not affected by repo-local git config that would change the diff format', async () => {
    const r = featureRepo();
    r.write('a.txt', ten.replace('line 3', 'LINE 3'));
    r.git('mv', 'a.txt', 'renamed.txt');
    const clean = await computeChanges(r.dir, '', exec);
    for (const [k, v] of [
      ['diff.noprefix', 'true'],
      ['diff.mnemonicPrefix', 'true'],
      ['diff.relative', 'true'],
      ['color.diff', 'always'],
      ['color.ui', 'always'],
      ['diff.renames', 'false'],
      ['diff.external', 'false'],
      ['core.quotePath', 'false'],
    ]) r.git('config', k!, v!);
    expect(await computeChanges(r.dir, '', exec)).toEqual(clean);
  });
});
