// The extension's git layer. No `vscode` import here, so Vitest can test it against real repos.
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { addedFileDiff, DiffParseError, isBinaryContent, normalizePath, parseDiff, type DiffFile } from '@change-spotlight/core';

export interface ExecResult {
  stdout: string;
  /** Exit code; 0 means success. */
  code: number;
}

/** Runs git with `args` in `cwd`. Rejects only when git itself cannot run (e.g. not installed). */
export type GitExec = (args: string[], cwd: string) => Promise<ExecResult>;

export const MAX_OUTPUT = 64 * 1024 * 1024;
export const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;

/** Error codes the default exec reports when git could not produce its output. */
export class GitExecError extends Error {
  constructor(
    message: string,
    readonly kind: 'git-missing' | 'too-large' | 'other',
  ) {
    super(message);
  }
}

export const defaultExec: GitExec = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      // GIT_OPTIONAL_LOCKS=0: our reads never refresh .git/index, so they can't trigger our own index watcher.
      { cwd, maxBuffer: MAX_OUTPUT, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, encoding: 'utf8' },
      (err, stdout) => {
        if (!err) return resolve({ stdout, code: 0 });
        const e = err as NodeJS.ErrnoException & { code?: unknown };
        if (e.code === 'ENOENT') return reject(new GitExecError('git is not installed or not on PATH', 'git-missing'));
        if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(new GitExecError('git output too large', 'too-large'));
        if (typeof e.code === 'number') return resolve({ stdout, code: e.code });
        reject(new GitExecError(e.message, 'other'));
      },
    );
  });

// ---------------------------------------------------------------------------------------------
// Repository

export interface RepoInfo {
  /** Absolute repo root (work tree top level). */
  root: string;
  /** Absolute per-worktree git dir (holds HEAD, index, logs/HEAD). */
  gitDir: string;
  /** Absolute shared git dir (refs, objects). Same as gitDir outside worktrees. */
  commonDir: string;
}

export type RepoResult = { ok: true; repo: RepoInfo } | { ok: false; reason: 'git-missing' | 'not-a-repo'; message: string };

