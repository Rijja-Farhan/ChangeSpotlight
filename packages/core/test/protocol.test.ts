import { describe, expect, it } from 'vitest';
import { parseMessage, parseServerInfo, PROTOCOL_VERSION, readHello } from '../src/index.js';

const v = PROTOCOL_VERSION;

describe('parseMessage', () => {
  it.each([
    { protocolVersion: v, type: 'hello', token: 'abc' },
    { protocolVersion: v, type: 'welcome' },
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

  it('requires a token on hello', () => {
    expect(parseMessage({ protocolVersion: v, type: 'hello' })).toEqual({ ok: false, reason: 'invalid-fields' });
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

describe('readHello', () => {
  it('reads any hello regardless of version', () => {
    expect(readHello({ type: 'hello', protocolVersion: 7, token: 't' })).toEqual({ protocolVersion: 7, token: 't' });
    expect(readHello({ type: 'hello' })).toEqual({ protocolVersion: undefined, token: undefined });
  });

  it('returns null for anything that is not a hello', () => {
    for (const value of [null, 'hello', [], { type: 'click' }]) expect(readHello(value)).toBeNull();
  });
});

describe('parseServerInfo', () => {
  const info = { protocolVersion: 1, pid: 123, port: 40000, token: 'ab', root: '/repo', viteRoot: '/repo/app' };

  it('accepts a complete entry', () => {
    expect(parseServerInfo(info)).toEqual(info);
  });

  it.each([
    null,
    {},
    { ...info, port: 0 },
    { ...info, port: 70000 },
    { ...info, pid: -1 },
    { ...info, pid: 1.5 },
    { ...info, token: '' },
    { ...info, token: 5 },
    { ...info, root: undefined },
    { ...info, protocolVersion: '1' },
  ])('rejects %j', (value) => {
    expect(parseServerInfo(value)).toBeNull();
  });
});
