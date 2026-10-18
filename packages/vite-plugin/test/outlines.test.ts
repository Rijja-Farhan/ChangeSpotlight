import { describe, expect, it } from 'vitest';
import { fileLine, inViewport, LABEL_HEIGHT, labelText, OUTLINE_OUTSET, placeLabels, type Rect } from '../src/client/outlines.js';

const item = (status: 'unseen' | 'partly' | 'seen', extra: object = {}) => ({
  path: 'playground/src/components/Counter.tsx',
  line: 8,
  status,
  seenHunks: status === 'seen' ? 2 : status === 'partly' ? 1 : 0,
  hunkIds: ['a#1', 'b#1'],
  ...extra,
});

const viewport = { width: 800, height: 600 };
const box = (left: number, top: number, width = 100, height = 40): Rect => ({ left, top, width, height });
const intersects = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe('label text', () => {
  it('uses the basename and the first changed line', () => {
    expect(fileLine({ path: 'a/b/c/Header.tsx', line: 4 })).toBe('Header.tsx:4');
    expect(fileLine({ path: 'App.tsx', line: 1 })).toBe('App.tsx:1');
  });

  it('says the status in words', () => {
    expect(labelText(item('unseen'))).toBe('not seen yet · Counter.tsx:8');
    expect(labelText(item('seen'))).toBe('seen · Counter.tsx:8');
    expect(labelText(item('partly'))).toBe('1/2 · Counter.tsx:8');
  });
});

describe('placeLabels', () => {
  it('puts a label just above the top-left corner, outside the outline', () => {
    const placed = placeLabels([{ key: 'a', box: box(100, 200), width: 150 }], viewport);
    expect(placed.get('a')).toEqual({ left: 100 - OUTLINE_OUTSET, top: 200 - OUTLINE_OUTSET - 4 - LABEL_HEIGHT, width: 150, height: LABEL_HEIGHT });
  });

  it('falls back inside the box when there is no room above', () => {
    expect(placeLabels([{ key: 'a', box: box(100, 10), width: 150 }], viewport).get('a')?.top).toBe(14);
    expect(placeLabels([{ key: 'a', box: box(100, -30, 100, 300), width: 150 }], viewport).get('a')?.top).toBe(0);
  });

  it('keeps labels inside the viewport horizontally', () => {
    expect(placeLabels([{ key: 'a', box: box(760, 200), width: 150 }], viewport).get('a')?.left).toBe(650);
    expect(placeLabels([{ key: 'a', box: box(-50, 200), width: 150 }], viewport).get('a')?.left).toBe(0);
    expect(placeLabels([{ key: 'a', box: box(0, 200), width: 2000 }], viewport).get('a')?.width).toBe(800);
  });

  it('moves overlapping labels right, then down, so none intersect', () => {
    const requests = [
      { key: 'a', box: box(100, 200), width: 200 },
      { key: 'b', box: box(110, 202), width: 200 },
      { key: 'c', box: box(120, 204), width: 200 },
      { key: 'd', box: box(130, 206), width: 200 },
    ];
    const placed = placeLabels(requests, viewport);
    const rects = requests.map((r) => placed.get(r.key)!);
    expect(rects[1]!.left).toBeGreaterThan(rects[0]!.left + 200);
    expect(rects[3]!.top).toBeGreaterThan(rects[0]!.top); // no room on the right: went down
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(intersects(rects[i]!, rects[j]!)).toBe(false);
    for (const r of rects) expect(r.left + r.width).toBeLessThanOrEqual(800);
  });

  it('places in reading order whatever the input order', () => {
    const a = placeLabels([{ key: 'low', box: box(100, 300), width: 100 }, { key: 'high', box: box(100, 100), width: 100 }], viewport);
    expect(a.get('high')!.top).toBeLessThan(a.get('low')!.top);
  });
});

describe('inViewport', () => {
  it('checks overlap with an optional margin', () => {
    expect(inViewport(box(10, 10), viewport)).toBe(true);
    expect(inViewport(box(10, 700), viewport)).toBe(false);
    expect(inViewport(box(10, 700), viewport, 200)).toBe(true);
    expect(inViewport(box(10, -100, 100, 50), viewport)).toBe(false);
  });
});
