import { readdirSync, readFileSync } from 'node:fs';
import { formatLoc } from '@change-spotlight/core';
import { describe, expect, it } from 'vitest';
import { collectHostElements } from '../src/elements.js';
import { tagHostElements } from '../src/transform.js';

const dir = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(dir).filter((f) => /\.[jt]sx$/.test(f));

describe('collectHostElements', () => {
  it.each(fixtures)('reports exactly the ranges the transform writes: %s', (name) => {
    const code = readFileSync(new URL(name, dir), 'utf8');
    const options = { filename: `/repo/src/${name}`, relPath: `src/${name}`, lang: name.endsWith('.tsx') ? ('tsx' as const) : ('jsx' as const) };
    const elements = collectHostElements(code, options);
    const tagged = tagHostElements(code, options);
    if (elements === null) {
      expect(tagged).toBeNull(); // syntax error
      return;
    }
    const written = tagged ? [...tagged.code.matchAll(/data-cs-loc=\{("[^"]*")\}/g)].map((m) => JSON.parse(m[1]!) as string) : [];
    expect(elements.map(formatLoc).sort()).toEqual(written.sort());
  });

  it('reports nesting depth among host elements', () => {
    const code = 'const A = () => (\n<main>\n<Card><section>\n<p>x</p>\n</section></Card>\n</main>\n)';
    expect(collectHostElements(code, { filename: 'a.tsx', relPath: 'a.tsx', lang: 'tsx' })).toEqual([
      { path: 'a.tsx', start: 2, end: 6, depth: 0 },
      { path: 'a.tsx', start: 3, end: 5, depth: 1 },
      { path: 'a.tsx', start: 4, end: 4, depth: 2 },
    ]);
  });

  it('returns [] without "<" and null on a syntax error', () => {
    expect(collectHostElements('export const x = 1', { filename: 'a.ts', relPath: 'a.ts', lang: 'tsx' })).toEqual([]);
    expect(collectHostElements('const A = <div>', { filename: 'a.tsx', relPath: 'a.tsx', lang: 'tsx' })).toBeNull();
  });
});
