// SPIKE: crude git diff reading. The real version lives in core (Phase 2) and the git layer (Phase 3).
import { execFile } from 'node:child_process';

export interface ChangedLines {
  /** Human-readable description of what we diffed against. */
  base: string;
  /** Repo-relative path (forward slashes) -> 1-based changed line numbers in the working tree. */
  files: Map<string, number[]>;
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

async function succeeds(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

export async function repoRoot(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
}

export async function changedLines(root: string): Promise<ChangedLines> {
  const diffArgs = ['diff', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
  let base: string;

  if (!(await succeeds(root, ['rev-parse', '--verify', '-q', 'HEAD']))) {
    // No commits yet: the only thing to compare is the index vs the working tree.
    base = 'no commits yet: index vs working tree (untracked files not shown)';
  } else if (await succeeds(root, ['rev-parse', '--verify', '-q', 'main'])) {
    const mergeBase = (await git(root, ['merge-base', 'main', 'HEAD'])).trim();
    diffArgs.push(mergeBase);
    base = `merge-base with main (${mergeBase.slice(0, 7)}) vs working tree (untracked files not shown)`;
  } else {
    diffArgs.push('HEAD');
    base = 'HEAD vs working tree, no main branch (untracked files not shown)';
  }

  return { base, files: parseDiff(await git(root, diffArgs)) };
}

function parseDiff(diff: string): Map<string, number[]> {
  const files = new Map<string, number[]>();
  let current: number[] | undefined;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      // "+++ /dev/null" means the file was deleted: nothing to mark.
      current = target.startsWith('b/') ? [] : undefined;
      if (current) files.set(target.slice(2), current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      // count 0 = pure deletion; there is no new line to mark, so skip it in the spike.
      for (let i = 0; i < count; i++) current.push(start + i);
    }
  }
  return files;
}
