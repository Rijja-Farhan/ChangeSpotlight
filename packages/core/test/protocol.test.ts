import { describe, expect, it } from 'vitest';
import { parseMessage, PROTOCOL_VERSION } from '../src/index.js';

const v = PROTOCOL_VERSION;

describe('parseMessage', () => {
  it.each([
    { protocolVersion: v, type: 'hello' },
    { protocolVersion: v, type: 'click', loc: 'a.tsx:1-2', page: '/' },
    { protocolVersion: v, type: 'visibility', page: '/about', seen: ['a.tsx:1-2', 'b.tsx:3-3'] },
    { protocolVersion: v, type: 'visibility', page: '/', seen: [] },
  ])('accepts $type', (message) => {
    expect(parseMessage(message)).toEqual({ ok: true, message });
  });

  it('accepts unknown extra fields (forward compatible)', () => {
    const message = { protocolVersion: v, type: 'click', loc: 'a.tsx:1-2', page: '/', extra: 42 };
    expect(parseMessage(message)).toEqual({ ok: true, message });
  });

  it.each([null, undefined, 'hello', 42, ['hello']])('rejects %j as not-object', (value) => {
    expect(parseMessage(value)).toEqual({ ok: false, reason: 'not-object' });
  });

  it.each([{ type: 'hello' }, { protocolVersion: v + 1, type: 'hello' }, { protocolVersion: String(v), type: 'hello' }])(
    'rejects %j as version-mismatch',
    (value) => {
      expect(parseMessage(value)).toEqual({ ok: false, reason: 'version-mismatch' });
    },
  );

  it('rejects an unknown type', () => {
    expect(parseMessage({ protocolVersion: v, type: 'scroll' })).toEqual({ ok: false, reason: 'unknown-type' });
    expect(parseMessage({ protocolVersion: v })).toEqual({ ok: false, reason: 'unknown-type' });
  });

  it.each([
    { protocolVersion: v, type: 'click', page: '/' },
    { protocolVersion: v, type: 'click', loc: 7, page: '/' },
    { protocolVersion: v, type: 'visibility', page: '/' },
    { protocolVersion: v, type: 'visibility', page: '/', seen: ['ok', 3] },
    { protocolVersion: v, type: 'visibility', seen: [] },
  ])('rejects %j as invalid-fields', (value) => {
    expect(parseMessage(value)).toEqual({ ok: false, reason: 'invalid-fields' });
  });
});
