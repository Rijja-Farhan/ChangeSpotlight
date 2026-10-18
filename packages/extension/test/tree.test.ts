import { describe, expect, it } from 'vitest';
import { buildTree, type TreeNode } from '../src/tree';
import { hunk, state, status } from './fixtures';

const labels = (nodes: TreeNode[] | undefined): string[] => (nodes ?? []).map((n) => n.label);
const allIds = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => [n.id, ...allIds(n.children ?? [])]);

const sample = () =>
  state([
    status('u1', 'src/b/Card.tsx', hunk(12, 2, ['  <p>   Hello   world </p>'])),
    status('u2', 'src/a/App.tsx', hunk(5, 1, ['<h1>Title</h1>']), { owners: ['src/a/App.tsx:5-5', 'src/a/App.tsx:5-6'], seenOwners: [1] }),
    status('s1', 'src/a/App.tsx', hunk(20, 1, ['<footer/>']), { status: 'seen', seenOwners: [0], pages: ['/', '/about.html'] }),
    status('s2', 'src/a/App.tsx', hunk(9, 1, ['<nav/>']), { status: 'seen', seenOwners: [0], pages: ['/'] }),
    status('m1', 'src/c/Modal.tsx', hunk(3, 1, ['<dialog/>']), { status: 'seen', seenOwners: [0], manual: true }),
    status('x1', 'src/style.css', hunk(1, 1, ['p {}']), { status: 'untrackable', reason: 'not-jsx', owners: [] }),
    status('x2', 'src/old.tsx', hunk(0, 0, [], ['<div/>']), { status: 'untrackable', reason: 'deleted-file', owners: [] }),
  ]);

describe('buildTree', () => {
  it('groups: not seen yet, one per page, marked by hand, not trackable', () => {
    const tree = buildTree(sample());
    expect(labels(tree)).toEqual(['Not seen yet (2)', 'Seen on / (2)', 'Seen on /about.html (1)', 'Marked as seen (1)', 'Not trackable (2)']);
    expect(tree[0]?.collapsed).toBeUndefined();
    expect(tree[4]?.collapsed).toBe(true);
  });

  it('lists unseen hunks by file, with partial progress', () => {
    const [unseen] = buildTree(sample());
    expect(labels(unseen?.children)).toEqual(['src/a/App.tsx', 'src/b/Card.tsx']);
    expect(unseen?.children?.[0]?.children?.[0]).toMatchObject({ label: 'App.tsx:5', description: '1/2 elements · <h1>Title</h1>', icon: 'circle-outline', contextValue: 'hunk.unseen' });
    expect(unseen?.children?.[1]?.children?.[0]?.description).toBe('<p> Hello world </p>');
  });

  it('shows a hunk seen on two pages under both, sorted by path then line', () => {
    const tree = buildTree(sample());
    expect(labels(tree[1]?.children)).toEqual(['App.tsx:9', 'App.tsx:20']);
    expect(labels(tree[2]?.children)).toEqual(['App.tsx:20']);
    expect(tree[1]?.children?.[1]).toMatchObject({ icon: 'pass', contextValue: 'hunk.seen', open: { path: 'src/a/App.tsx', startLine: 20, endLine: 20 } });
  });

  it('describes untrackable files by reason, labels deletions, and gives deleted files no open target', () => {
    const untrackable = buildTree(sample())[4]!;
    expect(untrackable.children?.map((f) => [f.label, f.description])).toEqual([
      ['src/old.tsx', 'file deleted'],
      ['src/style.css', 'not a JSX file'],
    ]);
    const deleted = untrackable.children?.[0]?.children?.[0];
    expect(deleted).toMatchObject({ label: 'old.tsx:1', description: 'deleted: <div/>', icon: 'circle-slash', contextValue: 'hunk.untrackable' });
    expect(deleted?.open).toBeUndefined();
  });

  it('truncates long previews and explains the hunk in the tooltip', () => {
    const long = '<p>' + 'x'.repeat(100) + '</p>';
    const [group] = buildTree(state([status('a', 'a.tsx', hunk(3, 2, ['', long]), { seenOwners: [], owners: ['a.tsx:3-3', 'a.tsx:4-4'], pages: [] })]));
    const node = group!.children![0]!.children![0]!;
    expect(node.description).toBe(long.slice(0, 60) + '…');
    expect(node.tooltip).toBe('a.tsx, lines 3-4\nStatus: unseen\nShown by:\n  ○ a.tsx:3-3\n  ○ a.tsx:4-4');
  });

  it('has unique ids that stay the same across rebuilds', () => {
    const ids = allIds(buildTree(sample()));
    expect(new Set(ids).size).toBe(ids.length);
    expect(allIds(buildTree(sample()))).toEqual(ids);
  });

  it('omits empty groups', () => {
    expect(buildTree(state([]))).toEqual([]);
  });
});
