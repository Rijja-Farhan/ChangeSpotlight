// Whole seen flow on a throwaway repo: real git diff, real element collection, simulated browser.
import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { computeChanges, type GitExec } from '../src/git';
import { SeenController, type SeenState } from '../src/seenController';
import { SeenStore } from '../src/seenStore';
import { memento } from './memento';
import { hermeticEnv, makeRepo, type TempRepo } from './tempRepo';

const exec: GitExec = (args, cwd) =>
  new Promise((resolve, reject) =>
    execFile('git', args, { cwd, env: { ...hermeticEnv, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => {
      if (!err) return resolve({ stdout, code: 0 });
      const code = (err as { code?: unknown }).code;
      return typeof code === 'number' ? resolve({ stdout, code }) : reject(err);
    }),
  );

const app = (pText: string, prefix = '') =>
  `${prefix}export const App = () => (\n  <main>\n    <h1>Title</h1>\n    <p>${pText}</p>\n  </main>\n)\n`;

let repo: TempRepo;
afterEach(() => repo?.cleanup());

function setup(store = memento()) {
  const logs: string[] = [];
  let last: SeenState | undefined;
  const controller = new SeenController(new SeenStore(store), (m) => logs.push(m), (s) => (last = s));
  const refresh = async () => controller.applyResult(await computeChanges(repo.dir, '', exec));
  return { controller, logs, store, refresh, state: () => last! };
}

function featureRepo() {
  repo = makeRepo();
  repo.write('src/App.tsx', app('Text'));
  repo.write('src/util.ts', 'export const x = 1\n');
  repo.write('src/style.css', 'p { color: red }\n');
  repo.commitAll('base');
  repo.git('switch', '-q', '-c', 'feature');
  repo.write('src/App.tsx', app('New text'));
  repo.write('src/util.ts', 'export const x = 2\n');
  repo.write('src/style.css', 'p { color: blue }\n');
}

describe('seen flow', () => {
  it('counts trackable changes, marks them seen, survives moves and resets on edits', async () => {
    featureRepo();
    const { controller, refresh, state, logs } = setup();
    await refresh();
    expect(state().totals).toEqual({ seen: 0, total: 1, untrackable: 2 });
    expect(state().hunks.filter((h) => h.status === 'untrackable').map((h) => h.reason)).toEqual(['not-jsx', 'not-jsx']);

    await controller.visibility('/', ['src/App.tsx:2-5', 'src/App.tsx:3-3', 'src/App.tsx:4-4'], false);
    expect(state().totals.seen).toBe(1);
    expect(state().hunks.find((h) => h.status === 'seen')?.pages).toEqual(['/']);

    // Insert lines above: the hunk moves but keeps its seen status.
    repo.write('src/App.tsx', app('New text', '// one\n// two\n'));
    await refresh();
    const moved = state().hunks.find((h) => h.path === 'src/App.tsx' && h.hunk.added.includes('    <p>New text</p>'));
    expect(moved).toMatchObject({ status: 'seen', owners: ['src/App.tsx:6-6'] });

    // A report with the old line numbers is outdated and ignored.
    logs.length = 0;
    await controller.visibility('/', ['src/App.tsx:4-4'], false);
    expect(logs).toEqual(['Ignored 1 seen element(s) on / with outdated line numbers (page not reloaded yet?).']);

    // Editing the changed line makes it unseen again.
    repo.write('src/App.tsx', app('Newer text', '// one\n// two\n'));
    await refresh();
    expect(state().hunks.find((h) => h.hunk.added.includes('    <p>Newer text</p>'))?.status).toBe('unseen');
    expect(logs.at(-1)).toMatch(/^Seen 0 of 1 changes/);
  });

  it('keeps progress across a restart and separates branches', async () => {
    featureRepo();
    const store = memento();
    const first = setup(store);
    await first.refresh();
    await first.controller.visibility('/', ['src/App.tsx:4-4'], false);
    expect(first.state().totals.seen).toBe(1);

    const restarted = setup(store);
    await restarted.refresh();
    expect(restarted.state().totals.seen).toBe(1);

    repo.git('switch', '-q', '-c', 'other');
    await restarted.refresh();
    expect(restarted.state()).toMatchObject({ branch: 'other', totals: { seen: 0, total: 1 } });

    repo.git('switch', '-q', 'feature');
    await restarted.refresh();
    expect(restarted.state()).toMatchObject({ branch: 'feature', totals: { seen: 1 } });
  });

  it('holds reports back while git results are about to change', async () => {
    featureRepo();
    const { controller, refresh, state } = setup();
    await refresh();
    // Save shifts the line; the browser reports the new numbers before our recompute ran.
    repo.write('src/App.tsx', app('New text', '// one\n'));
    await controller.visibility('/', ['src/App.tsx:5-5'], true);
    expect(state().totals.seen).toBe(0);
    await refresh();
    expect(state().totals.seen).toBe(1);
  });

  it('reset clears the branch progress', async () => {
    featureRepo();
    const { controller, refresh, state, store } = setup();
    await refresh();
    await controller.visibility('/', ['src/App.tsx:4-4'], false);
    await controller.reset();
    expect(state().totals.seen).toBe(0);
    expect([...store.data.keys()]).toEqual([]);
  });

  it('leaves excluded files out of the count, and counts them again once the pattern is gone', async () => {
    featureRepo();
    repo.write('src/App.test.tsx', app('Test'));
    const { controller, state } = setup();
    const changes = await computeChanges(repo.dir, '', exec);

    await controller.applyResult(changes, ['**/*.test.*', 'src/App.tsx']);
    expect(state().totals).toEqual({ seen: 0, total: 0, untrackable: 4 });
    expect(state().hunks.filter((h) => h.reason === 'excluded').map((h) => h.path)).toEqual(['src/App.tsx', 'src/App.test.tsx']); // untracked files come last

    await controller.applyResult(changes, ['**/*.test.*']);
    expect(state().totals).toEqual({ seen: 0, total: 1, untrackable: 3 });
  });
});
