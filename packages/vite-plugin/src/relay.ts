// Relays the overlay from VS Code (bridge) to every page (Vite's HMR channel), and keeps the last
// one so a page that loads later gets it right away.
import type { OverlayMessage, ProtocolMessage } from '@change-spotlight/core';

export const OVERLAY_EVENT = 'cs:overlay';
/** Sent by a page when its client starts: "send me the overlay you have". */
export const OVERLAY_REQUEST_EVENT = 'cs:overlay-request';

export interface PageChannel {
  send(event: string, data: unknown): void;
}

export interface OverlayRelay {
  /** A message from VS Code over the bridge. */
  fromExtension(message: ProtocolMessage): void;
  /** A page asked for the overlay. */
  onRequest(page: PageChannel): void;
  latest(): OverlayMessage | undefined;
}

export function createOverlayRelay(pages: PageChannel, log: (msg: string) => void): OverlayRelay {
  let last: OverlayMessage | undefined;
  const ignored = new Set<string>();
  return {
    fromExtension(message) {
      if (message.type === 'overlay') {
        last = message;
        pages.send(OVERLAY_EVENT, message);
        return;
      }
      if (!ignored.has(message.type)) {
        ignored.add(message.type);
        log(`ignored ${message.type} message from VS Code`);
      }
    },
    onRequest(page) {
      if (last) page.send(OVERLAY_EVENT, last);
    },
    latest: () => last,
  };
}
