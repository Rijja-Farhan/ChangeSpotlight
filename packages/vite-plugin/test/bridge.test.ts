import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { CLOSE_CODES, PROTOCOL_VERSION } from '@change-spotlight/core';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { serversDir, startBridge, type Bridge } from '../src/bridge.js';
import { connectClient } from './helpers/bridgeClient.js';

const dirs: string[] = [];
const bridges: Bridge[] = [];
afterEach(async () => {
  for (const b of bridges.splice(0)) await b.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function start(gitDir?: string, extra: Partial<Parameters<typeof startBridge>[0]> = {}) {
  const dir = gitDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bridge-'));
  if (!gitDir) dirs.push(dir);
  const bridge = startBridge({ root: '/repo', gitDir: dir, viteRoot: '/repo/app', log: () => {}, ...extra });
  bridges.push(bridge);
  return { bridge, gitDir: dir };
}

/** Resolves with the close code of a raw connection after sending `first` (or nothing). */
function closeCode(port: number, first?: object): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => first && ws.send(JSON.stringify(first)));
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    ws.on('error', () => {});
  });
}

describe('bridge server', () => {
  it('writes a private discovery file and welcomes a client with the right token', async () => {
    const { bridge, gitDir } = start();
    const info = (await bridge.info())!;
    expect(info.file).toBe(path.join(serversDir(gitDir), `${process.pid}-${info.port}.json`));
    expect(fs.statSync(info.file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(serversDir(gitDir)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(fs.readFileSync(info.file, 'utf8'))).toEqual({
      protocolVersion: PROTOCOL_VERSION, pid: process.pid, port: info.port, token: info.token, root: '/repo', viteRoot: '/repo/app',
    });
    expect(info.token).toMatch(/^[0-9a-f]{64}$/);

    const client = await connectClient(info.port, info.token);
    bridge.send({ protocolVersion: PROTOCOL_VERSION, type: 'click', loc: 'a.tsx:1-1', page: '/' });
    await expect.poll(() => client.messages).toEqual([{ protocolVersion: PROTOCOL_VERSION, type: 'click', loc: 'a.tsx:1-1', page: '/' }]);
    client.close();
  });

  it('rejects a bad token, a wrong version, a non-hello first frame and silence', async () => {
    const { bridge } = start(undefined, { handshakeTimeoutMs: 200 });
    const { port, token } = (await bridge.info())!;
    expect(await closeCode(port, { protocolVersion: PROTOCOL_VERSION, type: 'hello', token: 'x'.repeat(64) })).toMatchObject({ code: CLOSE_CODES.badToken });
    expect(await closeCode(port, { protocolVersion: 99, type: 'hello', token })).toEqual({ code: CLOSE_CODES.versionMismatch, reason: String(PROTOCOL_VERSION) });
    expect(await closeCode(port, { protocolVersion: PROTOCOL_VERSION, type: 'click', loc: 'a:1-1', page: '/' })).toMatchObject({ code: CLOSE_CODES.protocolError });
    expect(await closeCode(port)).toMatchObject({ code: CLOSE_CODES.handshakeTimeout });
  });

  it('does not send to clients that have not completed the handshake', async () => {
    const { bridge } = start();
    const { port } = (await bridge.info())!;
    const received: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('message', (d) => received.push(d.toString()));
    await new Promise((r) => ws.on('open', r));
    bridge.send({ protocolVersion: PROTOCOL_VERSION, type: 'click', loc: 'a:1-1', page: '/' });
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual([]);
    ws.terminate();
  });

  it('refuses browser upgrades (Origin header) with 403', async () => {
    const { bridge } = start();
    const { port } = (await bridge.info())!;
    const status = await new Promise<number>((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port, headers: { Connection: 'Upgrade', Upgrade: 'websocket', Origin: 'http://evil.example', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' },
      });
      req.on('response', (res) => resolve(res.statusCode!));
      req.on('upgrade', () => resolve(101));
      req.end();
    });
    expect(status).toBe(403);
  });

  it('removes its own file on close and lets two servers coexist', async () => {
    const { bridge: a, gitDir } = start();
    const { bridge: b } = start(gitDir);
    const fa = (await a.info())!.file;
    const fb = (await b.info())!.file;
    expect(fs.readdirSync(serversDir(gitDir)).sort()).toEqual([path.basename(fa), path.basename(fb)].sort());
    await a.close();
    expect(fs.readdirSync(serversDir(gitDir))).toEqual([path.basename(fb)]);
  });

  it('deletes entries of dead processes on startup', async () => {
    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bridge-'));
    dirs.push(gitDir);
    const dead = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));
    fs.mkdirSync(serversDir(gitDir), { recursive: true });
    const stale = path.join(serversDir(gitDir), `${dead}-1234.json`);
    fs.writeFileSync(stale, JSON.stringify({ protocolVersion: 1, pid: dead, port: 1234, token: 't', root: '/', viteRoot: '/' }));
    const { bridge } = start(gitDir);
    await bridge.info();
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('passes messages from authenticated clients to onMessage', async () => {
    const got: unknown[] = [];
    const { bridge } = start(undefined, { onMessage: (m) => got.push(m) });
    const { port, token } = (await bridge.info())!;
    const client = await connectClient(port, token);
    client.ws.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: 'click', loc: 'a:1-1', page: '/' }));
    await expect.poll(() => got.length).toBe(1);
    client.close();
  });
});
