import { describe, expect, it } from 'vitest';
import { decorationRanges } from '../src/decorations';
import { hunk, status } from './fixtures';

describe('decorationRanges', () => {
  it('covers each hunk\'s new lines with its status style, merged', () => {
    const marks = decorationRanges([
      status('a', 'a.tsx', hunk(3, 2)),
      status('b', 'a.tsx', hunk(5, 1)),
      status('c', 'a.tsx', hunk(10, 1), { status: 'seen' }),
      status('d', 'x.css', hunk(1, 3), { status: 'untrackable', reason: 'not-jsx' }),
    ]);
    expect(marks.get('a.tsx')).toEqual({ unseen: [{ start: 3, end: 5 }], seen: [{ start: 10, end: 10 }], untrackable: [] });
    expect(marks.get('x.css')).toEqual({ unseen: [], seen: [], untrackable: [{ start: 1, end: 3 }] });
  });

  it('marks the line above a deletion, or line 1 at the top of the file', () => {
    const marks = decorationRanges([status('a', 'a.tsx', hunk(7, 0, [], ['gone'])), status('b', 'b.tsx', hunk(0, 0, [], ['gone']))]);
    expect(marks.get('a.tsx')?.unseen).toEqual([{ start: 7, end: 7 }]);
    expect(marks.get('b.tsx')?.unseen).toEqual([{ start: 1, end: 1 }]);
  });

  it('gives a shared line one style: unseen beats seen beats untrackable', () => {
    const marks = decorationRanges([
      status('s', 'a.tsx', hunk(4, 1), { status: 'seen' }),
      status('d', 'a.tsx', hunk(4, 0, [], ['x']), { status: 'unseen' }),
      status('u', 'a.tsx', hunk(8, 1), { status: 'untrackable', reason: 'no-element' }),
      status('s2', 'a.tsx', hunk(8, 0, [], ['y']), { status: 'seen' }),
    ]);
    expect(marks.get('a.tsx')).toEqual({ unseen: [{ start: 4, end: 4 }], seen: [{ start: 8, end: 8 }], untrackable: [] });
  });

  it('draws nothing for deleted files', () => {
    expect(decorationRanges([status('a', 'gone.tsx', hunk(0, 0, [], ['x']), { status: 'untrackable', reason: 'deleted-file' })]).size).toBe(0);
  });
});
