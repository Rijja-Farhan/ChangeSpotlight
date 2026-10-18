import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION } from '@change-spotlight/core';
import { createFilter, type FilterPattern, type Plugin } from 'vite';
import { startBridge, type Bridge, type BridgeInfo } from './bridge.js';
import { resolveId as resolveTarget } from './ids.js';
import { CLIENT_EVENTS, createMessageHandler } from './messages.js';
import { createOverlayRelay, OVERLAY_REQUEST_EVENT } from './relay.js';
import { tagHostElements } from './transform.js';

export interface ChangeSpotlightOptions {
  /** Set to false to turn the plugin off completely. Default true. */
  enabled?: boolean;
  /** Files to tag. Default: .jsx/.tsx files (/\.[jt]sx$/). */
  include?: FilterPattern;
  /** Files never to tag. Default: anything in node_modules. */
  exclude?: FilterPattern;
}

const CLIENT_ID = 'virtual:change-spotlight/client';
const RESOLVED_CLIENT_ID = '\0' + CLIENT_ID;

// The browser client is a real module in src/client/ (dist/client/ once built). The virtual module
// only imports it by absolute path; from src/ under Vitest that is the .ts file itself.
const clientFile = fileURLToPath(new URL(`./client/index.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`, import.meta.url));
const clientEntry = `import { startClient } from ${JSON.stringify('/@fs/' + clientFile.replace(/\\/g, '/').replace(/^\/+/, ''))};
startClient({ protocolVersion: ${JSON.stringify(PROTOCOL_VERSION)}, hot: import.meta.hot });
`;

/** One git call for the work tree root and the per-worktree git dir (.git may be a file in worktrees). */
function findRepo(dir: string): { root: string; gitDir: string } | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [root, gitDir] = out.split('\n');
    return root && gitDir ? { root, gitDir } : null;
  } catch {
    return null;
  }
}

/** What the plugin exposes to other plugins and tests via `plugin.api`. */
export interface ChangeSpotlightApi {
  bridgeInfo(): Promise<BridgeInfo | null>;
}

export default function changeSpotlight(options: ChangeSpotlightOptions = {}): Plugin<ChangeSpotlightApi> {
  if (options.enabled === false) return { name: 'change-spotlight', apply: () => false, api: { bridgeInfo: async () => null } };

  const filter = createFilter(options.include ?? /\.[jt]sx$/, options.exclude ?? /\/node_modules\//);
  let repoRoot = process.cwd();
  let gitDir: string | undefined;
  let viteRoot = process.cwd();
  let bridge: Bridge | undefined;
  const closeBridge = async () => {
    const closing = bridge;
    bridge = undefined;
    await closing?.close();
  };

  return {
    name: 'change-spotlight',
    apply: 'serve',
    enforce: 'pre',

    api: {
      bridgeInfo: async () => (bridge ? bridge.info() : null),
    },

    configResolved(config) {
      const repo = findRepo(config.root);
      if (!repo) config.logger.info('[change-spotlight] not in a git repository: paths are relative to the Vite root and VS Code is not notified');
      repoRoot = repo?.root ?? config.root;
      gitDir = repo?.gitDir;
      viteRoot = config.root;
    },

    configureServer(server) {
      const log = (msg: string) => server.config.logger.info(`[change-spotlight] ${msg}`);
      const relay = createOverlayRelay(server.ws, log);
      if (gitDir) bridge = startBridge({ root: repoRoot, gitDir, viteRoot, log, onMessage: (m) => relay.fromExtension(m) });
      server.httpServer?.once('close', () => void closeBridge());

      for (const event of Object.keys(CLIENT_EVENTS) as (keyof typeof CLIENT_EVENTS)[]) {
        server.ws.on(event, createMessageHandler(event, (message) => bridge?.send(message), log));
      }
      server.ws.on(OVERLAY_REQUEST_EVENT, (_data, client) => relay.onRequest(client));
    },

    // Vite calls this on server.close(), also for middleware-mode servers that have no httpServer.
    closeBundle: closeBridge,

    resolveId(id) {
      return id === CLIENT_ID ? RESOLVED_CLIENT_ID : undefined;
    },

    load(id) {
      return id === RESOLVED_CLIENT_ID ? clientEntry : undefined;
    },

    // order 'pre' so Vite still processes the injected inline module and rewrites the virtual import.
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [{ tag: 'script', attrs: { type: 'module' }, children: `import '${CLIENT_ID}';`, injectTo: 'head' }];
      },
    },

    transform(code, id) {
      const target = resolveTarget(id, repoRoot);
      if (!target || !filter(target.file)) return;
      return tagHostElements(code, { filename: target.file, relPath: target.relPath, lang: target.lang });
    },
  };
}
