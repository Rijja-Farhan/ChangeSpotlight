import { describe, expect, it } from 'vitest';
import { formatLoc, parseLoc } from '../src/index.js';

describe('parseLoc', () => {
  it('parses a normal value', () => {
    expect(parseLoc('playground/src/App.tsx:8-10')).toEqual({ path: 'playground/src/App.tsx', start: 8, end: 10 });
  });

  it('splits on the last colon, so paths may contain colons', () => {
    expect(parseLoc('src/weird:name.tsx:3-4')).toEqual({ path: 'src/weird:name.tsx', start: 3, end: 4 });
  });

  it('normalizes backslashes and ./', () => {
    expect(parseLoc('.\\src\\App.tsx:1-1')).toEqual({ path: 'src/App.tsx', start: 1, end: 1 });
  });

  it.each(['', 'App.tsx', 'App.tsx:', ':1-2', 'App.tsx:0-1', 'App.tsx:5-4', 'App.tsx:1', 'App.tsx:a-b', 'App.tsx:-1-2', 'App.tsx:1.5-2', 'App.tsx:99999999999999999999-1'])(
    'rejects %j',
    (value) => {
      expect(parseLoc(value)).toBeNull();
    },
  );

  it('round-trips with formatLoc', () => {
    for (const value of ['a.tsx:1-1', 'playground/src/components/Counter.tsx:6-11', 'x:y/z.tsx:2-9']) {
      expect(formatLoc(parseLoc(value)!)).toBe(value);
    }
  });
});
