// SPIKE: plugin -> extension connection. Real transport (WebSocket + token) comes in Phase 6.
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { PROTOCOL_VERSION } from '@change-spotlight/core';

export interface Bridge {
  send(message: object): void;
  close(): void;
}

/**
 * Starts an HTTP server on 127.0.0.1 with a random port. The extension connects to
 * GET /events and receives one JSON object per line. The port goes into a discovery file.
 */
export function startBridge(repoRoot: string, log: (msg: string) => void): Bridge {
  const discoveryFile = path.join(repoRoot, '.change-spotlight', 'dev-server.json');
  const listeners = new Set<http.ServerResponse>();
  let port: number | undefined;

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/events') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    res.write(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: 'hello' }) + '\n');
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
  });

  server.on('error', (err) => log(`bridge error: ${err.message}`));
  server.listen(0, '127.0.0.1', () => {
    port = (server.address() as { port: number }).port;
    fs.mkdirSync(path.dirname(discoveryFile), { recursive: true });
    fs.writeFileSync(discoveryFile, JSON.stringify({ port, pid: process.pid, protocolVersion: PROTOCOL_VERSION }) + '\n');
  });

  // Only delete the discovery file if it is still ours: on a Vite restart the new server
  // may already have written its own port before the old one closes.
  const removeDiscoveryFile = () => {
    try {
      const current = JSON.parse(fs.readFileSync(discoveryFile, 'utf8')) as { port?: number };
      if (current.port === port) fs.rmSync(discoveryFile, { force: true });
    } catch {
      // already gone or unreadable: nothing to clean up
    }
  };
  // Ctrl+C (SIGINT) kills Vite without closing the server or firing 'exit', so clean up
  // on the signal, then re-raise it so the process still terminates the default way.
  const onSignal = (signal: NodeJS.Signals) => {
    removeDiscoveryFile();
    process.kill(process.pid, signal);
  };
  process.once('exit', removeDiscoveryFile);
  process.once('SIGINT', onSignal);
  process.once('SIGHUP', onSignal);

  return {
    send(message) {
      const line = JSON.stringify(message) + '\n';
      for (const res of listeners) res.write(line);
    },
    close() {
      process.off('exit', removeDiscoveryFile);
      process.off('SIGINT', onSignal);
      process.off('SIGHUP', onSignal);
      removeDiscoveryFile();
      for (const res of listeners) res.end();
      server.close();
    },
  };
}
