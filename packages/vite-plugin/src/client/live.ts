// Live overlay states without any DOM: when an element shows the "being counted" ring, how far
// its ring has filled, and which locs flash because VS Code just confirmed them as seen.
import type { OverlayItem } from '@change-spotlight/core';
import { DWELL_MS } from './seen.js';

/** Label text while the sensor counts an element. */
export const COUNTING_TEXT = 'looking…';

/** The ring shows only on what VS Code has not confirmed: the browser never claims "seen". */
export function isCounting(status: OverlayItem['status'], dwellStart: number | undefined): boolean {
  return dwellStart !== undefined && status !== 'seen';
}

/** How many ms of the dwell are done, for the ring animation's negative delay. */
export function ringOffset(dwellStart: number, now: number): number {
  return Math.max(0, Math.min(now - dwellStart, DWELL_MS));
}

/**
 * Locs that turned seen since the previous overlay this page received. None for the first one
 * (`previous` undefined): a page that loads with seen items has nothing to celebrate.
 */
export function flashLocs(previous: ReadonlyMap<string, OverlayItem['status']> | undefined, next: readonly Pick<OverlayItem, 'loc' | 'status'>[]): string[] {
  if (!previous) return [];
  return next.filter((i) => i.status === 'seen' && (previous.get(i.loc) === 'unseen' || previous.get(i.loc) === 'partly')).map((i) => i.loc);
}
