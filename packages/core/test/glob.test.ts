import { describe, expect, it } from 'vitest';
import { DEFAULT_EXCLUDE as DEFAULTS, matchesAny } from '../src/index.js';

describe('matchesAny', () => {
  it.each([
    'packages/vite-plugin/test/fixtures/counter.tsx',
    'test/App.tsx',
    'src/__tests__/Button.tsx',
    'e2e/fixtures/page.tsx',
    'src/Button.test.tsx',
    'src/Button.spec.jsx',
    'src/Button.stories.tsx',
  ])('excludes %s with the default patterns', (path) => expect(matchesAny(path, DEFAULTS)).toBe(true));

  it.each(['playground/src/components/Counter.tsx', 'src/App.tsx', 'src/testing/Toggle.tsx', 'src/contest.tsx', 'src/latest/Feed.tsx'])(
    'keeps %s',
    (path) => expect(matchesAny(path, DEFAULTS)).toBe(false),
  );

  it('supports *, ?, {a,b} and patterns without a folder', () => {
    expect(matchesAny('src/a/X.tsx', ['src/*/X.tsx'])).toBe(true);
    expect(matchesAny('src/a/b/X.tsx', ['src/*/X.tsx'])).toBe(false);
    expect(matchesAny('src/a/b/X.tsx', ['src/**/X.tsx'])).toBe(true);
    expect(matchesAny('src/X1.tsx', ['src/X?.tsx'])).toBe(true);
    expect(matchesAny('src/demo/X.tsx', ['src/{demo,docs}/**'])).toBe(true);
    expect(matchesAny('deep/in/Demo.tsx', ['Demo.tsx'])).toBe(true);
    expect(matchesAny('src/a.b.tsx', ['src/a?b.tsx'])).toBe(true);
    expect(matchesAny('src/aXb.tsx', ['src/a.b.tsx'])).toBe(false); // "." is literal
  });

  it('ignores empty patterns', () => {
    expect(matchesAny('src/App.tsx', ['', '  '])).toBe(false);
  });
});
