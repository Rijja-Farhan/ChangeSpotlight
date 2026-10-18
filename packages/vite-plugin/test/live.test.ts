import { describe, expect, it } from 'vitest';
import { COUNTING_TEXT, flashLocs, isCounting, ringOffset } from '../src/client/live.js';
import { DWELL_MS } from '../src/client/seen.js';

describe('live states', () => {
  it('flashes locs that went from unseen or partly to seen', () => {
    const previous = new Map([
      ['a', 'unseen'],
      ['b', 'partly'],
      ['c', 'seen'],
      ['d', 'seen'],
    ] as const);
    const next = [
      { loc: 'a', status: 'seen' },
      { loc: 'b', status: 'seen' },
      { loc: 'c', status: 'seen' },
      { loc: 'd', status: 'unseen' },
      { loc: 'new', status: 'seen' },
    ] as const;
    expect(flashLocs(previous, next)).toEqual(['a', 'b']);
  });

  it('never flashes on the first overlay', () => {
    expect(flashLocs(undefined, [{ loc: 'a', status: 'seen' }])).toEqual([]);
  });

  it('counts only what VS Code has not confirmed', () => {
    expect(isCounting('unseen', 10)).toBe(true);
    expect(isCounting('partly', 10)).toBe(true);
    expect(isCounting('seen', 10)).toBe(false);
    expect(isCounting('unseen', undefined)).toBe(false);
  });

  it('clamps the ring offset to the dwell', () => {
    expect(ringOffset(100, 250)).toBe(150);
    expect(ringOffset(100, 50)).toBe(0);
    expect(ringOffset(100, 100 + DWELL_MS + 999)).toBe(DWELL_MS);
    expect(COUNTING_TEXT).toBe('looking…');
  });
});
