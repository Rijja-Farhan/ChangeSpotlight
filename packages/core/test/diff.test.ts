import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changedRanges, DiffParseError, parseDiff, type DiffFile, type Hunk } from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.diff`, import.meta.url), 'utf8');
const parse = (name: string) => parseDiff(fixture(name));

function hunk(oldStart: number, oldCount: number, newStart: number, newCount: number, removed: string[], added: string[]): Hunk {
  const kind = oldCount === 0 ? 'add' : newCount === 0 ? 'delete' : 'modify';
  return { oldStart, oldCount, newStart, newCount, kind, removed, added };
}
function file(path: string, hunks: Hunk[], extra: Partial<DiffFile> = {}): DiffFile {
  return { path, oldPath: null, status: 'modified', binary: false, hunks, ...extra };
}

describe('parseDiff', () => {
  it('returns nothing for empty input', () => {
    expect(parseDiff('')).toEqual([]);
    expect(parseDiff('\n')).toEqual([]);
  });

  it.each([
    ['modify-line', [file('a.txt', [hunk(3, 1, 3, 1, ['three'], ['THREE'])])]],
    ['add-lines', [file('a.txt', [hunk(5, 0, 6, 2, [], ['five-a', 'five-b'])])]],
    ['delete-lines', [file('a.txt', [hunk(4, 2, 3, 0, ['four', 'five'], [])])]],
    ['delete-first-line', [file('a.txt', [hunk(1, 1, 0, 0, ['one'], [])])]],
    [
      'multiple-hunks',
      [
        file('a.txt', [
          hunk(1, 1, 1, 1, ['one'], ['ONE']),
          hunk(4, 1, 3, 0, ['four'], []),
          hunk(8, 0, 8, 1, [], ['eight-a']),
          hunk(10, 1, 10, 1, ['ten'], ['TEN']),
        ]),
      ],
    ],
    [
      'multiple-files',
      [file('src/a.ts', [hunk(2, 1, 2, 1, ['two'], ['TWO'])]), file('src/b.ts', [hunk(9, 1, 9, 1, ['nine'], ['NINE'])])],
    ],
    [
      'new-file',
      [file('src/new.tsx', [hunk(0, 0, 1, 3, [], ['export const A = () => (', '  <div>new</div>', ')'])], { status: 'added' })],
    ],
    ['deleted-file', [file('old.txt', [hunk(1, 3, 0, 0, ['a', 'b', 'c'], [])], { status: 'deleted' })]],
    ['rename-pure', [file('new/name.ts', [], { status: 'renamed', oldPath: 'old/name.ts' })]],
    ['rename-edit', [file('new.ts', [hunk(6, 1, 6, 1, ['six'], ['SIX'])], { status: 'renamed', oldPath: 'old.ts' })]],
    ['binary-new', [file('img.bin', [], { status: 'added', binary: true })]],
    ['binary-modified', [file('img.bin', [], { binary: true })]],
    ['mode-only', [file('run.sh', [])]],
    ['path-with-space', [file('my file.txt', [hunk(2, 1, 2, 1, ['two'], ['TWO'])])]],
    ['path-unicode', [file('ünï.txt', [hunk(2, 1, 2, 1, ['two'], ['TWO'])])]],
    ['path-quote-tab', [file('we"ird\tname.txt', [hunk(2, 1, 2, 1, ['two'], ['TWO'])])]],
    ['no-newline-at-eof', [file('a.txt', [hunk(2, 1, 2, 1, ['two'], ['TWO'])])]],
    ['crlf-content', [file('a.txt', [hunk(2, 1, 2, 1, ['two'], ['TWO'])])]],
    // Inside a -U0 hunk, "--- x" and "+++ x" are content lines, not file headers.
    ['header-lookalike', [file('a.md', [hunk(2, 1, 2, 1, ['-- x'], ['++ x'])])]],
  ])('%s', (name, expected) => {
    expect(parse(name)).toEqual(expected);
  });

  it('parses CRLF-terminated diff text the same as LF', () => {
    expect(parse('crlf-diff-text')).toEqual(parse('multiple-hunks'));
  });

  it('throws DiffParseError with the line number when hunk counts do not match', () => {
    expect(() => parse('malformed-count')).toThrow(DiffParseError);
    try {
      parse('malformed-count');
    } catch (err) {
      expect((err as DiffParseError).line).toBe(8);
    }
  });

  it('throws on a malformed hunk header and on text that is not a diff', () => {
    expect(() => parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ nonsense @@\n')).toThrow(/malformed hunk header/);
    expect(() => parseDiff('hello\n')).toThrow(DiffParseError);
  });

  it('throws when the diff ends inside a hunk', () => {
    expect(() => parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n')).toThrow(/ended inside a hunk/);
  });
});

describe('changedRanges', () => {
  it('returns sorted inclusive new-side ranges and skips pure deletions', () => {
    expect(changedRanges(parse('multiple-hunks'))).toEqual(
      new Map([['a.txt', [{ start: 1, end: 1 }, { start: 8, end: 8 }, { start: 10, end: 10 }]]]),
    );
    expect(changedRanges(parse('add-lines'))).toEqual(new Map([['a.txt', [{ start: 6, end: 7 }]]]));
  });

  it('leaves out files whose only changes are deletions, and deleted files', () => {
    expect(changedRanges(parse('delete-lines'))).toEqual(new Map());
    expect(changedRanges(parse('deleted-file'))).toEqual(new Map());
  });

  it('keys renamed files by their new path', () => {
    expect([...changedRanges(parse('rename-edit')).keys()]).toEqual(['new.ts']);
  });

  it('covers a whole new file', () => {
    expect(changedRanges(parse('new-file'))).toEqual(new Map([['src/new.tsx', [{ start: 1, end: 3 }]]]));
  });
});
