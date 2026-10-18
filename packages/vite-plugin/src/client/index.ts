/// <reference lib="dom" />
// Browser entry, served by the dev server only. Imports nothing from core at runtime:
// the protocol version is passed in by the virtual module.
import type { ClickMessage, VisibilityMessage } from '@change-spotlight/core';
import { startSensor } from './sensor.js';

export interface HotChannel {
  send(event: string, data: unknown): void;
}

export function startClient({ protocolVersion, hot }: { protocolVersion: number; hot: HotChannel | undefined }): void {
  if (!hot) return; // no HMR channel: nowhere to report to

  startSensor((batch) => {
    const message: VisibilityMessage = { protocolVersion, type: 'visibility', page: batch.page, seen: batch.seen };
    hot.send('cs:visibility', message);
  });

  document.addEventListener(
    'click',
    (event) => {
      const el = event.target instanceof Element ? event.target.closest('[data-cs-loc]') : null;
      const loc = el?.getAttribute('data-cs-loc');
      if (!loc) return;
      const message: ClickMessage = { protocolVersion, type: 'click', loc, page: location.pathname };
      hot.send('cs:click', message);
    },
    true,
  );
}
