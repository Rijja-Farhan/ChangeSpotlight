// Extension side of the plugin <-> extension connection. No `vscode` import, so Vitest can run
// it against the real plugin server. Connects to every live dev server listed in
// <gitDir>/change-spotlight/servers/, reconnects quietly with backoff, and detects dead servers.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CLOSE_CODES, parseMessage, parseServerInfo, PROTOCOL_VERSION, type ProtocolMessage, type ServerInfo } from '@change-spotlight/core';
import WebSocket from 'ws';

export const MAX_PAYLOAD = 1024 * 1024;

export interface BridgeClientOptions {
  serversDir: string;
  log: (msg: string) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** Treat a server as dead when no ping arrives for this long (server pings every 10 s). */
  heartbeatTimeoutMs?: number;
}

export interface BridgeEvent {
  /** Discovery file name, e.g. "1234-40000.json". */
  serverId: string;
  message: ProtocolMessage;
}

export interface ConnectionEvent {
  serverId: string;
  connected: boolean;
  info: ServerInfo;
}

export interface BridgeClient {
  onMessage(listener: (event: BridgeEvent) => void): () => void;
  onConnectionChange(listener: (event: ConnectionEvent) => void): () => void;
  /** Currently connected server ids. */
  connected(): string[];
  /** Send to every connected server; returns how many it went to. */
  send(message: ProtocolMessage): number;
  dispose(): void;
}

