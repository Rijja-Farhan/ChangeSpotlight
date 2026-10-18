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
