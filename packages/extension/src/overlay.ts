// Turns the seen state into the overlay the browser draws: one item per changed element. Pure and
// free of vscode, so it is unit-tested. The browser never decides "seen" itself; it shows this.
import { PROTOCOL_VERSION, type HunkStatus, type OverlayItem, type OverlayMessage, type OverlaySettings } from '@change-spotlight/core';
import { endLineOf, lineOf, preview } from './hunkText';
import type { SeenState } from './seenController';

const byPathThenLine = (a: { path: string; line: number; loc: string }, b: { path: string; line: number; loc: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line || (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0);

export function buildOverlay(state: SeenState, settings?: OverlaySettings): OverlayMessage {
  /** loc -> the trackable hunks it shows, and whether it counts as seen in each. */
  const byLoc = new Map<string, { path: string; hunks: { h: HunkStatus; seen: boolean }[] }>();
  for (const h of state.hunks) {
    if (h.status === 'untrackable') continue;
    h.owners.forEach((loc, i) => {
      const entry = byLoc.get(loc) ?? { path: h.path, hunks: [] };
      entry.hunks.push({ h, seen: h.seenOwners.includes(i) });
      byLoc.set(loc, entry);
    });
  }

  const items: OverlayItem[] = [];
  for (const [loc, { path, hunks }] of byLoc) {
    hunks.sort((a, b) => lineOf(a.h) - lineOf(b.h));
    const seenHunks = hunks.filter((x) => x.seen).length;
    items.push({
      loc,
      path,
      line: Math.min(...hunks.map((x) => lineOf(x.h))),
      endLine: Math.max(...hunks.map((x) => endLineOf(x.h))),
      status: seenHunks === hunks.length ? 'seen' : seenHunks > 0 ? 'partly' : 'unseen',
      seenHunks,
      hunkIds: hunks.map((x) => x.h.id),
      preview: preview(hunks[0]!.h),
      pages: [...new Set(hunks.flatMap((x) => x.h.pages))].sort(),
    });
  }
  items.sort(byPathThenLine);

  return {
    protocolVersion: PROTOCOL_VERSION,
    type: 'overlay',
    branch: state.branch,
    totals: { ...state.totals },
    items,
    pages: [...new Set(items.flatMap((i) => i.pages))].sort(),
    unplaced: items.filter((i) => i.pages.length === 0).map((i) => i.loc),
    ...(settings ? { settings: { ...settings } } : {}),
  };
}
