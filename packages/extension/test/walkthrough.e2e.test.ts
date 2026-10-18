// The whole overlay walkthrough with real parts: a temp git repo on a feature branch, a real Vite dev
// server with the plugin, and the extension's own pieces in-process (git diff, SeenController,
// OverlayPublisher, bridge client), driven through headless Chrome. Only the vscode UI is missing.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PROTOCOL_VERSION, type OpenMessage, type OverlayMessage, type OverlaySettings } from '@change-spotlight/core';
import changeSpotlight from '@change-spotlight/vite-plugin';
import { serversDir } from '@change-spotlight/vite-plugin/bridge';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startBridgeClient, type BridgeClient } from '../src/bridgeClient';
import { computeChanges, type GitExec } from '../src/git';
import { OverlayPublisher } from '../src/overlayPublisher';
import { SeenController } from '../src/seenController';
import { SeenStore } from '../src/seenStore';
import { memento } from './memento';
import { hermeticEnv, makeRepo, type TempRepo } from './tempRepo';

const chrome = process.env.CS_CHROME ?? '/usr/bin/google-chrome';

const exec: GitExec = (args, cwd) =>
  new Promise((resolve, reject) =>
    execFile('git', args, { cwd, env: { ...hermeticEnv, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => {
      if (!err) return resolve({ stdout, code: 0 });
      const code = (err as { code?: unknown }).code;
      return typeof code === 'number' ? resolve({ stdout, code }) : reject(err);
    }),
  );

const app = (title: string, button: string) =>
  `export const App = () => (\n  <main>\n    <h1>${title}</h1>\n    <p>Intro</p>\n    <button>${button}</button>\n  </main>\n)\n`;
const about = (heading: string) => `export const About = () => (\n  <section>\n    <h2>${heading}</h2>\n  </section>\n)\n`;

// Static pages standing in for the rendered app: the data-cs-loc values are what the plugin's
// transform writes for the .tsx sources above (repo-relative path, element line range).
const INDEX = `<!doctype html><html><head><meta charset="UTF-8"><title>home</title></head><body style="margin:0;font:16px sans-serif">
<main data-cs-loc="src/App.tsx:2-6">
  <h1 data-cs-loc="src/App.tsx:3-3">Title!</h1>
  <p data-cs-loc="src/App.tsx:4-4">Intro</p>
  <div style="height:1600px"></div>
  <button data-cs-loc="src/App.tsx:5-5">Go now</button>
  <div style="height:200px"></div>
</main></body></html>`;
const ABOUT = `<!doctype html><html><head><meta charset="UTF-8"><title>about</title></head><body style="margin:0;font:16px sans-serif">
<section data-cs-loc="src/About.tsx:2-4"><h2 data-cs-loc="src/About.tsx:3-3">Our team</h2></section></body></html>`;

const H1 = 'src/App.tsx:3-3';
const BUTTON = 'src/App.tsx:5-5';
const TEAM = 'src/About.tsx:3-3';

const ov = 'change-spotlight-overlay';
const status = (page: Page, loc: string) => page.getAttribute(`${ov} [data-cs-outline][data-loc="${loc}"]`, 'data-status').catch(() => null);
const pill = (page: Page) => page.textContent(`${ov} [data-cs-open-panel]`);

async function waitFor(check: () => unknown, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!existsSync(chrome))('overlay walkthrough on a real branch', () => {
  let repo: TempRepo;
  let server: ViteDevServer;
  let client: BridgeClient;
  let browser: Browser;
  let publisher: OverlayPublisher;
  let url: string;
  const opened: OpenMessage[] = [];
  const sentOverlays: OverlayMessage[] = [];
  let settings: OverlaySettings = { showByDefault: true, hideSeen: false };

  beforeAll(async () => {
    repo = makeRepo();
    repo.write('src/App.tsx', app('Title', 'Go'));
    repo.write('src/About.tsx', about('Team'));
    repo.write('index.html', INDEX);
    repo.write('about.html', ABOUT);
    repo.commitAll('base');
    repo.git('switch', '-q', '-c', 'feature/walkthrough');
    repo.write('src/App.tsx', app('Title!', 'Go now'));
    repo.write('src/About.tsx', about('Our team'));

    // The dev server, as `pnpm dev` would start it in the app.
    server = await createServer({ root: repo.dir, configFile: false, plugins: [changeSpotlight()], logLevel: 'silent', server: { port: 0 } });
    await server.listen();
    url = server.resolvedUrls!.local[0]!;

    // The extension side, wired as in extension.ts.
    publisher = new OverlayPublisher((m) => {
      sentOverlays.push(m);
      client.send(m);
    }, undefined, 30);
    publisher.setSettings(settings);
    const controller = new SeenController(new SeenStore(memento()), () => {}, (s) => publisher.update(s));
    client = startBridgeClient({ serversDir: serversDir(repo.git('rev-parse', '--absolute-git-dir').trim()), log: () => {}, initialBackoffMs: 50 });
    client.onConnectionChange((e) => e.connected && publisher.flush());
    client.onMessage(({ message }) => {
      if (message.type === 'visibility') void controller.visibility(message.page, message.seen, false);
      if (message.type === 'open') opened.push(message);
      if (message.type === 'mark') void controller.markHunks(message.hunkIds, true);
    });
    await controller.applyResult(await computeChanges(repo.dir, '', exec));
    await waitFor(() => client.connected().length === 1);

    browser = await chromium.launch({ executablePath: chrome, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    client?.dispose();
    publisher?.dispose();
    await server?.close();
    repo?.cleanup();
  });

  it('walks a branch from "nothing seen" to "all seen"', async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(url);

    // 1. The overlay arrives: three changes, none seen.
    await waitFor(async () => (await pill(page)) !== null && (await pill(page))!.startsWith('Seen'));
    expect(sentOverlays.at(-1)?.totals).toMatchObject({ seen: 0, total: 3 });

    // 2. The title is on screen: the sensor counts it and VS Code confirms it.
    await waitFor(async () => (await status(page, H1)) === 'seen');
    expect(await pill(page)).toBe('Seen 1 of 3 · 2 to look at');

    // 3. The arrow points at the button below the fold; following it counts the button too.
    await page.click(`${ov} [data-cs-arrow="below"]`);
    await waitFor(async () => (await status(page, BUTTON)) === 'seen');
    expect(await pill(page)).toBe('Seen 2 of 3 · 1 to look at');

    // 4. The panel sends us to the other page for the last one... which has not been seen anywhere,
    // so it is listed as not on any page yet. Open the about page by hand.
    await page.click(`${ov} [data-cs-open-panel]`);
    expect(await page.getAttribute(`${ov} [data-cs-section="none"] [data-cs-row]`, 'data-loc')).toBe(TEAM);
    await page.goto(new URL('/about.html', url).href);

    // 5. Its card: Open in VS Code sends the file and line; Mark as seen turns it green.
    await page.hover(`${ov} [data-cs-label][data-loc="${TEAM}"]`);
    await page.click(`${ov} [data-cs-card] [data-cs-action="open"]`);
    await waitFor(() => opened.length === 1);
    expect(opened[0]).toEqual({ protocolVersion: PROTOCOL_VERSION, type: 'open', path: 'src/About.tsx', line: 3 });
    await page.hover(`${ov} [data-cs-label][data-loc="${TEAM}"]`);
    await page.click(`${ov} [data-cs-card] [data-cs-action="mark"]`);
    await waitFor(async () => (await status(page, TEAM)) === 'seen');
    expect(await pill(page)).toBe('Seen 3 of 3 · all seen');

    // 6. Changing the VS Code setting re-sends the overlay; with "hide seen" the outlines go.
    const before = sentOverlays.length;
    settings = { showByDefault: true, hideSeen: true };
    publisher.setSettings(settings);
    expect(sentOverlays.length).toBe(before + 1);
    await waitFor(async () => (await page.$$(`${ov} [data-cs-outline]`)).length === 0);

    // 7. A reload keeps everything: still all seen.
    await page.reload();
    await waitFor(async () => (await pill(page)) === 'Seen 3 of 3 · all seen');
    await page.close();
  });
});
