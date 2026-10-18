// VS Code wrapper around the bridge client: logs to the Output channel, re-exposes messages as a
// vscode.Event for the seen model, and never shows popups.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { startBridgeClient, type BridgeEvent } from './bridgeClient';
import { describeMessage } from './bridgeMessages';

export interface BridgeConnection extends vscode.Disposable {
  readonly onMessage: vscode.Event<BridgeEvent>;
  /** Fires when a dev server connects or disconnects. */
  readonly onDidChangeConnection: vscode.Event<void>;
  /** Number of connected dev servers. */
  connected(): number;
}

export function connectBridge(gitDir: string, output: vscode.OutputChannel): BridgeConnection {
  const emitter = new vscode.EventEmitter<BridgeEvent>();
  const connection = new vscode.EventEmitter<void>();
  const client = startBridgeClient({
    serversDir: path.join(gitDir, 'change-spotlight', 'servers'),
    log: (msg) => output.appendLine(msg),
  });
  const unsubscribe = client.onMessage((event) => {
    const text = describeMessage(JSON.stringify(event.message));
    if (text) output.appendLine(text);
    emitter.fire(event);
  });
  const unsubscribeConnection = client.onConnectionChange(() => connection.fire());
  return {
    onMessage: emitter.event,
    onDidChangeConnection: connection.event,
    connected: () => client.connected().length,
    dispose() {
      unsubscribe();
      unsubscribeConnection();
      client.dispose();
      emitter.dispose();
      connection.dispose();
    },
  };
}
