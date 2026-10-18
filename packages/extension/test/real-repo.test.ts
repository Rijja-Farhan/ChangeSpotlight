// Read-only check against this very repository: our result must equal git's own diff.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseDiff } from '@change-spotlight/core';
import { computeChanges, DIFF_FLAGS, findRepo } from '../src/git';

describe('this repository', () => {
  it('matches git diff from the merge-base with the resolved base', async () => {
    const found = await findRepo(process.cwd());
    if (!found.ok) throw new Error(found.message);
    const result = await computeChanges(found.repo.root, '');
    if (!result.ok) throw new Error(result.message);

    const git = (...args: string[]) => execFileSync('git', args, { cwd: found.repo.root, encoding: 'utf8', maxBuffer: 64 << 20 });
    const from = result.base.kind === 'merge-base' ? result.base.mergeBase : 'HEAD';
    const tracked = result.files.slice(0, result.files.length - result.untracked.length);
    expect(tracked).toEqual(parseDiff(git(...DIFF_FLAGS, from)));
    expect(result.untracked.sort()).toEqual(git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).sort());
  });
});
