import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PROTOCOL_VERSION } from '@change-spotlight/core';
import { serversDir as serversDirOf, startBridge, type Bridge } from '@change-spotlight/vite-plugin/bridge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Backoff, startBridgeClient, type BridgeClient } from '../src/bridgeClient';

describe('Backoff', () => {
  it('doubles from 250 ms to a 5 s cap and resets', () => {
    const b = new Backoff(250, 5000);
    expect(Array.from({ length: 8 }, () => b.next())).toEqual([250, 500, 1000, 2000, 4000, 5000, 5000, 5000]);
    b.reset();
    expect(b.next()).toBe(250);
  });

  it('drives retries with timers (fake timers)', () => {
    vi.useFakeTimers();
    try {
      const b = new Backoff(250, 5000);
      const fired: number[] = [];
      const schedule = () => setTimeout(() => fired.push(Date.now()), b.next());
      const t0 = Date.now();
      schedule();
      vi.advanceTimersByTime(250);
      schedule();
      vi.advanceTimersByTime(500);
      b.reset(); // a welcome arrived
      schedule();
      vi.advanceTimersByTime(250);
      expect(fired.map((t) => t - t0)).toEqual([250, 750, 1000]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('bridge client <-> real plugin bridge', () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  function setup() {
    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bridge-it-'));
    cleanup.push(() => fs.rmSync(gitDir, { recursive: true, force: true }));
    const logs: string[] = [];
    const server = (extra: object = {}): Bridge => {
      const b = startBridge({ root: '/repo', gitDir, viteRoot: '/repo', log: () => {}, ...extra });
      cleanup.push(() => b.close());
      return b;
    };
    const client = (extra: object = {}): BridgeClient => {
      const c = startBridgeClient({ serversDir: serversDirOf(gitDir), log: (m) => logs.push(m), initialBackoffMs: 50, maxBackoffMs: 200, ...extra });
      cleanup.push(() => c.dispose());
      return c;
    };
    return { gitDir, logs, server, client };
  }

  const click = (loc: string) => ({ protocolVersion: PROTOCOL_VERSION, type: 'click' as const, loc, page: '/' });

  it('server first, then client: connects and receives messages', async () => {
    const { server, client, logs } = setup();
    const s = server();
    const { port } = (await s.info())!;
    const c = client();
    const got: string[] = [];
    c.onMessage((e) => e.message.type === 'click' && got.push(e.message.loc));
    await expect.poll(() => c.connected().length).toBe(1);
    s.send(click('a:1-1'));
    await expect.poll(() => got).toEqual(['a:1-1']);
    expect(logs).toEqual([`Connected to Vite dev server pid ${process.pid}, port ${port}.`]);
  });

  it('client first: connects within 1 s of the server appearing', async () => {
    const { server, client } = setup();
    const c = client();
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    await server().info();
    await expect.poll(() => c.connected().length, { timeout: 1000 }).toBe(1);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('server restarts on a new port: reconnects, drops the old entry, logs at most two lines', async () => {
    const { server, client, logs } = setup();
    const first = server();
    await first.info();
    const c = client();
    await expect.poll(() => c.connected().length).toBe(1);
    logs.length = 0;

    await first.close();
    const second = server();
    const { port } = (await second.info())!;
    await expect.poll(() => c.connected()).toEqual([`${process.pid}-${port}.json`]);
    expect(logs).toEqual([`Disconnected from Vite dev server pid ${process.pid}.`, `Connected to Vite dev server pid ${process.pid}, port ${port}.`]);
  });

  it('ignores a stale entry whose process is dead', async () => {
    const { gitDir, client, logs } = setup();
    const dead = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));
    fs.mkdirSync(serversDirOf(gitDir), { recursive: true });
    fs.writeFileSync(path.join(serversDirOf(gitDir), `${dead}-1.json`), JSON.stringify({ protocolVersion: 1, pid: dead, port: 1, token: 't', root: '/', viteRoot: '/' }));
    const c = client();
    await new Promise((r) => setTimeout(r, 300));
    expect(c.connected()).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('reconnects when the server stops sending pings', async () => {
    const { server, client, logs } = setup();
    // The server pings every 10 s (default); the client gives up after 150 ms without one.
    const s = server();
    await s.info();
    const c = client({ heartbeatTimeoutMs: 150 });
    await expect.poll(() => logs.length).toBe(1);
    await expect.poll(() => logs.length, { timeout: 2000 }).toBeGreaterThanOrEqual(3);
    expect(logs[1]).toMatch(/^Disconnected/);
    expect(logs[2]).toMatch(/^Connected/);
    expect(c.connected().length).toBe(1);
  });

  it('connects to several dev servers at once', async () => {
    const { server, client } = setup();
    await server().info();
    await server().info();
    const c = client();
    await expect.poll(() => c.connected().length).toBe(2);
  });

  it('stops retrying after a bad token until the file changes', async () => {
    const { gitDir, server, client, logs } = setup();
    const s = server();
    const info = (await s.info())!;
    const entry = JSON.parse(fs.readFileSync(info.file, 'utf8'));
    fs.writeFileSync(info.file, JSON.stringify({ ...entry, token: 'wrong' }));
    const c = client();
    await expect.poll(() => logs).toEqual([`Vite dev server pid ${process.pid} rejected our token; waiting for it to restart.`]);
    await new Promise((r) => setTimeout(r, 300));
    expect(logs).toHaveLength(1);
    fs.writeFileSync(info.file, JSON.stringify(entry));
    await expect.poll(() => c.connected().length).toBe(1);
    expect(fs.readdirSync(serversDirOf(gitDir))).toHaveLength(1);
  });
});
