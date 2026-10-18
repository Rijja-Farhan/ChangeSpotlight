import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ProtocolMessage } from '@change-spotlight/core';
import { createMessageHandler } from '../src/messages.js';

describe('createMessageHandler', () => {
  it('forwards valid messages of the right type and drops the rest, logging each reason once', () => {
    const forwarded: ProtocolMessage[] = [];
    const logs: string[] = [];
    const handle = createMessageHandler('cs:visibility', (m) => forwarded.push(m), (l) => logs.push(l));
    const good = { protocolVersion: PROTOCOL_VERSION, type: 'visibility', page: '/', seen: ['a:1-1'] };

    handle(good);
    handle({ ...good, seen: [1] });
    handle({ ...good, seen: [2] });
    handle({ ...good, protocolVersion: 99 });
    handle({ protocolVersion: PROTOCOL_VERSION, type: 'click', loc: 'a:1-1', page: '/' });
    handle('nope');

    expect(forwarded).toEqual([good]);
    expect(logs).toEqual([
      'dropped cs:visibility message (invalid-fields)',
      'dropped cs:visibility message (version-mismatch)',
      'dropped cs:visibility message (wrong-type)',
      'dropped cs:visibility message (not-object)',
    ]);
  });
});

describe('open and mark events', () => {
  it('forwards valid requests from the page and drops invalid ones', () => {
    const forwarded: ProtocolMessage[] = [];
    const logs: string[] = [];
    const open = createMessageHandler('cs:open', (m) => forwarded.push(m), (l) => logs.push(l));
    const mark = createMessageHandler('cs:mark', (m) => forwarded.push(m), (l) => logs.push(l));
    const goodOpen = { protocolVersion: PROTOCOL_VERSION, type: 'open', path: 'src/App.tsx', line: 4 };
    const goodMark = { protocolVersion: PROTOCOL_VERSION, type: 'mark', hunkIds: ['a#1'] };

    open(goodOpen);
    open({ ...goodOpen, line: -1 });
    open(goodMark);
    mark(goodMark);
    mark({ ...goodMark, hunkIds: 'a#1' });

    expect(forwarded).toEqual([goodOpen, goodMark]);
    expect(logs).toEqual(['dropped cs:open message (invalid-fields)', 'dropped cs:open message (wrong-type)', 'dropped cs:mark message (invalid-fields)']);
  });
});
