import { describe, expect, it } from 'vitest';
import { normalizePath, toRepoRelative } from '../src/index.js';

describe('normalizePath', () => {
  it.each([
    ['src/App.tsx', 'src/App.tsx'],
    ['./src/App.tsx', 'src/App.tsx'],
    ['src\\components\\App.tsx', 'src/components/App.tsx'],
    ['src//a/./b/../c.ts', 'src/a/c.ts'],
    ['src/', 'src'],
    ['../outside/x.ts', '../outside/x.ts'],
    ['/home/me/repo/', '/home/me/repo'],
    ['/../x', '/x'],
    ['C:\\Users\\me\\repo\\src', 'C:/Users/me/repo/src'],
    ['C:\\', 'C:/'],
    ['/', '/'],
    ['.', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe('toRepoRelative', () => {
  it('returns the path relative to the root', () => {
    expect(toRepoRelative('/home/me/repo/src/App.tsx', '/home/me/repo')).toBe('src/App.tsx');
    expect(toRepoRelative('/home/me/repo/src/App.tsx', '/home/me/repo/')).toBe('src/App.tsx');
  });

  it('returns "" for the root itself', () => {
    expect(toRepoRelative('/home/me/repo', '/home/me/repo')).toBe('');
  });

  it('returns null outside the root, including sibling folders with the same prefix', () => {
    expect(toRepoRelative('/home/me/other/a.ts', '/home/me/repo')).toBeNull();
    expect(toRepoRelative('/home/me/repo-two/a.ts', '/home/me/repo')).toBeNull();
    expect(toRepoRelative('/home/me/repo/../x.ts', '/home/me/repo')).toBeNull();
  });

  it('handles Windows paths case-insensitively', () => {
    expect(toRepoRelative('c:\\Users\\Me\\Repo\\src\\App.tsx', 'C:\\Users\\me\\repo')).toBe('src/App.tsx');
    expect(toRepoRelative('D:\\repo\\a.ts', 'C:\\repo')).toBeNull();
  });

  it('works when the root is the filesystem root', () => {
    expect(toRepoRelative('/a/b.ts', '/')).toBe('a/b.ts');
    expect(toRepoRelative('C:\\a\\b.ts', 'C:\\')).toBe('a/b.ts');
  });
});
