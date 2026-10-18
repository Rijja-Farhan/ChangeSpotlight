import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@change-spotlight/core';
import { describeMessage } from '../src/bridgeMessages';

const line = (o: object) => JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...o });

describe('describeMessage', () => {
  it('describes a click as file:line', () => {
    expect(describeMessage(line({ type: 'click', loc: 'playground/src/App.tsx:8-10', page: '/' }))).toBe(
      'Clicked playground/src/App.tsx:8  (element spans playground/src/App.tsx:8-10, page /)',
    );
  });

  it('describes a visibility batch with its locs', () => {
    expect(describeMessage(line({ type: 'visibility', page: '/about', seen: ['a.tsx:1-2', 'b.tsx:3-3'] }))).toBe(
      'Seen 2 element(s) on /about\n  a.tsx:1-2\n  b.tsx:3-3',
    );
  });

  it('describes open and mark requests and stays quiet for overlays', () => {
    expect(describeMessage(line({ type: 'open', path: 'src/App.tsx', line: 4 }))).toBe('Browser asked to open src/App.tsx:4');
    expect(describeMessage(line({ type: 'mark', hunkIds: ['a#1', 'b#1'] }))).toBe('Browser marked 2 change(s) as seen');
    expect(
      describeMessage(line({ type: 'overlay', branch: null, totals: { seen: 0, total: 0, untrackable: 0 }, items: [], pages: [], unplaced: [] })),
    ).toBeNull();
  });

  it('stays quiet for hello, garbage and malformed messages', () => {
    expect(describeMessage(line({ type: 'hello', token: 't' }))).toBeNull();
    expect(describeMessage(line({ type: 'welcome' }))).toBeNull();
    expect(describeMessage('not json')).toBeNull();
    expect(describeMessage(line({ type: 'visibility', page: '/' }))).toBeNull();
  });

  it('mentions a protocol version mismatch', () => {
    expect(describeMessage(JSON.stringify({ protocolVersion: 99, type: 'hello' }))).toBe('Ignored message with protocol version 99.');
  });
});
