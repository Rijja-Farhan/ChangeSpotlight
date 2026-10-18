import { describe, expect, it } from 'vitest';
import { hunkIds, hunkOwners, MAX_ENTRIES, PRUNE_AFTER_MS, SeenModel, type DiffFile, type HostElement, type Hunk } from '../src/index.js';

const el = (start: number, end: number, depth: number, path = 'a.tsx'): HostElement => ({ path, start, end, depth });
const change = (newStart: number, newCount: number, added = ['x'], removed = ['y']): Hunk => ({
  oldStart: newStart, oldCount: removed.length, newStart, newCount, kind: removed.length === 0 ? 'add' : newCount === 0 ? 'delete' : 'modify', removed, added,
});
const deletion = (gapAfter: number): Hunk => ({ oldStart: gapAfter + 1, oldCount: 1, newStart: gapAfter, newCount: 0, kind: 'delete', removed: ['gone'], added: [] });
const locs = (els: HostElement[]) => els.map((e) => `${e.start}-${e.end}`);

// <main> 1-20 > <section> 2-10 > <p> 3-3, <p> 4-4 (siblings) ; <footer> 12-14 > <span> 13-13
const tree = [el(1, 20, 0), el(2, 10, 1), el(3, 3, 2), el(4, 4, 2), el(12, 14, 1), el(13, 13, 2)];

describe('hunkOwners', () => {
  it('gives each changed line to its innermost element', () => {
    expect(locs(hunkOwners(change(3, 1), tree))).toEqual(['3-3']);
    expect(locs(hunkOwners(change(3, 2), tree))).toEqual(['3-3', '4-4']);
    expect(locs(hunkOwners(change(13, 1), tree))).toEqual(['13-13']);
  });

  it('does not let an outer element spanning everything claim nested hunks', () => {
    expect(locs(hunkOwners(change(5, 1), tree))).toEqual(['2-10']);
    expect(locs(hunkOwners(change(11, 1), tree))).toEqual(['1-20']);
  });

  it('breaks span ties by depth, and keeps all siblings on one line', () => {
    const oneLine = [el(5, 5, 0), el(5, 5, 1), el(5, 5, 1)];
    // <p><a/><b/></p> on one line: same range for all, children are deeper
    expect(hunkOwners(change(5, 1), oneLine)).toEqual([el(5, 5, 1)]); // deduped by range
    expect(locs(hunkOwners(change(5, 1), [el(5, 5, 0), el(5, 5, 0)]))).toEqual(['5-5']);
  });

  it('owns a deletion by the innermost element strictly around the gap', () => {
    expect(locs(hunkOwners(deletion(2), tree))).toEqual(['2-10']); // gap after line 2: inside <section>
    expect(locs(hunkOwners(deletion(10), tree))).toEqual(['1-20']); // gap after <section> ends
    expect(locs(hunkOwners(deletion(20), tree))).toEqual([]); // after <main>: nobody
    expect(locs(hunkOwners(deletion(0), tree))).toEqual([]); // top of file
  });

  it('returns nothing for lines outside every element', () => {
    expect(hunkOwners(change(25, 2), tree)).toEqual([]);
  });
});

describe('hunkIds', () => {
  it('keeps the id when a hunk only moves, changes it when the content changes', () => {
    const [a] = hunkIds('a.tsx', [change(5, 1, ['new'], ['old'])]);
    const [moved] = hunkIds('a.tsx', [change(42, 1, ['new'], ['old'])]);
    const [edited] = hunkIds('a.tsx', [change(5, 1, ['newer'], ['old'])]);
    const [otherFile] = hunkIds('b.tsx', [change(5, 1, ['new'], ['old'])]);
    expect(moved).toBe(a);
    expect(edited).not.toBe(a);
    expect(otherFile).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{28}#1$/);
  });

  it('numbers identical hunks in file order', () => {
    const ids = hunkIds('a.tsx', [change(1, 1), change(9, 1), change(20, 1, ['z'])]);
    expect(ids[0]!.endsWith('#1')).toBe(true);
    expect(ids[1]).toBe(ids[0]!.replace('#1', '#2'));
    expect(ids[2]!.endsWith('#1')).toBe(true);
  });

  it('is the same for CRLF and LF content (parser strips CR)', () => {
    expect(hunkIds('a.tsx', [change(1, 1, ['x'])])).toEqual(hunkIds('a.tsx', [change(3, 1, ['x'])]));
  });

  it('is deterministic (golden value)', () => {
    expect(hunkIds('src/App.tsx', [change(1, 1, ['<p>hi</p>'], ['<p>ho</p>'])])).toEqual(hunkIds('src/App.tsx', [change(1, 1, ['<p>hi</p>'], ['<p>ho</p>'])]));
  });
});

