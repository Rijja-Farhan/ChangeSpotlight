import { parseMessage } from '@change-spotlight/core';
import { describe, expect, it } from 'vitest';
import { MAX_PAYLOAD } from '../src/bridgeClient';
import type { OverlayMessage } from '@change-spotlight/core';
import { buildOverlay } from '../src/overlay';
import { openTarget, OverlayPublisher } from '../src/overlayPublisher';
import { hunk, state, status } from './fixtures';

const A = 'src/App.tsx';

describe('buildOverlay', () => {
  it('gives one item per changed element, sorted by path then line', () => {
    const overlay = buildOverlay(
      state([
        status('h2', A, hunk(20, 1, ['<footer/>'])),
        status('h1', A, hunk(5, 2, ['  <h1>  Title </h1>', '<p/>'])),
        status('h3', 'src/About.tsx', hunk(3, 1, ['<nav/>'])),
      ]),
    );
    expect(overlay.items.map((i) => [i.loc, i.line, i.endLine, i.preview])).toEqual([
      ['src/About.tsx:3-3', 3, 3, '<nav/>'],
      [`${A}:5-5`, 5, 6, '<h1> Title </h1>'],
      [`${A}:20-20`, 20, 20, '<footer/>'],
    ]);
    expect(overlay).toMatchObject({ protocolVersion: 1, type: 'overlay', branch: 'feature', totals: { seen: 0, total: 3, untrackable: 0 } });
    expect(parseMessage(overlay).ok).toBe(true);
  });

  it('merges a loc shared by two hunks and says which of them saw it (partly)', () => {
    const owner = `${A}:1-30`;
    const overlay = buildOverlay(
      state([
        status('late', A, hunk(20, 2), { owners: [owner], seenOwners: [], pages: [] }),
        status('early', A, hunk(4, 1, ['<b/>']), { owners: [owner], seenOwners: [0], status: 'seen', pages: ['/'] }),
      ]),
    );
    expect(overlay.items).toEqual([
      { loc: owner, path: A, line: 4, endLine: 21, status: 'partly', seenHunks: 1, hunkIds: ['early', 'late'], preview: '<b/>', pages: ['/'] },
    ]);
  });

  it('counts an element seen in an unseen hunk when its own owner index is seen', () => {
    const overlay = buildOverlay(
      state([status('h', A, hunk(5, 1), { owners: [`${A}:5-5`, `${A}:5-6`], seenOwners: [1], pages: ['/about.html'] })]),
    );
    expect(overlay.items.map((i) => [i.loc, i.status, i.pages])).toEqual([
      [`${A}:5-5`, 'unseen', ['/about.html']],
      [`${A}:5-6`, 'seen', ['/about.html']],
    ]);
  });

  it('shows manual marks as seen with no page, and lists unseen elements as unplaced', () => {
    const overlay = buildOverlay(
      state([
        status('m', A, hunk(3, 1), { status: 'seen', seenOwners: [0], manual: true }),
        status('s', A, hunk(9, 1), { status: 'seen', seenOwners: [0], pages: ['/', '/about.html'] }),
        status('u', A, hunk(12, 1), { pages: [] }),
      ]),
    );
    expect(overlay.items.map((i) => i.status)).toEqual(['seen', 'seen', 'unseen']);
    expect(overlay.pages).toEqual(['/', '/about.html']);
    expect(overlay.unplaced).toEqual([`${A}:3-3`, `${A}:12-12`]);
  });

  it('places a deletion on its line and previews what was removed', () => {
    const overlay = buildOverlay(state([status('d', A, hunk(0, 0, [], ['<hr/>']), { owners: [`${A}:1-9`] })]));
    expect(overlay.items[0]).toMatchObject({ line: 1, endLine: 1, preview: 'deleted: <hr/>' });
  });

  it('leaves untrackable hunks out', () => {
    const overlay = buildOverlay(
      state([
        status('x', 'src/a.css', hunk(1, 1), { status: 'untrackable', reason: 'not-jsx', owners: [] }),
        status('u', A, hunk(2, 1)),
      ]),
    );
    expect(overlay.items.map((i) => i.hunkIds)).toEqual([['u']]);
    expect(overlay.totals.untrackable).toBe(1);
  });

  it('keeps 500 changed elements well under the bridge payload limit', () => {
    const hunks = Array.from({ length: 500 }, (_, i) =>
      status(`${'f'.repeat(28)}#${i}`, `src/components/feature/Component${i % 50}.tsx`, hunk(i + 1, 3, ['<div className="something long">{value}</div>'])),
    );
    const size = JSON.stringify(buildOverlay(state(hunks))).length;
    expect(size).toBeLessThan(MAX_PAYLOAD / 4);
  });
});

describe('OverlayPublisher', () => {
  function setup() {
    const sent: OverlayMessage[] = [];
    let pending: (() => void) | undefined;
    let scheduled = 0;
    const timers = {
      setTimeout: (fn: () => void) => {
        scheduled++;
        pending = fn;
        return scheduled;
      },
      clearTimeout: () => (pending = undefined),
    };
    const publisher = new OverlayPublisher((m) => sent.push(m), timers);
    return { sent, publisher, fire: () => pending?.() };
  }

  it('sends only the last of a burst of updates', () => {
    const { sent, publisher, fire } = setup();
    publisher.update(state([status('a', A, hunk(1, 1))]));
    publisher.update(state([status('a', A, hunk(1, 1)), status('b', A, hunk(5, 1))]));
    expect(sent).toHaveLength(0);
    fire();
    expect(sent.map((m) => m.items.length)).toEqual([2]);
  });

  it('flushes right away when a server connects, and sends nothing before any state', () => {
    const { sent, publisher, fire } = setup();
    publisher.flush();
    expect(sent).toHaveLength(0);
    publisher.update(state([status('a', A, hunk(1, 1))]));
    publisher.flush();
    fire();
    expect(sent).toHaveLength(1);
  });
});

describe('openTarget', () => {
  it.each([
    ['src/App.tsx', 'src/App.tsx'],
    ['./src//App.tsx', 'src/App.tsx'],
    ['src\\App.tsx', 'src/App.tsx'],
  ])('accepts %s', (input, expected) => expect(openTarget(input)).toBe(expected));

  it.each(['', '/etc/passwd', '../secret', 'src/../../x', 'C:/Windows', 'a\0b', '.', './'])('rejects %j', (input) => {
    expect(openTarget(input)).toBeNull();
  });
});

describe('overlay settings', () => {
  it('are sent with the overlay once set, and setting them sends right away', () => {
    const sent: OverlayMessage[] = [];
    const publisher = new OverlayPublisher((m) => sent.push(m), { setTimeout: () => 0, clearTimeout: () => {} });
    expect(buildOverlay(state([])).settings).toBeUndefined();
    publisher.setSettings({ showByDefault: true, hideSeen: false }); // no state yet: nothing to send
    expect(sent).toHaveLength(0);
    publisher.update(state([status('a', A, hunk(1, 1))]));
    publisher.setSettings({ showByDefault: false, hideSeen: true });
    expect(sent.map((m) => m.settings)).toEqual([{ showByDefault: false, hideSeen: true }]);
    expect(parseMessage(sent[0]).ok).toBe(true);
  });
});
