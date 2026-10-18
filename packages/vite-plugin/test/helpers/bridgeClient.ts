// Minimal test client for the bridge: does the handshake and collects messages.
import { PROTOCOL_VERSION, type ProtocolMessage } from '@change-spotlight/core';
import WebSocket from 'ws';

export interface TestClient {
  messages: ProtocolMessage[];
  ws: WebSocket;
  close(): void;
}

/** Connects and resolves after the welcome, or rejects with the close code. */
export function connectClient(port: number, token: string, hello: object = {}): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: ProtocolMessage[] = [];
    let welcomed = false;
    ws.on('open', () => ws.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: 'hello', token, ...hello })));
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ProtocolMessage;
      if (!welcomed && message.type === 'welcome') {
        welcomed = true;
        resolve({ messages, ws, close: () => ws.close() });
        return;
      }
      messages.push(message);
    });
    ws.on('close', (code, reason) => {
      if (!welcomed) reject(Object.assign(new Error(`closed ${code}`), { code, reason: reason.toString() }));
    });
    ws.on('error', () => {});
  });
}
