// End to end: headless Chrome -> sensor -> import.meta.hot -> plugin validation -> bridge /events.
import { existsSync, readFileSync } from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import reactSwc from '@vitejs/plugin-react-swc';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type PluginOption, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import changeSpotlight from '../../src/index.js';

const chrome = process.env.CS_CHROME ?? '/usr/bin/google-chrome';
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const discoveryFile = path.join(repoRoot, '.change-spotlight', 'dev-server.json');

interface Visibility {
  page: string;
  seen: string[];
}

/** A dev server plus a reader on its bridge stream, collecting visibility messages. */
async function startStack(root: string, plugins: PluginOption[]) {
  const server = await createServer({ root, configFile: false, plugins, logLevel: 'silent', server: { port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls!.local[0]!;

  // The bridge writes its port shortly after listening.
  let port: number | undefined;
  for (let i = 0; i < 100 && port === undefined; i++) {
    if (existsSync(discoveryFile)) {
      const info = JSON.parse(readFileSync(discoveryFile, 'utf8')) as { pid: number; port: number };
      if (info.pid === process.pid) port = info.port;
    }
    if (port === undefined) await new Promise((r) => setTimeout(r, 50));
  }
  if (port === undefined) throw new Error('bridge did not start');

  const messages: Visibility[] = [];
  const request = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buffer.slice(0, nl)) as { type: string } & Visibility;
        buffer = buffer.slice(nl + 1);
        if (msg.type === 'visibility') messages.push({ page: msg.page, seen: msg.seen });
      }
    });
  });
  request.on('error', () => {});
  return {
    url,
    messages,
    seen: (page = '/') => new Set(messages.filter((m) => m.page === page).flatMap((m) => m.seen)),
    async close(this: void) {
      request.destroy();
      await server.close();
    },
  };
}

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Dwell (300 ms) + batch (500 ms) + margin. */
const SETTLE = 1300;

describe.skipIf(!existsSync(chrome))('sensor in headless Chrome', () => {
  let browser: Browser;
  let page: Page;
  let stack: Awaited<ReturnType<typeof startStack>>;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    stack = await startStack(path.join(here, 'fixture'), [changeSpotlight()]);
  });
  afterAll(async () => {
    await browser?.close();
    await stack?.close();
  });
  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(stack.url);
    await sleep(SETTLE);
  });

  it('reports only what is on screen at first, never hidden, transparent or zero-size elements', async () => {
    const seen = stack.seen();
    expect(seen.has('fx:top')).toBe(true);
    for (const loc of ['fx:pass', 'fx:target', 'fx:vis-hidden', 'fx:opacity', 'fx:zero']) expect(seen.has(loc)).toBe(false);
    await page.close();
  });

  it('reports an element after scrolling to it and staying', async () => {
    await page.evaluate(() => document.getElementById('target')!.scrollIntoView());
    await waitFor(() => stack.seen().has('fx:target'));
    await page.close();
  });

  it('does not report an element scrolled past in under 100 ms', async () => {
    stack.messages.length = 0;
    await page.evaluate(async () => {
      document.getElementById('pass')!.scrollIntoView();
      await new Promise((r) => setTimeout(r, 50));
      window.scrollTo(0, 0);
    });
    await sleep(SETTLE);
    expect(stack.seen().has('fx:pass')).toBe(false);
    await page.close();
  });

  it('reports elements mounted later, but not ones removed before the dwell ends', async () => {
    stack.messages.length = 0;
    await page.evaluate(async () => {
      const add = (loc: string) => {
        const el = document.createElement('div');
        el.className = 'box';
        el.setAttribute('data-cs-loc', loc);
        document.body.prepend(el);
        return el;
      };
      add('fx:late');
      const gone = add('fx:gone');
      await new Promise((r) => setTimeout(r, 100));
      gone.remove();
    });
    await waitFor(() => stack.seen().has('fx:late'));
    await sleep(SETTLE);
    expect(stack.seen().has('fx:gone')).toBe(false);
    await page.close();
  });

  it('reports an element three times the viewport height', async () => {
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.height = '300vh';
      el.setAttribute('data-cs-loc', 'fx:tall');
      document.body.prepend(el);
    });
    await waitFor(() => stack.seen().has('fx:tall'));
    await page.close();
  });

  it('treats a changed data-cs-loc as a new element', async () => {
    await page.evaluate(() => document.querySelector('[data-cs-loc="fx:top"]')!.setAttribute('data-cs-loc', 'fx:top-moved'));
    await waitFor(() => stack.seen().has('fx:top-moved'));
    await page.close();
  });

  it('attributes elements to the new page after pushState', async () => {
    await page.evaluate(() => history.pushState({}, '', '/other'));
    await waitFor(() => stack.seen('/other').has('fx:top'));
    await page.close();
  });
});

describe.skipIf(!existsSync(chrome))('playground in headless Chrome', () => {
  it('reports the footer only after scrolling to the bottom', async () => {
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    const stack = await startStack(path.join(repoRoot, 'playground'), [changeSpotlight(), reactSwc()]);
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      await page.goto(stack.url);
      await waitFor(() => stack.seen().size > 0, 15_000);
      await sleep(SETTLE);
      expect(stack.seen().has('playground/src/components/Counter.tsx:8-10')).toBe(true);
      expect(stack.seen().has('playground/src/App.tsx:12-14')).toBe(false);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await waitFor(() => stack.seen().has('playground/src/App.tsx:12-14'));
    } finally {
      await browser.close();
      await stack.close();
    }
  });
});
