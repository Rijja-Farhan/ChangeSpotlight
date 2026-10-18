/// <reference lib="dom" />
// Browser entry, served by the dev server only. Imports nothing from core at runtime:
// the protocol version is passed in by the virtual module.
import type { ClickMessage, VisibilityMessage } from '@change-spotlight/core';
import { connectOverlay } from './overlayData.js';
import { startOverlayLayer, type OverlayLayer } from './overlayLayer.js';
import { startSensor } from './sensor.js';

export interface HotChannel {
  send(event: string, data: unknown): void;
  on?(event: string, callback: (data: unknown) => void): void;
}

export function startClient({ protocolVersion, hot }: { protocolVersion: number; hot: HotChannel | undefined }): void {
  if (!hot) return; // no HMR channel: nowhere to report to
  connectOverlay(hot, protocolVersion);
  let layer: OverlayLayer | undefined;
  const startLayer = () => (layer = startOverlayLayer());
  if (document.body) startLayer();
  else document.addEventListener('DOMContentLoaded', startLayer, { once: true });

  const sensor = startSensor((batch) => {
    const message: VisibilityMessage = { protocolVersion, type: 'visibility', page: batch.page, seen: batch.seen };
    hot.send('cs:visibility', message);
  });
  // After a hot update the changed code may sit in an element whose range did not change; report
  // everything visible again so the extension can match it to the new change.
  hot.on?.('vite:afterUpdate', () => {
    sensor.resetReported();
    layer?.refresh();
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