/** Exponential backoff: initial, 2x, 4x … capped at max; reset() after a successful handshake. */
export class Backoff {
  private attempt = 0;
  constructor(
    private readonly initialMs: number,
    private readonly maxMs: number,
  ) {}
  next(): number {
    const delay = Math.min(this.initialMs * 2 ** this.attempt, this.maxMs);
    if (delay < this.maxMs) this.attempt++;
    return delay;
  }
  reset(): void {
    this.attempt = 0;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface Entry {
  id: string;
  raw: string;
  info: ServerInfo;
  ws?: WebSocket;
  welcomed: boolean;
  /** After a bad-token or version close: wait until the file changes. */
  blocked: boolean;
  backoff: Backoff;
  retryTimer?: ReturnType<typeof setTimeout>;
  heartbeatTimer?: ReturnType<typeof setTimeout>;
}

export function startBridgeClient(options: BridgeClientOptions): BridgeClient {
  const { serversDir, log } = options;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 25_000;
  const entries = new Map<string, Entry>();
  const messageListeners = new Set<(e: BridgeEvent) => void>();
  const connectionListeners = new Set<(e: ConnectionEvent) => void>();
  let disposed = false;

  const emitConnection = (entry: Entry, connected: boolean) => {
    for (const l of connectionListeners) l({ serverId: entry.id, connected, info: entry.info });
  };

  const armHeartbeat = (entry: Entry) => {
    clearTimeout(entry.heartbeatTimer);
    entry.heartbeatTimer = setTimeout(() => entry.ws?.terminate(), heartbeatTimeoutMs);
  };

  const drop = (entry: Entry) => {
    clearTimeout(entry.retryTimer);
    clearTimeout(entry.heartbeatTimer);
    const ws = entry.ws;
    entry.ws = undefined;
    if (ws) {
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.terminate();
    }
    if (entry.welcomed) {
      entry.welcomed = false;
      log(`Disconnected from Vite dev server pid ${entry.info.pid}.`);
      emitConnection(entry, false);
    }
  };

  const scheduleRetry = (entry: Entry) => {
    if (disposed || entry.blocked || entries.get(entry.id) !== entry) return;
    clearTimeout(entry.retryTimer);
    entry.retryTimer = setTimeout(() => connect(entry), entry.backoff.next());
  };

  const connect = (entry: Entry) => {
    if (disposed || entries.get(entry.id) !== entry) return;
    const ws = new WebSocket(`ws://127.0.0.1:${entry.info.port}`, { maxPayload: MAX_PAYLOAD });
    entry.ws = ws;
    ws.on('open', () => ws.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: 'hello', token: entry.info.token })));
    ws.on('ping', () => armHeartbeat(entry));
    ws.on('message', (data) => {
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        return;
      }
      const result = parseMessage(value);
      if (!result.ok) return;
      if (!entry.welcomed) {
        if (result.message.type !== 'welcome') return;
        entry.welcomed = true;
        entry.backoff.reset();
        armHeartbeat(entry);
        log(`Connected to Vite dev server pid ${entry.info.pid}, port ${entry.info.port}.`);
        emitConnection(entry, true);
        return;
      }
      for (const l of messageListeners) l({ serverId: entry.id, message: result.message });
    });
    ws.on('close', (code, reason) => {
      if (entry.ws !== ws) return;
      entry.ws = undefined;
      clearTimeout(entry.heartbeatTimer);
      if (entry.welcomed) {
        entry.welcomed = false;
        log(`Disconnected from Vite dev server pid ${entry.info.pid}.`);
        emitConnection(entry, false);
      }
      if (code === CLOSE_CODES.badToken || code === CLOSE_CODES.versionMismatch) {
        entry.blocked = true;
        log(
          code === CLOSE_CODES.badToken
            ? `Vite dev server pid ${entry.info.pid} rejected our token; waiting for it to restart.`
            : `Vite dev server pid ${entry.info.pid} speaks protocol ${reason.toString()}, we speak ${PROTOCOL_VERSION}; update Change Spotlight so both match.`,
        );
        return;
      }
      scheduleRetry(entry);
    });
    ws.on('error', () => {}); // 'close' follows; failed retries stay silent
  };

  const rescan = () => {
    if (disposed) return;
    let names: string[] = [];
    try {
      names = fs.readdirSync(serversDir).filter((n) => n.endsWith('.json'));
    } catch {
      // directory vanished; treat as empty
    }
    const seen = new Set<string>();
    for (const name of names) {
      let raw: string;
      try {
        raw = fs.readFileSync(path.join(serversDir, name), 'utf8');
      } catch {
        continue;
      }
      let info: ServerInfo | null = null;
      try {
        info = parseServerInfo(JSON.parse(raw));
      } catch {
        info = null;
      }
      if (!info || !isAlive(info.pid)) continue;
      seen.add(name);
      const existing = entries.get(name);
      if (existing && existing.raw === raw) continue;
      if (existing) drop(existing);
      const entry: Entry = {
        id: name,
        raw,
        info,
        welcomed: false,
        blocked: false,
        backoff: new Backoff(options.initialBackoffMs ?? 250, options.maxBackoffMs ?? 5000),
      };
      entries.set(name, entry);
      connect(entry); // new or changed file: try right away
    }
    for (const [name, entry] of entries) {
      if (seen.has(name)) continue;
      entries.delete(name);
      drop(entry);
    }
  };

  fs.mkdirSync(serversDir, { recursive: true });
  let rescanTimer: ReturnType<typeof setTimeout> | undefined;
  const watcher = fs.watch(serversDir, () => {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(rescan, 20); // coalesce the burst of events a rename produces
  });
  watcher.on('error', () => {});
  rescan();

  return {
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onConnectionChange(listener) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    connected: () => [...entries.values()].filter((e) => e.welcomed).map((e) => e.id),
    send(message) {
      const text = JSON.stringify(message);
      let sent = 0;
      for (const entry of entries.values()) {
        if (!entry.welcomed || entry.ws?.readyState !== WebSocket.OPEN) continue;
        entry.ws.send(text);
        sent++;
      }
      return sent;
    },
    dispose() {
      disposed = true;
      clearTimeout(rescanTimer);
      watcher.close();
      for (const entry of entries.values()) {
        entry.welcomed = false; // no "Disconnected" log on shutdown
        drop(entry);
      }
      entries.clear();
    },
  };
}
