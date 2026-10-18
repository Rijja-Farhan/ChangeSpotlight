// VS Code wrapper around the bridge client: logs to the Output channel, re-exposes messages as a
// vscode.Event for the seen model, and never shows popups.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { startBridgeClient, type BridgeEvent } from './bridgeClient';
import { describeMessage } from './bridgeMessages';

export interface BridgeConnection extends vscode.Disposable {
  readonly onMessage: vscode.Event<BridgeEvent>;
}

export function connectBridge(gitDir: string, output: vscode.OutputChannel): BridgeConnection {
  const emitter = new vscode.EventEmitter<BridgeEvent>();
  const client = startBridgeClient({
    serversDir: path.join(gitDir, 'change-spotlight', 'servers'),
    log: (msg) => output.appendLine(msg),
  });
  const unsubscribe = client.onMessage((event) => {
    const text = describeMessage(JSON.stringify(event.message));
    if (text) output.appendLine(text);
    emitter.fire(event);
  });
  return {
    onMessage: emitter.event,
    dispose() {
      unsubscribe();
      client.dispose();
      emitter.dispose();
    },
  };
}
