// Runs the real Vite pipeline on the playground with each React plugin.
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import react from '@vitejs/plugin-react';
import reactSwc from '@vitejs/plugin-react-swc';
import { build, createServer, type PluginOption } from 'vite';
import { describe, expect, it } from 'vitest';
import changeSpotlight from '../src/index.js';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const playground = path.join(repoRoot, 'playground');
const serversDir = path.join(repoRoot, '.git', 'change-spotlight', 'servers');
const entries = () => (existsSync(serversDir) ? readdirSync(serversDir) : []);

async function transform(plugins: PluginOption[], url: string) {
  const server = await createServer({ root: playground, configFile: false, plugins, server: { middlewareMode: true, ws: false }, logLevel: 'silent' });
  try {
    const result = await server.transformRequest(url);
    if (!result) throw new Error(`no result for ${url}`);
    return result;
  } finally {
    await server.close();
  }
}

function originalOf(code: string, map: unknown, token: string) {
  const index = code.indexOf(token);
  const before = code.slice(0, index);
  const generated = { line: before.split('\n').length, column: index - (before.lastIndexOf('\n') + 1) };
  const { line, column } = originalPositionFor(new TraceMap(map as never), generated);
  return { line, column };
}

describe.each([
  ['@vitejs/plugin-react', () => react()],
  ['@vitejs/plugin-react-swc', () => reactSwc()],
])('with %s', (_name, makeReact) => {
  it('tags host elements, keeps React Refresh, and keeps source maps as accurate as without us', async () => {
    const before = entries();
    const tagged = await transform([changeSpotlight(), makeReact()], '/src/components/Counter.tsx');
    const plain = await transform([makeReact()], '/src/components/Counter.tsx');

    expect(tagged.code).toContain('playground/src/components/Counter.tsx:6-11');
    expect(tagged.code).toContain('playground/src/components/Counter.tsx:8-10');
    expect(tagged.code).toContain('$RefreshReg$');
    for (const token of ['setCount((c)', 'useState(0)', 'onClick']) {
      expect(originalOf(tagged.code, tagged.map, token)).toEqual(originalOf(plain.code, plain.map, token));
    }
    expect(entries()).toEqual(before); // servers removed their discovery files on close
  });

  it('does not tag components', async () => {
    const app = await transform([changeSpotlight(), makeReact()], '/src/App.tsx');
    expect(app.code).toContain('playground/src/App.tsx:');
    expect(app.code).not.toMatch(/Counter[^\n]*data-cs-loc/);
  });
});

describe('production build', () => {
  it.each([
    ['@vitejs/plugin-react', () => react()],
    ['@vitejs/plugin-react-swc', () => reactSwc()],
  ])('contains no tags with %s', async (_name, makeReact) => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'cs-build-'));
    // Vitest sets NODE_ENV=test, which makes the React plugins emit dev JSX (with absolute file
    // paths). Build the way `vite build` does.
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await build({ root: playground, configFile: false, mode: 'production', plugins: [changeSpotlight(), makeReact()], logLevel: 'silent', build: { outDir, emptyOutDir: true } });
      const js = readdirSync(path.join(outDir, 'assets')).filter((f) => f.endsWith('.js'));
      expect(js.length).toBeGreaterThan(0);
      for (const f of js) {
        const text = readFileSync(path.join(outDir, 'assets', f), 'utf8');
        for (const marker of ['data-cs-loc', 'virtual:change-spotlight', 'cs:click']) expect(text).not.toContain(marker);
      }
    } finally {
      process.env.NODE_ENV = env;
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe('options', () => {
  it('enabled: false turns the plugin off', async () => {
    const result = await transform([changeSpotlight({ enabled: false }), reactSwc()], '/src/components/Counter.tsx');
    expect(result.code).not.toContain('data-cs-loc');
  });

  it('exclude skips matching files', async () => {
    const result = await transform([changeSpotlight({ exclude: /Counter/ }), reactSwc()], '/src/components/Counter.tsx');
    expect(result.code).not.toContain('data-cs-loc');
  });

  it('include limits tagging to matching files', async () => {
    const counter = await transform([changeSpotlight({ include: /App\.tsx$/ }), reactSwc()], '/src/components/Counter.tsx');
    expect(counter.code).not.toContain('data-cs-loc');
    const app = await transform([changeSpotlight({ include: /App\.tsx$/ }), reactSwc()], '/src/App.tsx');
    expect(app.code).toContain('data-cs-loc');
  });
});
