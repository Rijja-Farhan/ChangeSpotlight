/// <reference lib="dom" />
// Thin DOM adapter: watches [data-cs-loc] elements and feeds the SeenTracker. All decisions
// live in seen.ts. No layout reads in observer callbacks except IntersectionObserver entry data.
import { SeenTracker, type Batch } from './seen.js';

const ATTR = 'data-cs-loc';
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

export interface Sensor {
  stop(): void;
}

export function startSensor(onBatch: (batch: Batch) => void): Sensor {
  const tracker = new SeenTracker<Element>({
    timers: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (h) => window.clearTimeout(h as number) },
    page: location.pathname,
    canCommit: (el) =>
      el.isConnected && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ opacityProperty: true, visibilityProperty: true })),
    onBatch,
  });

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const loc = entry.target.getAttribute(ATTR);
        if (loc === null) continue;
        const viewportHeight = entry.rootBounds?.height || window.innerHeight;
        const viewportWidth = entry.rootBounds?.width || window.innerWidth;
        const box = entry.boundingClientRect;
        tracker.update(entry.target, {
          loc,
          ratio: entry.intersectionRatio,
          viewportCoverage: viewportHeight > 0 ? entry.intersectionRect.height / viewportHeight : 0,
          tall: box.height > viewportHeight || box.width > viewportWidth,
          hasSize: box.width > 0 && box.height > 0,
        });
      }
    },
    { threshold: THRESHOLDS },
  );

  const observeTree = (node: Node) => {
    if (!(node instanceof Element)) return;
    if (node.hasAttribute(ATTR)) io.observe(node);
    for (const el of node.querySelectorAll(`[${ATTR}]`)) io.observe(el);
  };
  const forgetTree = (node: Node) => {
    if (!(node instanceof Element)) return;
    const all = node.hasAttribute(ATTR) ? [node, ...node.querySelectorAll(`[${ATTR}]`)] : [...node.querySelectorAll(`[${ATTR}]`)];
    for (const el of all) {
      io.unobserve(el);
      tracker.remove(el);
    }
  };

  const mo = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        // A changed data-cs-loc (HMR shifted lines) is a new loc: start over with a fresh entry.
        const el = record.target as Element;
        io.unobserve(el);
        tracker.remove(el);
        if (el.hasAttribute(ATTR)) io.observe(el);
        continue;
      }
      for (const node of record.removedNodes) forgetTree(node);
      for (const node of record.addedNodes) observeTree(node);
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: [ATTR] });
  observeTree(document.documentElement);

  const updateActive = () => tracker.setActive(document.visibilityState === 'visible' && document.hasFocus());
  const onVisibility = () => {
    updateActive();
    if (document.visibilityState === 'hidden') tracker.flush();
  };
  const onPageHide = () => tracker.flush();
  const onRoute = () => tracker.setPage(location.pathname);

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', updateActive);
  window.addEventListener('blur', updateActive);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('popstate', onRoute);

  // SPA routers change the URL with pushState/replaceState, which fire no event.
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  history.pushState = function (...args: Parameters<History['pushState']>) {
    originalPush.apply(this, args);
    onRoute();
  };
  history.replaceState = function (...args: Parameters<History['replaceState']>) {
    originalReplace.apply(this, args);
    onRoute();
  };
  updateActive();

  return {
    stop() {
      tracker.flush();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', updateActive);
      window.removeEventListener('blur', updateActive);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('popstate', onRoute);
      history.pushState = originalPush;
      history.replaceState = originalReplace;
    },
  };
}
