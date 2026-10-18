// "What is left to look at", without any DOM: from the overlay and where the changed elements are
// right now, work out the pill text, the edge arrows and the panel's three lists. Pure, so it is
// unit-tested; overlayLayer.ts measures the page in its rAF pass and draws the result.
import type { OverlayItem, OverlayMessage } from '@change-spotlight/core';
import { inViewport, type Rect, type Viewport } from './outlines.js';

export type Direction = 'above' | 'below' | 'left' | 'right';
export const DIRECTIONS: readonly Direction[] = ['above', 'below', 'left', 'right'];

/** loc -> boxes of its elements in the current DOM, in document order (zero-size ones left out). */
export type Present = ReadonlyMap<string, readonly Rect[]>;

const notSeen = (item: Pick<OverlayItem, 'status'>) => item.status !== 'seen';

/** "/x/index.html" and "/x/" are the same page. */
export function samePage(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\/index\.html$/, '/');
  return norm(a) === norm(b);
}

/** Where a box is relative to the viewport, null when it is (partly) inside. Vertical wins. */
export function directionOf(rect: Rect, viewport: Viewport): Direction | null {
  if (inViewport(rect, viewport)) return null;
  if (rect.top + rect.height <= 0) return 'above';
  if (rect.top >= viewport.height) return 'below';
  return rect.left + rect.width <= 0 ? 'left' : 'right';
}

/** How far a box off-screen in `direction` is from that viewport edge. */
function distance(rect: Rect, direction: Direction, viewport: Viewport): number {
  switch (direction) {
    case 'above':
      return -(rect.top + rect.height);
    case 'below':
      return rect.top - viewport.height;
    case 'left':
      return -(rect.left + rect.width);
    case 'right':
      return rect.left - viewport.width;
  }
}

/**
 * Where a loc is: null when any instance is in the viewport, else the direction of its nearest
 * instance. Undefined when it is not in the DOM.
 */
export function placement(rects: readonly Rect[] | undefined, viewport: Viewport): Direction | null | undefined {
  if (!rects || rects.length === 0) return undefined;
  let best: { d: Direction; distance: number } | undefined;
  for (const r of rects) {
    const d = directionOf(r, viewport);
    if (d === null) return null;
    const dist = distance(r, d, viewport);
    if (!best || dist < best.distance) best = { d, distance: dist };
  }
  return best!.d;
}

/** Unseen and partly locs on this page with every instance off-screen, counted once each. */
export function edgeCounts(items: readonly OverlayItem[], present: Present, viewport: Viewport): Record<Direction, number> {
  const counts: Record<Direction, number> = { above: 0, below: 0, left: 0, right: 0 };
  for (const item of items) {
    if (!notSeen(item)) continue;
    const where = placement(present.get(item.loc), viewport);
    if (where) counts[where]++;
  }
  return counts;
}

/** The unseen loc to scroll to for an arrow: the one closest to that edge. */
export function nearest(direction: Direction, items: readonly OverlayItem[], present: Present, viewport: Viewport): string | null {
  let best: { loc: string; distance: number } | undefined;
  for (const item of items) {
    if (!notSeen(item) || placement(present.get(item.loc), viewport) !== direction) continue;
    for (const r of present.get(item.loc)!) {
      if (directionOf(r, viewport) !== direction) continue;
      const dist = distance(r, direction, viewport);
      if (!best || dist < best.distance) best = { loc: item.loc, distance: dist };
    }
  }
  return best?.loc ?? null;
}

/** "Seen 2 of 6 · 4 to look at": changes (hunks) as in VS Code's status bar, then elements not seen. */
export function pillText(overlay: Pick<OverlayMessage, 'totals' | 'items'>): string {
  const left = overlay.items.filter(notSeen).length;
  return `Seen ${overlay.totals.seen} of ${overlay.totals.total} · ${left === 0 ? 'all seen' : `${left} to look at`}`;
}

export function arrowText(count: number, direction: Direction): string {
  const what = `${count} unseen ${count === 1 ? 'change' : 'changes'}`;
  return direction === 'above' || direction === 'below' ? `${what} ${direction}` : `${what} to the ${direction}`;
}

export interface Row {
  item: OverlayItem;
  /** On this page: null when on screen, else where it is. */
  offscreen?: Direction | null;
  /** On other pages: the page to open. */
  page?: string;
}

export interface Sections {
  /** In the DOM: unseen and partly first, then seen, each in document order. */
  thisPage: Row[];
  /** Count of thisPage rows not seen ("N left"). */
  thisPageLeft: number;
  otherPages: Row[];
  /** Not seen, not in the DOM, not seen on another page. */
  nowhere: Row[];
}

export function panelSections(overlay: Pick<OverlayMessage, 'items'>, present: Present, pathname: string, viewport: Viewport): Sections {
  const thisPage: Row[] = [];
  const otherPages: Row[] = [];
  const nowhere: Row[] = [];
  for (const item of overlay.items) {
    const where = placement(present.get(item.loc), viewport);
    if (where !== undefined) {
      thisPage.push({ item, offscreen: where });
      continue;
    }
    if (!notSeen(item)) continue;
    const page = item.pages.find((p) => !samePage(p, pathname));
    if (page !== undefined) otherPages.push({ item, page });
    else nowhere.push({ item });
  }
  // `present` is filled while walking the DOM, so its key order is document order.
  const order = new Map([...present.keys()].map((loc, i) => [loc, i]));
  thisPage.sort((a, b) => Number(!notSeen(a.item)) - Number(!notSeen(b.item)) || order.get(a.item.loc)! - order.get(b.item.loc)!);
  return { thisPage, thisPageLeft: thisPage.filter((r) => notSeen(r.item)).length, otherPages, nowhere };
}

/** Muted text after a row's file:line. */
export function rowNote(row: Row): string {
  if (row.page !== undefined) return `on ${row.page}`;
  if (row.offscreen === 'above') return '(above)';
  if (row.offscreen === 'below') return '(below the fold)';
  if (row.offscreen) return `(to the ${row.offscreen})`;
  return '';
}

export const NOWHERE_HINT = 'not shown on this page yet: open the part of the app that renders it';