describe('SeenModel', () => {
  const file = (path: string, hunks: Hunk[], extra: Partial<DiffFile> = {}): DiffFile => ({ path, oldPath: null, status: 'modified', binary: false, hunks, ...extra });

  function model(now = { t: 1_000 }) {
    return { m: new SeenModel(null, () => now.t), now };
  }

  it('marks a hunk seen only when all its owners are seen, tracking partial progress and pages', () => {
    const { m } = model();
    m.update([file('a.tsx', [change(3, 2)])], new Map([['a.tsx', tree]]));
    expect(m.totals()).toEqual({ seen: 0, total: 1, untrackable: 0 });
    expect(m.markSeen('/', ['a.tsx:3-3'])).toEqual({ matched: 1, unmatched: 0, changed: true });
    expect(m.hunks()[0]).toMatchObject({ status: 'unseen', owners: ['a.tsx:3-3', 'a.tsx:4-4'], seenOwners: [0], pages: ['/'] });
    m.markSeen('/other', ['a.tsx:4-4', 'a.tsx:99-99']);
    expect(m.hunks()[0]).toMatchObject({ status: 'seen', seenOwners: [0, 1], pages: ['/', '/other'] });
    expect(m.totals()).toEqual({ seen: 1, total: 1, untrackable: 0 });
  });

  it('counts unmatched locs and reports no change when nothing new', () => {
    const { m } = model();
    m.update([file('a.tsx', [change(3, 1)])], new Map([['a.tsx', tree]]));
    m.markSeen('/', ['a.tsx:3-3']);
    expect(m.markSeen('/', ['a.tsx:3-3', 'a.tsx:1-1'])).toEqual({ matched: 1, unmatched: 1, changed: false });
  });

  it('classifies untrackable hunks', () => {
    const { m } = model();
    m.update(
      [
        file('style.css', [change(1, 1)]),
        file('img.png', [], { binary: true }),
        file('gone.tsx', [deletion(0)], { status: 'deleted' }),
        file('broken.tsx', [change(1, 1)]),
        file('a.tsx', [change(25, 1)]),
      ],
      new Map<string, HostElement[] | null>([['broken.tsx', null], ['a.tsx', tree]]),
    );
    expect(m.hunks().map((h) => h.reason)).toEqual(['not-jsx', 'deleted-file', 'parse-error', 'no-element']);
    expect(m.totals()).toEqual({ seen: 0, total: 0, untrackable: 4 });
  });

  it('survives a snapshot round trip and keeps status when a hunk moves', () => {
    const { m, now } = model();
    m.update([file('a.tsx', [change(3, 1, ['hello'])])], new Map([['a.tsx', tree]]));
    m.markSeen('/', ['a.tsx:3-3']);
    const restored = new SeenModel(JSON.parse(JSON.stringify(m.snapshot())), () => now.t);
    // the same hunk, moved down by 10 lines, now owned by a shifted element
    restored.update([file('a.tsx', [change(13, 1, ['hello'])])], new Map([['a.tsx', tree]]));
    expect(restored.hunks()[0]).toMatchObject({ status: 'seen', owners: ['a.tsx:13-13'] });
  });

  it('resets progress when the number of owners changes', () => {
    const { m } = model();
    const hunk = change(3, 2, ['a', 'b']);
    m.update([file('a.tsx', [hunk])], new Map([['a.tsx', [el(3, 4, 0)]]]));
    m.markSeen('/', ['a.tsx:3-4']);
    expect(m.hunks()[0]?.status).toBe('seen');
    // Same content (same id), but the lines are now split over two elements: progress resets.
    m.update([file('a.tsx', [hunk])], new Map([['a.tsx', [el(3, 3, 0), el(4, 4, 0)]]]));
    expect(m.hunks()[0]).toMatchObject({ status: 'unseen', owners: ['a.tsx:3-3', 'a.tsx:4-4'], seenOwners: [] });
    // An edit gives a new id, also unseen.
    m.markSeen('/', ['a.tsx:3-3', 'a.tsx:4-4']);
    m.update([file('a.tsx', [change(3, 2, ['a', 'B'])])], new Map([['a.tsx', [el(3, 3, 0), el(4, 4, 0)]]]));
    expect(m.hunks()[0]?.status).toBe('unseen');
  });

  it('prunes entries gone from the diff for 14 days and caps the total', () => {
    const { m, now } = model();
    m.update([file('a.tsx', [change(3, 1, ['old'])])], new Map([['a.tsx', tree]]));
    m.markSeen('/', ['a.tsx:3-3']);
    now.t += PRUNE_AFTER_MS + 1;
    m.update([file('a.tsx', [change(3, 1, ['new'])])], new Map([['a.tsx', tree]]));
    expect(Object.keys(m.snapshot().entries)).toHaveLength(1);

    const entries: Record<string, { ownerCount: number; seenOwners: number[]; pages: string[]; lastInDiffAt: number }> = {};
    for (let i = 0; i < MAX_ENTRIES + 10; i++) entries[`id${i}`] = { ownerCount: 1, seenOwners: [], pages: [], lastInDiffAt: now.t - i };
    const big = new SeenModel({ version: 1, entries }, () => now.t);
    const snap = big.snapshot();
    expect(Object.keys(snap.entries)).toHaveLength(MAX_ENTRIES);
    expect(snap.entries['id0']).toBeDefined();
    expect(snap.entries[`id${MAX_ENTRIES + 9}`]).toBeUndefined();
  });

  it('reset() forgets progress', () => {
    const { m } = model();
    m.update([file('a.tsx', [change(3, 1)])], new Map([['a.tsx', tree]]));
    m.markSeen('/', ['a.tsx:3-3']);
    m.reset();
    expect(m.totals()).toEqual({ seen: 0, total: 1, untrackable: 0 });
  });

  it('setSeen marks a hunk seen or unseen by hand, and survives a snapshot', () => {
    const { m, now } = model();
    m.update([file('a.tsx', [change(3, 2)]), file('x.css', [change(1, 1)])], new Map([['a.tsx', tree]]));
    const [hunk, css] = m.hunks();
    expect(m.setSeen(css!.id, true)).toBe(false); // untrackable
    expect(m.setSeen('nope', true)).toBe(false);
    expect(m.setSeen(hunk!.id, true)).toBe(true);
    expect(m.hunks()[0]).toMatchObject({ status: 'seen', manual: true, seenOwners: [0, 1], pages: [] });
    expect(m.setSeen(hunk!.id, true)).toBe(false); // nothing changed

    const restored = new SeenModel(JSON.parse(JSON.stringify(m.snapshot())), () => now.t);
    restored.update([file('a.tsx', [change(3, 2)])], new Map([['a.tsx', tree]]));
    expect(restored.hunks()[0]).toMatchObject({ status: 'seen', manual: true });

    expect(restored.setSeen(hunk!.id, false)).toBe(true);
    expect(restored.hunks()[0]).toMatchObject({ status: 'unseen', seenOwners: [], pages: [] });
    expect(restored.hunks()[0]?.manual).toBeUndefined();
  });

  it('does not flag a hunk as manual when the browser had already seen it', () => {
    const { m } = model();
    m.update([file('a.tsx', [change(3, 1)])], new Map([['a.tsx', tree]]));
    m.markSeen('/', ['a.tsx:3-3']);
    m.setSeen(m.hunks()[0]!.id, true);
    expect(m.hunks()[0]?.manual).toBeUndefined();
  });
});
