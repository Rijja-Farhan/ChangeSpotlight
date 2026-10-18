import { readFileSync } from 'node:fs';
import { parseLoc } from '@change-spotlight/core';
import { describe, expect, it } from 'vitest';
import { isHostTag, tagHostElements } from '../src/transform.js';

const fixtureUrl = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const read = (name: string) => readFileSync(fixtureUrl(name), 'utf8');
const tag = (code: string, name = 'a.tsx', relPath = `src/${name}`) =>
  tagHostElements(code, { filename: `/repo/${relPath}`, relPath, lang: name.endsWith('.tsx') ? 'tsx' : 'jsx' });

/** All data-cs-loc values in transformed code. */
const locs = (code: string) => [...code.matchAll(/data-cs-loc=\{("[^"]*(?:\\.[^"]*)*")\}/g)].map((m) => JSON.parse(m[1]!) as string);

describe('fixtures (reviewed snapshots)', () => {
  it.each([
    'host-vs-component.tsx',
    'not-host.tsx',
    'nested-and-attrs.tsx',
    'spread.tsx',
    'existing.tsx',
    'typescript.tsx',
    'plain.jsx',
    'crlf.tsx',
    'bom-unicode.tsx',
    'counter.tsx',
  ])('%s', async (name) => {
    const result = tag(read(name), name);
    await expect(result?.code ?? '<unchanged>').toMatchFileSnapshot(`./fixtures/__out__/${name}`);
  });
});

describe('tagHostElements', () => {
  it('tags hosts with exact line ranges, never components', () => {
    expect(locs(tag(read('host-vs-component.tsx'))!.code)).toEqual(['src/a.tsx:5-10', 'src/a.tsx:7-9', 'src/a.tsx:8-8']);
  });

  it('tags custom elements but not member expressions, namespaced tags or fragments', () => {
    expect(locs(tag(read('not-host.tsx'))!.code)).toEqual(['src/a.tsx:6-8', 'src/a.tsx:9-9']);
  });

  it('tags JSX inside attribute values', () => {
    expect(locs(tag(read('nested-and-attrs.tsx'))!.code)).toEqual(['src/a.tsx:5-5', 'src/a.tsx:2-9', 'src/a.tsx:7-7', 'src/a.tsx:8-8']);
  });

  it('puts the attribute after the last attribute, so a later spread cannot override it', () => {
    const code = tag(read('spread.tsx'))!.code;
    expect(code).toContain('<p {...props} data-cs-loc={"src/a.tsx:3-3"} />');
    expect(code).toContain('<p id="a" {...props} title="t" data-cs-loc={"src/a.tsx:4-4"} />');
    expect(code).toContain('<p {...props} id="b" data-cs-loc={"src/a.tsx:5-5"} />');
  });

  it('leaves explicit data-cs-loc alone and is idempotent', () => {
    const once = tag(read('existing.tsx'))!.code;
    expect(locs(once)).toEqual(['src/a.tsx:4-4']);
    expect(once).toContain('data-cs-loc="custom:1-1"');
    expect(tag(once)).toBeNull();
  });

  it('returns null for a syntax error, for code without "<", and when nothing changes', () => {
    expect(tag(read('syntax-error.tsx'))).toBeNull();
    expect(tag('export const x = 1')).toBeNull();
    expect(tag('export const A = () => <Foo />')).toBeNull();
  });

  it('counts lines like git: CRLF works, a lone CR is not a line break', () => {
    expect(locs(tag(read('crlf.tsx'))!.code)).toEqual(['src/a.tsx:2-4', 'src/a.tsx:3-3']);
    expect(locs(tag('export const A = () => (\r  <div />\n)')!.code)).toEqual(['src/a.tsx:1-1']);
  });

  it('handles a BOM and non-ASCII text before an element', () => {
    expect(locs(tag(read('bom-unicode.tsx'))!.code)).toEqual(['src/a.tsx:3-3']);
  });

  it('handles TypeScript generics and casts', () => {
    expect(locs(tag(read('typescript.tsx'))!.code)).toEqual(['src/a.tsx:7-7', 'src/a.tsx:7-7']);
  });

  it('parses .jsx and .js content with lang jsx', () => {
    expect(locs(tag(read('plain.jsx'), 'plain.jsx')!.code)).toEqual(['src/plain.jsx:1-1']);
    expect(locs(tag('const A = () => <div />', 'a.js')!.code)).toEqual(['src/a.js:1-1']);
  });

  it('writes values that survive quotes, ampersands, spaces and non-ASCII in the path', () => {
    const relPath = 'src/we"ird & spaced ü/A.tsx';
    const code = tag('export const A = () => <div />', 'A.tsx', relPath)!.code;
    const [value] = locs(code);
    expect(parseLoc(value!)).toEqual({ path: relPath, start: 1, end: 1 });
  });

  it('transforms a 20,000-line file in under 2 seconds', () => {
    const body = Array.from({ length: 5000 }, (_, i) => `    <li key="${i}">\n      <span>{${i}}</span>\n    </li>`).join('\n');
    const code = `export const A = () => (\n  <ul>\n${body}\n  </ul>\n)\n`;
    const t0 = performance.now();
    const result = tag(code)!;
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(locs(result.code)).toHaveLength(10001);
  });
});

describe('isHostTag', () => {
  it.each([
    ['div', true],
    ['my-widget', true],
    ['Foo', false],
    ['Foo-bar', true],
    ['this', false],
  ])('%s -> %s', (name, expected) => {
    expect(isHostTag(name)).toBe(expected);
  });
});
