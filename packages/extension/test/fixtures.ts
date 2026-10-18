import type { Hunk, HunkStatus } from '@change-spotlight/core';
import type { SeenState } from '../src/seenController';

export function hunk(newStart: number, newCount: number, added: string[] = ['x'], removed: string[] = []): Hunk {
  return {
    oldStart: newStart, oldCount: removed.length, newStart, newCount,
    kind: removed.length === 0 ? 'add' : newCount === 0 ? 'delete' : 'modify', removed, added,
  };
}

export function status(id: string, path: string, h: Hunk, extra: Partial<HunkStatus> = {}): HunkStatus {
  return { id, path, hunk: h, status: 'unseen', owners: [`${path}:${h.newStart}-${h.newStart}`], seenOwners: [], pages: [], ...extra };
}

export function state(hunks: HunkStatus[]): SeenState {
  const trackable = hunks.filter((h) => h.status !== 'untrackable');
  return {
    root: '/repo',
    branch: 'feature',
    hunks,
    totals: { seen: trackable.filter((h) => h.status === 'seen').length, total: trackable.length, untrackable: hunks.length - trackable.length },
  };
}
