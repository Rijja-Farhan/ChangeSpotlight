// Validates browser -> plugin messages before they reach the bridge.
import { parseMessage, type ProtocolMessage } from '@change-spotlight/core';

export const CLIENT_EVENTS = { 'cs:click': 'click', 'cs:visibility': 'visibility' } as const;

/**
 * Returns a handler for one HMR custom event. Valid messages of the expected type are forwarded;
 * anything else is dropped, and each distinct reason is logged once.
 */
export function createMessageHandler(
  event: keyof typeof CLIENT_EVENTS,
  forward: (message: ProtocolMessage) => void,
  log: (msg: string) => void,
): (data: unknown) => void {
  const logged = new Set<string>();
  return (data) => {
    const result = parseMessage(data);
    const reason = !result.ok ? result.reason : result.message.type !== CLIENT_EVENTS[event] ? 'wrong-type' : null;
    if (reason === null && result.ok) {
      forward(result.message);
      return;
    }
    if (reason && !logged.has(reason)) {
      logged.add(reason);
      log(`dropped ${event} message (${reason})`);
    }
  };
}
