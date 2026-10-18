// The overlay path on the extension side, with real parts: temp repo + git diff + SeenController +
// OverlayPublisher + bridge client, talking to the real plugin bridge server.
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PROTOCOL_VERSION, type OverlayMessage, type ProtocolMessage } from '@change-spotlight/core';
import { serversDir, startBridge } from '@change-spotlight/vite-plugin/bridge';
import { afterEach, describe, expect, it } from 'vitest';
import { startBridgeClient } from '../src/bridgeClient';
import { computeChanges, type GitExec } from '../src/git';
import { OverlayPublisher } from '../src/overlayPublisher';
import { SeenController } from '../src/seenController';
import { SeenStore } from '../src/seenStore';
import { memento } from './memento';
import { hermeticEnv, makeRepo } from './tempRepo';

const exec: GitExec = (args, cwd) =>
  new Promise((resolve, reject) =>
    execFile('git', args, { cwd, env: { ...hermeticEnv, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => {
      if (!err) return resolve({ stdout, code: 0 });
      const code = (err as { code?: unknown }).code;
      return typeof code === 'number' ? resolve({ stdout, code }) : reject(err);
    }),
  );

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function setup() {
  const repo = makeRepo();
  cleanup.push(() => repo.cleanup());
  repo.write('src/App.tsx', 'export const App = () => (\n  <main>\n    <p>Old</p>\n  </main>\n)\n');
  repo.commitAll('base');
  repo.git('switch', '-q', '-c', 'feature');
  repo.write('src/App.tsx', 'export const App = () => (\n  <main>\n    <p>New</p>\n  </main>\n)\n');

  // Plugin side: collects what the extension sends.
  const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-overlay-it-'));
  cleanup.push(() => fs.rmSync(gitDir, { recursive: true, force: true }));
  const received: ProtocolMessage[] = [];
  const server = startBridge({ root: repo.dir, gitDir, viteRoot: repo.dir, log: () => {}, onMessage: (m) => received.push(m) });
  cleanup.push(() => server.close());
  await server.info();

  // Extension side, wired as in extension.ts.
  const client = startBridgeClient({ serversDir: serversDir(gitDir), log: () => {}, initialBackoffMs: 50 });
  cleanup.push(() => client.dispose());
  const publisher = new OverlayPublisher((m) => client.send(m), undefined, 20);
  cleanup.push(() => publisher.dispose());
  const controller = new SeenController(new SeenStore(memento()), () => {}, (s) => publisher.update(s));
  client.onConnectionChange((e) => e.connected && publisher.flush());
  client.onMessage(({ message }) => {
    if (message.type === 'mark') void controller.markHunks(message.hunkIds, true);
  });
  await controller.applyResult(await computeChanges(repo.dir, '', exec));

  const overlays = () => received.filter((m): m is OverlayMessage => m.type === 'overlay');
  return { server, client, controller, overlays, received };
}

describe('overlay over the bridge', () => {
  it('sends the overlay when a server connects and again after a visibility report', async () => {
    const { overlays, controller } = await setup();
    await expect.poll(() => overlays().length).toBeGreaterThanOrEqual(1);
    expect(overlays().at(-1)).toMatchObject({ branch: 'feature', totals: { seen: 0, total: 1 }, items: [{ loc: 'src/App.tsx:3-3', status: 'unseen', line: 3 }] });

    await controller.visibility('/', ['src/App.tsx:3-3'], false);
    await expect.poll(() => overlays().at(-1)?.totals.seen).toBe(1);
    expect(overlays().at(-1)?.items[0]).toMatchObject({ status: 'seen', pages: ['/'] });
  });

  it('delivers open requests from the plugin and applies mark requests', async () => {
    const { server, client, overlays } = await setup();
    await expect.poll(() => client.connected().length).toBe(1);
    const got: ProtocolMessage[] = [];
    client.onMessage((e) => got.push(e.message));

    const open = { protocolVersion: PROTOCOL_VERSION, type: 'open' as const, path: 'src/App.tsx', line: 3 };
    server.send(open);
    await expect.poll(() => got).toEqual([open]);

    await expect.poll(() => overlays().length).toBeGreaterThanOrEqual(1);
    const ids = overlays().at(-1)!.items[0]!.hunkIds;
    server.send({ protocolVersion: PROTOCOL_VERSION, type: 'mark', hunkIds: [...ids, 'unknown#1'] });
    await expect.poll(() => overlays().at(-1)?.totals.seen).toBe(1);
    expect(overlays().at(-1)?.unplaced).toEqual(['src/App.tsx:3-3']); // marked by hand: seen on no page
  });
});
