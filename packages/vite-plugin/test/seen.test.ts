import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeenTracker, type Batch, type Observation } from '../src/client/seen.js';

const visible = (loc: string, extra: Partial<Observation> = {}): Observation => ({
  loc, ratio: 1, viewportCoverage: 0.2, tall: false, hasSize: true, ...extra,
});

let batches: Batch[];
let canCommit: (key: string) => boolean;
const make = (page = '/') =>
  new SeenTracker<string>({
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    page,
    canCommit: (k) => canCommit(k),
    onBatch: (b) => batches.push(b),
  });

beforeEach(() => {
  vi.useFakeTimers();
  batches = [];
  canCommit = () => true;
});
afterEach(() => vi.useRealTimers());

/** Advance past the dwell and the batch flush. */
const settle = () => vi.advanceTimersByTime(300 + 500);

describe('SeenTracker', () => {
  it('needs 300 ms of continuous visibility', () => {
    const t = make();
    t.update('a', visible('a:1-1'));
    vi.advanceTimersByTime(299);
    t.update('a', visible('a:1-1', { ratio: 0 }));
    settle();
    expect(batches).toEqual([]);

    t.update('a', visible('a:1-1'));
    vi.advanceTimersByTime(300);
    t.flush();
    expect(batches).toEqual([{ page: '/', seen: ['a:1-1'] }]);
  });

  it('needs at least half of the element visible', () => {
    const t = make();
    t.update('a', visible('a:1-1', { ratio: 0.49 }));
    t.update('b', visible('b:1-1', { ratio: 0.5 }));
    settle();
    expect(batches).toEqual([{ page: '/', seen: ['b:1-1'] }]);
  });

  it('counts a tall element once its visible part covers half the viewport', () => {
    const t = make();
    t.update('tall', visible('t:1-90', { ratio: 0.2, tall: true, viewportCoverage: 0.4 }));
    settle();
    expect(batches).toEqual([]);
    t.update('tall', visible('t:1-90', { ratio: 0.3, tall: true, viewportCoverage: 0.6 }));
    settle();
    expect(batches).toEqual([{ page: '/', seen: ['t:1-90'] }]);
  });

  it('never counts a zero-size element', () => {
    const t = make();
    t.update('a', visible('a:1-1', { hasSize: false }));
    settle();
    expect(batches).toEqual([]);
  });

  it('resets the dwell when focus or tab visibility is lost', () => {
    const t = make();
    t.update('a', visible('a:1-1'));
    vi.advanceTimersByTime(200);
    t.setActive(false);
    vi.advanceTimersByTime(200);
    t.setActive(true);
    vi.advanceTimersByTime(200); // only 200 ms since regaining focus
    t.flush();
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(100);
    t.flush();
    expect(batches).toEqual([{ page: '/', seen: ['a:1-1'] }]);
  });

  it('does not count while inactive', () => {
    const t = make();
    t.setActive(false);
    t.update('a', visible('a:1-1'));
    settle();
    expect(batches).toEqual([]);
  });

  it('respects the final canCommit check (e.g. opacity 0)', () => {
    canCommit = (k) => k !== 'hidden';
    const t = make();
    t.update('hidden', visible('h:1-1'));
    t.update('shown', visible('s:1-1'));
    settle();
    expect(batches).toEqual([{ page: '/', seen: ['s:1-1'] }]);
  });

  it('reports each loc once per page, even from several elements', () => {
    const t = make();
    t.update('li1', visible('list.tsx:3-3'));
    t.update('li2', visible('list.tsx:3-3'));
    settle();
    t.update('li1', visible('list.tsx:3-3', { ratio: 0 }));
    t.update('li1', visible('list.tsx:3-3'));
    settle();
    expect(batches).toEqual([{ page: '/', seen: ['list.tsx:3-3'] }]);
  });

  it('treats a changed loc (HMR line shift) as new', () => {
    const t = make();
    t.update('a', visible('a:1-1'));
    settle();
    t.update('a', visible('a:2-2'));
    settle();
    expect(batches).toEqual([
      { page: '/', seen: ['a:1-1'] },
      { page: '/', seen: ['a:2-2'] },
    ]);
  });

  it('cancels the dwell of a removed element', () => {
    const t = make();
    t.update('a', visible('a:1-1'));
    vi.advanceTimersByTime(100);
    t.remove('a');
    settle();
    expect(batches).toEqual([]);
  });

  it('attributes seen locs to the page they were seen on', () => {
    const t = make('/one');
    t.update('a', visible('a:1-1'));
    vi.advanceTimersByTime(300); // seen, queued, not flushed yet
    t.update('b', visible('b:1-1'));
    vi.advanceTimersByTime(100); // b still dwelling
    t.setPage('/two');
    expect(batches).toEqual([{ page: '/one', seen: ['a:1-1'] }]);
    settle();
    // Both still visible: they count again for the new page.
    expect(batches).toEqual([
      { page: '/one', seen: ['a:1-1'] },
      { page: '/two', seen: ['a:1-1', 'b:1-1'] },
    ]);
  });

  it('batches: one message 500 ms after the first seen loc, or on flush', () => {
    const t = make();
    t.update('a', visible('a:1-1'));
    vi.advanceTimersByTime(300);
    t.update('b', visible('b:1-1'));
    vi.advanceTimersByTime(300);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(batches).toEqual([{ page: '/', seen: ['a:1-1', 'b:1-1'] }]);

    t.update('c', visible('c:1-1'));
    vi.advanceTimersByTime(300);
    t.flush(); // pagehide / tab hidden
    expect(batches.at(-1)).toEqual({ page: '/', seen: ['c:1-1'] });
  });

  it('reports still-visible elements again after resetReported (HMR)', () => {
    const t = make();
    t.update('a', visible('a:1-1'));
    t.update('b', visible('b:1-1', { ratio: 0 }));
    settle();
    t.resetReported();
    vi.advanceTimersByTime(299);
    t.flush();
    expect(batches).toEqual([{ page: '/', seen: ['a:1-1'] }]);
    vi.advanceTimersByTime(1);
    t.flush();
    expect(batches).toEqual([
      { page: '/', seen: ['a:1-1'] },
      { page: '/', seen: ['a:1-1'] },
    ]);
  });
});