export async function findRepo(cwd: string, exec: GitExec = defaultExec): Promise<RepoResult> {
  try {
    const r = await exec(['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], cwd);
    const [root, gitDir, commonDir] = r.stdout.split('\n');
    if (r.code !== 0 || !root || !gitDir || !commonDir) {
      return { ok: false, reason: 'not-a-repo', message: `${cwd} is not inside a git work tree` };
    }
    return { ok: true, repo: { root, gitDir, commonDir } };
  } catch (err) {
    if (err instanceof GitExecError && err.kind === 'git-missing') return { ok: false, reason: 'git-missing', message: err.message };
    return { ok: false, reason: 'not-a-repo', message: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------------------------
// Base

export const AUTO_BASES = ['refs/heads/main', 'refs/heads/master', 'refs/remotes/origin/main', 'refs/remotes/origin/master'];

export type BaseInfo =
  | {
      kind: 'merge-base';
      /** The base ref as found, e.g. "refs/heads/main" or the configured "origin/develop". */
      ref: string;
      /** Commit the base ref points at. */
      sha: string;
      /** Merge-base of HEAD and the base: the diff starts here. */
      mergeBase: string;
      detached: boolean;
      /** HEAD is the base itself (merge-base == HEAD): only uncommitted work shows. */
      onBase: boolean;
    }
  | { kind: 'head'; reason: 'base-not-found' | 'no-merge-base'; ref?: string; shallow: boolean }
  | { kind: 'empty-tree'; reason: 'no-commits' };

async function revParse(exec: GitExec, root: string, rev: string): Promise<string | null> {
  const r = await exec(['rev-parse', '--verify', '-q', `${rev}^{commit}`], root);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** Short display name: "refs/heads/main" -> "main", "refs/remotes/origin/main" -> "origin/main". */
export function shortRef(ref: string): string {
  return ref.replace(/^refs\/(heads|remotes)\//, '');
}

export async function resolveBase(root: string, configured: string, exec: GitExec = defaultExec): Promise<BaseInfo> {
  const head = await revParse(exec, root, 'HEAD');
  if (!head) return { kind: 'empty-tree', reason: 'no-commits' };

  const shallow = async () => (await exec(['rev-parse', '--is-shallow-repository'], root)).stdout.trim() === 'true';
  const candidates = configured.trim() ? [configured.trim()] : AUTO_BASES;

  let ref: string | undefined;
  let sha: string | null = null;
  for (const candidate of candidates) {
    sha = await revParse(exec, root, candidate);
    if (sha) {
      ref = candidate;
      break;
    }
  }
  if (!ref || !sha) {
    return { kind: 'head', reason: 'base-not-found', ...(configured.trim() ? { ref: configured.trim() } : {}), shallow: await shallow() };
  }

  const mb = await exec(['merge-base', sha, head], root);
  const mergeBase = mb.code === 0 ? mb.stdout.trim() : '';
  if (!mergeBase) return { kind: 'head', reason: 'no-merge-base', ref, shallow: await shallow() };

  const symbolic = await exec(['symbolic-ref', '-q', 'HEAD'], root);
  return { kind: 'merge-base', ref, sha, mergeBase, detached: symbolic.code !== 0, onBase: mergeBase === head };
}

// ---------------------------------------------------------------------------------------------
// Changes

export const DIFF_FLAGS = [
  'diff',
  '-U0',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--no-relative',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '--find-renames',
];

export type ChangeResult =
  | {
      ok: true;
      root: string;
      base: BaseInfo;
      /** Tracked changes followed by untracked files (status 'added'). */
      files: DiffFile[];
      untracked: string[];
      skipped: { path: string; reason: 'too-large' }[];
    }
  | { ok: false; reason: 'git-missing' | 'not-a-repo' | 'diff-too-large' | 'git-error'; message: string };

async function emptyTree(exec: GitExec, root: string): Promise<string> {
  // Well-known id, but ask git so SHA-256 repos work too.
  const r = await exec(['hash-object', '-t', 'tree', '/dev/null'], root);
  return r.stdout.trim() || '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
}

/** Diff from the base (merge-base, HEAD or empty tree) to the working tree, plus untracked files. */
export async function computeChanges(root: string, configured: string, exec: GitExec = defaultExec): Promise<ChangeResult> {
  try {
    const base = await resolveBase(root, configured, exec);
    const from = base.kind === 'merge-base' ? base.mergeBase : base.kind === 'head' ? 'HEAD' : await emptyTree(exec, root);

    const diff = await exec([...DIFF_FLAGS, from], root);
    if (diff.code !== 0) return { ok: false, reason: 'git-error', message: `git diff exited with ${diff.code}` };
    const files = parseDiff(diff.stdout);

    const listing = await exec(['ls-files', '--others', '--exclude-standard', '-z', '--full-name'], root);
    if (listing.code !== 0) return { ok: false, reason: 'git-error', message: `git ls-files exited with ${listing.code}` };
    const untracked: string[] = [];
    const skipped: { path: string; reason: 'too-large' }[] = [];

    for (const rel of listing.stdout.split('\0').filter(Boolean)) {
      const abs = path.join(root, rel);
      try {
        const info = await stat(abs);
        if (!info.isFile()) continue;
        if (info.size > MAX_UNTRACKED_BYTES) {
          skipped.push({ path: normalizePath(rel), reason: 'too-large' });
          continue;
        }
        const bytes = await readFile(abs);
        files.push(addedFileDiff(rel, isBinaryContent(bytes) ? null : bytes.toString('utf8')));
        untracked.push(normalizePath(rel));
      } catch {
        // Deleted between ls-files and now: nothing to show.
      }
    }
    return { ok: true, root, base, files, untracked, skipped };
  } catch (err) {
    if (err instanceof GitExecError) {
      if (err.kind === 'git-missing') return { ok: false, reason: 'git-missing', message: err.message };
      if (err.kind === 'too-large') return { ok: false, reason: 'diff-too-large', message: `diff is larger than ${MAX_OUTPUT / 1024 / 1024} MiB` };
    }
    if (err instanceof DiffParseError) return { ok: false, reason: 'git-error', message: `could not read git diff output: ${err.message}` };
    return { ok: false, reason: 'git-error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** One plain-language line describing the base, for the Output channel. */
export function describeBase(base: BaseInfo): string {
  switch (base.kind) {
    case 'merge-base': {
      const name = shortRef(base.ref);
      if (base.onBase) return `on ${name} itself: showing uncommitted and untracked changes only`;
      return `merge-base with ${name} (${base.mergeBase.slice(0, 7)})${base.detached ? ', detached HEAD' : ''}`;
    }
    case 'head': {
      const hint = base.shallow ? ' Shallow clone: try `git fetch --unshallow`.' : '';
      if (base.reason === 'base-not-found') {
        const what = base.ref ? `Configured base "${base.ref}" not found` : 'No main/master/origin/main/origin/master found';
        return `${what}; showing uncommitted changes vs HEAD. Set changeSpotlight.baseBranch to choose a base.${hint}`;
      }
      return `${shortRef(base.ref ?? '')} shares no history with HEAD; showing uncommitted changes vs HEAD.${hint}`;
    }
    case 'empty-tree':
      return 'no commits yet: every file counts as new';
  }
}
