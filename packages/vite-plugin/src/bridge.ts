// Plugin side of the plugin <-> extension connection: a WebSocket server on 127.0.0.1 with a
// random port and a per-server token, advertised through a discovery file inside .git/.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { CLOSE_CODES, parseMessage, parseServerInfo, PROTOCOL_VERSION, readHello, type ProtocolMessage, type ServerInfo } from '@change-spotlight/core';
import { WebSocketServer, type WebSocket } from 'ws';

export const MAX_PAYLOAD = 1024 * 1024;

export interface BridgeOptions {
  /** Repo root (git work tree top level). */
  root: string;
  /** Per-worktree git dir; discovery files live in <gitDir>/change-spotlight/servers/. */
  gitDir: string;
  viteRoot: string;
  log: (msg: string) => void;
  /** Messages a client sends after the handshake (reserved for extension -> plugin features). */
  onMessage?: (message: ProtocolMessage) => void;
  pingIntervalMs?: number;
  handshakeTimeoutMs?: number;
}

export interface BridgeInfo {
  port: number;
  token: string;
  /** Absolute path of this server's discovery file. */
  file: string;
}

export interface Bridge {
  /** Broadcast to every authenticated client. */
  send(message: ProtocolMessage): void;
  /** Resolves once listening; null if the server failed to start. */
  info(): Promise<BridgeInfo | null>;
  close(): Promise<void>;
}

export function serversDir(gitDir: string): string {
  return path.join(gitDir, 'change-spotlight', 'servers');
}

/** process.kill(pid, 0) throws ESRCH for a dead process; EPERM means it exists but isn't ours. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Deletes discovery files left behind by crashed dev servers. */
export function removeStaleEntries(dir: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    let info: ServerInfo | null = null;
    try {
      info = parseServerInfo(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      // unreadable or half-written: judge by the pid in the name
    }
    const pid = info?.pid ?? Number(name.split('-')[0]);
    if (Number.isSafeInteger(pid) && pid > 0 && !isAlive(pid)) fs.rmSync(file, { force: true });
  }
}

function tokensEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function startBridge(options: BridgeOptions): Bridge {
  const dir = serversDir(options.gitDir);
  const token = randomBytes(32).toString('hex');
  const authenticated = new Set<WebSocket>();
  let file: string | undefined;
  let closed = false;

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // e.g. Windows: modes are ignored there; the repo's .git ACLs apply
  }
  removeStaleEntries(dir);

  const http_ = http.createServer((_req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' }).end('WebSocket only\n');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  http_.on('upgrade', (req, socket, head) => {
    // Browsers always send Origin; the extension never does. Web pages may open WebSockets to
    // localhost without any CORS check, so refuse anything that looks like a browser.
    if (req.headers.origin !== undefined) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket & { alive?: boolean }) => {
    ws.alive = true;
    ws.on('pong', () => (ws.alive = true));
    const handshakeTimer = setTimeout(() => ws.close(CLOSE_CODES.handshakeTimeout, 'no hello'), options.handshakeTimeoutMs ?? 2000);

    ws.on('message', (data) => {
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        value = undefined;
      }
      if (!authenticated.has(ws)) {
        clearTimeout(handshakeTimer);
        const hello = readHello(value);
        if (!hello) return ws.close(CLOSE_CODES.protocolError, 'expected hello');
        if (hello.protocolVersion !== PROTOCOL_VERSION) return ws.close(CLOSE_CODES.versionMismatch, String(PROTOCOL_VERSION));
        if (typeof hello.token !== 'string' || !tokensEqual(hello.token, token)) return ws.close(CLOSE_CODES.badToken, 'bad token');
        authenticated.add(ws);
        ws.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: 'welcome' }));
        return;
      }
      const result = parseMessage(value);
      if (result.ok) options.onMessage?.(result.message);
    });
    ws.on('close', () => {
      clearTimeout(handshakeTimer);
      authenticated.delete(ws);
    });
    ws.on('error', () => {});
  });

  // Heartbeat: clients that miss a pong are dead (e.g. VS Code killed); drop them.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients as Set<WebSocket & { alive?: boolean }>) {
      if (client.alive === false) {
        client.terminate();
        continue;
      }
      client.alive = false;
      client.ping();
    }
  }, options.pingIntervalMs ?? 10_000);
  heartbeat.unref();

  const removeFile = () => {
    if (file) fs.rmSync(file, { force: true });
  };
  // Ctrl+C (SIGINT) kills Vite without closing the server or firing 'exit': clean up on the
  // signal, then re-raise it so the process still terminates the default way.
  const onSignal = (signal: NodeJS.Signals) => {
    removeFile();
    process.kill(process.pid, signal);
  };
  process.once('exit', removeFile);
  process.once('SIGINT', onSignal);
  process.once('SIGHUP', onSignal);

  const ready = new Promise<BridgeInfo | null>((resolve) => {
    http_.once('error', (err) => {
      options.log(`bridge could not start: ${err.message}`);
      resolve(null);
    });
    http_.listen(0, '127.0.0.1', () => {
      if (closed) return resolve(null);
      const port = (http_.address() as { port: number }).port;
      const info: ServerInfo = { protocolVersion: PROTOCOL_VERSION, pid: process.pid, port, token, root: options.root, viteRoot: options.viteRoot };
      file = path.join(dir, `${process.pid}-${port}.json`);
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(info) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file); // atomic: readers never see a half-written file
      resolve({ port, token, file });
    });
  });

  return {
    send(message) {
      const text = JSON.stringify(message);
      for (const ws of authenticated) ws.send(text);
    },
    info: () => ready,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      process.off('exit', removeFile);
      process.off('SIGINT', onSignal);
      process.off('SIGHUP', onSignal);
      removeFile();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => http_.close(() => resolve()));
    },
  };
}
