import type { OverlayItem } from '@change-spotlight/core';
import { describe, expect, it } from 'vitest';
import { arrowText, edgeCounts, nearest, panelSections, pillText, placement, rowNote, samePage } from '../src/client/finder.js';
import type { Rect } from '../src/client/outlines.js';

const viewport = { width: 800, height: 600 };
const at = (top: number, left = 100, height = 40): Rect => ({ left, top, width: 100, height });
const item = (loc: string, status: OverlayItem['status'] = 'unseen', pages: string[] = []): OverlayItem => ({
  loc,
  path: loc.slice(0, loc.lastIndexOf(':')),
  line: 1,
  endLine: 1,
  status,
  seenHunks: 0,
  hunkIds: ['h'],
  preview: '',
  pages,
});

describe('samePage', () => {
  it('treats index.html as its folder', () => {
    expect(samePage('/', '/index.html')).toBe(true);
    expect(samePage('/docs/index.html', '/docs/')).toBe(true);
    expect(samePage('/', '/about.html')).toBe(false);
  });
});

describe('edge counts and nearest', () => {
  const items = [item('a:1-1'), item('b:1-1'), item('c:1-1', 'seen'), item('d:1-1', 'partly'), item('e:1-1'), item('f:1-1'), item('shared:1-1')];
  const present = new Map<string, Rect[]>([
    ['a:1-1', [at(-500)]],
    ['b:1-1', [at(-100)]],
    ['c:1-1', [at(900)]], // seen: never counted
    ['d:1-1', [at(700)]],
    ['e:1-1', [at(1500)]],
    ['f:1-1', [at(580)]], // partly in view: not counted
    ['shared:1-1', [at(2000), at(300)]], // one instance on screen: not counted
  ]);

  it('counts unseen and partly locs with every instance off-screen, once each', () => {
    expect(edgeCounts(items, present, viewport)).toEqual({ above: 2, below: 2, left: 0, right: 0 });
  });

  it('counts a shared loc once, by its nearest instance', () => {
    const p = new Map([['s:1-1', [at(3000), at(-50), at(900)]]]);
    expect(placement(p.get('s:1-1'), viewport)).toBe('above');
    expect(edgeCounts([item('s:1-1')], p, viewport)).toEqual({ above: 1, below: 0, left: 0, right: 0 });
  });

  it('counts sideways when only off-screen horizontally', () => {
    const p = new Map([
      ['l:1-1', [at(100, -300)]],
      ['r:1-1', [at(100, 900)]],
    ]);
    expect(edgeCounts([item('l:1-1'), item('r:1-1')], p, viewport)).toEqual({ above: 0, below: 0, left: 1, right: 1 });
  });

  it('picks the closest loc to each edge', () => {
    expect(nearest('above', items, present, viewport)).toBe('b:1-1');
    expect(nearest('below', items, present, viewport)).toBe('d:1-1');
    expect(nearest('left', items, present, viewport)).toBeNull();
  });
});

describe('texts', () => {
  it('words arrows in singular and plural', () => {
    expect(arrowText(1, 'below')).toBe('1 unseen change below');
    expect(arrowText(2, 'above')).toBe('2 unseen changes above');
    expect(arrowText(3, 'left')).toBe('3 unseen changes to the left');
  });

  it('shows hunk totals and elements left in the pill', () => {
    const totals = { seen: 2, total: 6, untrackable: 1 };
    expect(pillText({ totals, items: [item('a:1-1'), item('b:1-1', 'partly'), item('c:1-1', 'seen')] })).toBe('Seen 2 of 6 · 2 to look at');
    expect(pillText({ totals: { seen: 6, total: 6, untrackable: 0 }, items: [item('c:1-1', 'seen')] })).toBe('Seen 6 of 6 · all seen');
  });
});

describe('panelSections', () => {
  const items = [
    item('src/Header.tsx:6-6', 'seen', ['/', '/about.html']),
    item('src/Counter.tsx:8-10', 'unseen'),
    item('src/Feature.tsx:3-3', 'partly', ['/']),
    item('src/Team.tsx:6-6', 'unseen', ['/about.html']),
    item('src/Modal.tsx:14-14', 'unseen'),
    item('src/Marked.tsx:2-2', 'seen'), // marked by hand: seen on no page
    item('src/Old.tsx:1-1', 'unseen', ['/']), // seen here before, gone now
  ];
  const present = new Map<string, Rect[]>([
    ['src/Header.tsx:6-6', [at(10)]],
    ['src/Feature.tsx:3-3', [at(200)]],
    ['src/Counter.tsx:8-10', [at(1200)]],
  ]);

  it('lists this page (unseen first, document order), other pages and nowhere', () => {
    const s = panelSections({ items }, present, '/index.html', viewport);
    expect(s.thisPage.map((r) => [r.item.loc, r.offscreen])).toEqual([
      ['src/Feature.tsx:3-3', null],
      ['src/Counter.tsx:8-10', 'below'],
      ['src/Header.tsx:6-6', null],
    ]);
    expect(s.thisPageLeft).toBe(2);
    expect(s.otherPages.map((r) => [r.item.loc, r.page])).toEqual([['src/Team.tsx:6-6', '/about.html']]);
    expect(s.nowhere.map((r) => r.item.loc)).toEqual(['src/Modal.tsx:14-14', 'src/Old.tsx:1-1']);
  });

  it('keeps an element in the DOM on this page even when seen on other pages', () => {
    const s = panelSections({ items: [item('a:1-1', 'unseen', ['/about.html'])] }, new Map([['a:1-1', [at(10)]]]), '/', viewport);
    expect(s.thisPage).toHaveLength(1);
    expect(s.otherPages).toHaveLength(0);
  });

  it('describes rows', () => {
    expect(rowNote({ item: item('a:1-1'), offscreen: 'below' })).toBe('(below the fold)');
    expect(rowNote({ item: item('a:1-1'), offscreen: 'above' })).toBe('(above)');
    expect(rowNote({ item: item('a:1-1'), offscreen: null })).toBe('');
    expect(rowNote({ item: item('a:1-1'), page: '/about.html' })).toBe('on /about.html');
  });
});
