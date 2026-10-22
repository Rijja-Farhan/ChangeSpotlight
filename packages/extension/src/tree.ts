// Builds the "Changes" tree from the seen state. Plain data, no vscode import, so it is unit-tested;
// treeView.ts turns these nodes into TreeItems.
import type { HunkStatus } from '@change-spotlight/core';
import { endLineOf, lineOf, preview } from './hunkText';
import type { SeenState } from './seenController';

export interface TreeNode {
  /** Unique and stable across rebuilds, so VS Code keeps expansion state. */
  id: string;
  kind: 'group' | 'file' | 'hunk';
  label: string;
  description?: string;
  tooltip?: string;
  /** Codicon id. */
  icon?: string;
  contextValue?: string;
  collapsed?: boolean;
  /** Where clicking a hunk goes (1-based lines). `deletion`: place the cursor, select nothing. */
  open?: { path: string; startLine: number; endLine: number; deletion?: true };
  /** The hunk id, for Mark as Seen / Unseen. */
  hunkId?: string;
  children?: TreeNode[];
}

const REASONS: Record<string, string> = {
  'not-jsx': 'not a JSX file',
  'deleted-file': 'file deleted',
  binary: 'binary file',
  'parse-error': 'could not be parsed',
  'no-element': 'not inside a rendered element',
  excluded: 'excluded by the changeSpotlight.exclude setting',
};

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function tooltip(h: HunkStatus): string {
  const end = h.hunk.newStart + h.hunk.newCount - 1;
  const lines = h.hunk.newCount === 0 ? `deleted after line ${h.hunk.newStart}` : h.hunk.newCount === 1 ? `line ${h.hunk.newStart}` : `lines ${h.hunk.newStart}-${end}`;
  const parts = [`${h.path}, ${lines}`, `Status: ${h.status}${h.manual ? ' (marked by hand)' : ''}`];
  if (h.reason) parts.push(`Not trackable: ${REASONS[h.reason] ?? h.reason}`);
  if (h.owners.length > 0) {
    parts.push('Shown by:');
    h.owners.forEach((o, i) => parts.push(`  ${h.seenOwners.includes(i) ? '✓' : '○'} ${o}`));
  }
  if (h.pages.length > 0) parts.push(`Seen on: ${h.pages.join(', ')}`);
  return parts.join('\n');
}

function hunkNode(group: string, h: HunkStatus): TreeNode {
  const partly = h.status === 'unseen' && h.seenOwners.length > 0 ? `${h.seenOwners.length}/${h.owners.length} elements · ` : '';
  return {
    id: `${group}/${h.id}`,
    kind: 'hunk',
    label: `${basename(h.path)}:${lineOf(h)}`,
    description: partly + preview(h),
    tooltip: tooltip(h),
    icon: h.status === 'seen' ? 'pass' : h.status === 'unseen' ? 'circle-outline' : 'circle-slash',
    contextValue: `hunk.${h.status}`,
    hunkId: h.id,
    ...(h.reason === 'deleted-file'
      ? {}
      : {
          open: {
            path: h.path,
            startLine: lineOf(h),
            endLine: endLineOf(h),
            ...(h.hunk.newCount === 0 ? { deletion: true as const } : {}),
          },
        }),
  };
}

const byPathThenLine = (a: HunkStatus, b: HunkStatus) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.hunk.newStart - b.hunk.newStart);

function byFile(group: string, hunks: HunkStatus[], describe?: (hunks: HunkStatus[]) => string | undefined): TreeNode[] {
  const files = new Map<string, HunkStatus[]>();
  for (const h of [...hunks].sort(byPathThenLine)) files.set(h.path, [...(files.get(h.path) ?? []), h]);
  return [...files].map(([path, list]) => {
    const description = describe?.(list);
    return {
      id: `${group}/file:${path}`,
      kind: 'file',
      label: path,
      ...(description ? { description } : {}),
      icon: 'file',
      children: list.map((h) => hunkNode(group, h)),
    };
  });
}

export function buildTree(state: SeenState): TreeNode[] {
  const unseen = state.hunks.filter((h) => h.status === 'unseen');
  const seen = state.hunks.filter((h) => h.status === 'seen');
  const untrackable = state.hunks.filter((h) => h.status === 'untrackable');
  const groups: TreeNode[] = [];

  if (unseen.length > 0) {
    groups.push({ id: 'unseen', kind: 'group', label: `Not seen yet (${unseen.length})`, icon: 'eye-closed', children: byFile('unseen', unseen) });
  }

  const pages = [...new Set(seen.flatMap((h) => h.pages))].sort();
  for (const page of pages) {
    const list = seen.filter((h) => h.pages.includes(page)).sort(byPathThenLine);
    const id = `page:${page}`;
    groups.push({ id, kind: 'group', label: `Seen on ${page} (${list.length})`, icon: 'browser', children: list.map((h) => hunkNode(id, h)) });
  }

  const manual = seen.filter((h) => h.pages.length === 0).sort(byPathThenLine);
  if (manual.length > 0) {
    groups.push({ id: 'manual', kind: 'group', label: `Marked as seen (${manual.length})`, icon: 'check-all', children: manual.map((h) => hunkNode('manual', h)) });
  }

  if (untrackable.length > 0) {
    groups.push({
      id: 'untrackable',
      kind: 'group',
      label: `Not trackable (${untrackable.length})`,
      icon: 'circle-slash',
      collapsed: true,
      children: byFile('untrackable', untrackable, (list) => {
        const reasons = new Set(list.map((h) => h.reason));
        const only = [...reasons][0];
        return reasons.size === 1 && only ? REASONS[only] : undefined;
      }),
    });
  }
  return groups;
}
