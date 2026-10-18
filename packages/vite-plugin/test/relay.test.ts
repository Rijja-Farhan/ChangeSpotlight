import { PROTOCOL_VERSION, type OverlayMessage } from '@change-spotlight/core';
import { describe, expect, it } from 'vitest';
import { createOverlayRelay } from '../src/relay.js';

const overlay = (seen: number): OverlayMessage => ({
  protocolVersion: PROTOCOL_VERSION,
  type: 'overlay',
  branch: 'feature',
  totals: { seen, total: 2, untrackable: 0 },
  items: [],
  pages: [],
  unplaced: [],
});

function channel() {
  const sent: [string, unknown][] = [];
  return { sent, send: (event: string, data: unknown) => sent.push([event, data]) };
}

describe('createOverlayRelay', () => {
  it('broadcasts each overlay to all pages and keeps the last one', () => {
    const pages = channel();
    const relay = createOverlayRelay(pages, () => {});
    relay.fromExtension(overlay(0));
    relay.fromExtension(overlay(1));
    expect(pages.sent).toEqual([
      ['cs:overlay', overlay(0)],
      ['cs:overlay', overlay(1)],
    ]);
    expect(relay.latest()).toEqual(overlay(1));
  });

  it('answers a page request with the stored overlay only, and only once there is one', () => {
    const pages = channel();
    const page = channel();
    const relay = createOverlayRelay(pages, () => {});
    relay.onRequest(page);
    expect(page.sent).toEqual([]);
    relay.fromExtension(overlay(1));
    relay.onRequest(page);
    expect(page.sent).toEqual([['cs:overlay', overlay(1)]]);
  });

  it('logs other message types once and does not relay them', () => {
    const pages = channel();
    const logs: string[] = [];
    const relay = createOverlayRelay(pages, (l) => logs.push(l));
    const click = { protocolVersion: PROTOCOL_VERSION, type: 'click' as const, loc: 'a:1-1', page: '/' };
    relay.fromExtension(click);
    relay.fromExtension(click);
    expect(pages.sent).toEqual([]);
    expect(logs).toEqual(['ignored click message from VS Code']);
  });
});
