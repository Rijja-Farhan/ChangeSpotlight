import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addedFileDiff, isBinaryContent, parseDiff } from '../src/index.js';

const fixture = (name: string) => parseDiff(readFileSync(new URL(`./fixtures/${name}.diff`, import.meta.url), 'utf8'));

describe('addedFileDiff', () => {
  it('matches git output for a new text file', () => {
    expect([addedFileDiff('src/new.tsx', 'export const A = () => (\n  <div>new</div>\n)\n')]).toEqual(fixture('new-file'));
  });

  it('matches git output for a new binary file', () => {
    expect([addedFileDiff('img.bin', null)]).toEqual(fixture('binary-new'));
  });

  it('has no hunks for an empty file', () => {
    expect(addedFileDiff('empty.txt', '').hunks).toEqual([]);
  });

  it('counts a last line without a final newline, and strips CR', () => {
    expect(addedFileDiff('a.txt', 'one\r\ntwo').hunks[0]).toEqual({
      oldStart: 0, oldCount: 0, newStart: 1, newCount: 2, kind: 'add', removed: [], added: ['one', 'two'],
    });
  });

  it('keeps blank lines', () => {
    expect(addedFileDiff('a.txt', 'a\n\nb\n').hunks[0]?.added).toEqual(['a', '', 'b']);
  });

  it('normalizes the path', () => {
    expect(addedFileDiff('.\\src\\x.ts', 'x\n').path).toBe('src/x.ts');
  });
});

describe('isBinaryContent', () => {
  it('detects a NUL byte in the first 8000 bytes only', () => {
    expect(isBinaryContent(new Uint8Array([104, 105]))).toBe(false);
    expect(isBinaryContent(new Uint8Array([104, 0, 105]))).toBe(true);
    const late = new Uint8Array(9000).fill(65);
    late[8500] = 0;
    expect(isBinaryContent(late)).toBe(false);
    expect(isBinaryContent(new Uint8Array())).toBe(false);
  });
});
