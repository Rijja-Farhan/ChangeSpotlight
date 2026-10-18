// SPIKE: extension side of the plugin -> extension connection. Real version comes in Phase 6.
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as vscode from 'vscode';
import { PROTOCOL_VERSION } from '@change-spotlight/core';

const DISCOVERY_FILE = '.change-spotlight/dev-server.json';

/**
 * Watches the discovery file the Vite plugin writes, connects to its /events feed,
 * and logs every message. All failures are logged quietly; no popups.
 */
export function startBridgeClient(repoRoot: string, output: vscode.OutputChannel): vscode.Disposable {
  let current: http.ClientRequest | undefined;

  const disconnect = () => {
    current?.destroy();
    current = undefined;
  };

  const connect = () => {
    disconnect();
    let port: number;
    try {
      const info = JSON.parse(fs.readFileSync(`${repoRoot}/${DISCOVERY_FILE}`, 'utf8')) as { port?: unknown };
      if (typeof info.port !== 'number') return;
      port = info.port;
    } catch {
      return; // no dev server running (or file half-written; the next change event retries)
    }

    const req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      output.appendLine(`Connected to Vite plugin on port ${port}.`);
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          handleLine(buffer.slice(0, newline), output);
          buffer = buffer.slice(newline + 1);
        }
      });
      res.on('end', () => {
        if (current === req) output.appendLine('Vite plugin disconnected.');
      });
    });
    req.on('error', (err) => {
      if (current === req) output.appendLine(`Could not reach Vite plugin on port ${port}: ${err.message}`);
    });
    current = req;
  };

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(repoRoot), DISCOVERY_FILE),
  );
  watcher.onDidCreate(connect);
  watcher.onDidChange(connect);
  watcher.onDidDelete(() => {
    if (current) output.appendLine('Vite dev server stopped.');
    disconnect();
  });
  connect(); // Vite may already be running when VS Code starts

  return new vscode.Disposable(() => {
    disconnect();
    watcher.dispose();
  });
}

function handleLine(line: string, output: vscode.OutputChannel): void {
  let message: { protocolVersion?: unknown; type?: unknown; loc?: unknown; page?: unknown };
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.protocolVersion !== PROTOCOL_VERSION) {
    output.appendLine(`Ignored message with protocol version ${String(message.protocolVersion)} (expected ${PROTOCOL_VERSION}).`);
    return;
  }
  if (message.type === 'click' && typeof message.loc === 'string') {
    // loc is "path:start-end"; report "path:start" like a normal file:line reference.
    const match = /^(.*):(\d+)-(\d+)$/.exec(message.loc);
    const fileLine = match ? `${match[1]}:${match[2]}` : message.loc;
    output.appendLine(`Clicked ${fileLine}  (element spans ${message.loc}, page ${String(message.page)})`);
  }
}
