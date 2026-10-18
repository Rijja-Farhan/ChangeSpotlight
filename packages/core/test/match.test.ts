import { describe, expect, it } from 'vitest';
import { matchHunks, type Hunk } from '../src/index.js';

const change = (newStart: number, newCount: number): Hunk => ({
  oldStart: newStart, oldCount: 1, newStart, newCount, kind: 'modify', removed: ['x'], added: Array(newCount).fill('y'),
});
const deletion = (gapAfter: number): Hunk => ({
  oldStart: gapAfter + 1, oldCount: 1, newStart: gapAfter, newCount: 0, kind: 'delete', removed: ['x'], added: [],
});
const element = { path: 'a.tsx', start: 10, end: 20 };

describe('matchHunks', () => {
  it('a hunk inside the element is covered and intersecting', () => {
    const h = change(12, 3);
    expect(matchHunks(element, [h])).toEqual({ covered: [h], intersecting: [h] });
  });

  it('a hunk exactly the size of the element is covered', () => {
    const h = change(10, 11);
    expect(matchHunks(element, [h])).toEqual({ covered: [h], intersecting: [h] });
  });

  it('a hunk overlapping one edge is only intersecting', () => {
    const before = change(8, 3); // 8-10
    const after = change(20, 5); // 20-24
    expect(matchHunks(element, [before, after])).toEqual({ covered: [], intersecting: [before, after] });
  });

  it('a hunk containing the whole element is only intersecting', () => {
    const h = change(5, 30);
    expect(matchHunks(element, [h])).toEqual({ covered: [], intersecting: [h] });
  });

  it('hunks just outside the element do not match', () => {
    expect(matchHunks(element, [change(7, 3), change(21, 2)])).toEqual({ covered: [], intersecting: [] });
  });

  it('a deletion strictly inside the element counts', () => {
    const h = deletion(15);
    expect(matchHunks(element, [h])).toEqual({ covered: [h], intersecting: [h] });
  });

  it('a deletion right after the first line counts', () => {
    const h = deletion(10);
    expect(matchHunks(element, [h])).toEqual({ covered: [h], intersecting: [h] });
  });

  it('a deletion before the element, or after its last line, does not count', () => {
    expect(matchHunks(element, [deletion(9), deletion(20), deletion(25)])).toEqual({ covered: [], intersecting: [] });
  });

  it('a one-line element never contains a deletion', () => {
    expect(matchHunks({ path: 'a', start: 5, end: 5 }, [deletion(5), deletion(4)])).toEqual({ covered: [], intersecting: [] });
  });
});
