// Label text and label placement for the overlay's outlines, without any DOM, so it is unit-tested.
// overlayLayer.ts measures the page, calls these, and draws the result.
import type { OverlayItem } from '@change-spotlight/core';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const LABEL_HEIGHT = 22;
/** Space between a label and what it must not touch. */
export const LABEL_GAP = 4;
/** The outline is drawn this far outside the element's box (outline-offset + outline width). */
export const OUTLINE_OUTSET = 5;

/** "Counter.tsx:8": the file's basename and the first changed line. */
export function fileLine(item: Pick<OverlayItem, 'path' | 'line'>): string {
  return `${item.path.slice(item.path.lastIndexOf('/') + 1)}:${item.line}`;
}

export function labelText(item: Pick<OverlayItem, 'path' | 'line' | 'status' | 'seenHunks' | 'hunkIds'>): string {
  const where = fileLine(item);
  switch (item.status) {
    case 'seen':
      return `seen · ${where}`;
    case 'partly':
      return `${item.seenHunks}/${item.hunkIds.length} · ${where}`;
    case 'unseen':
      return `not seen yet · ${where}`;
  }
}

export interface LabelRequest {
  key: string;
  /** The outlined element's box, in viewport coordinates. */
  box: Rect;
  /** Label width in px (measured by the caller). */
  width: number;
}

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.width + LABEL_GAP && b.left < a.left + a.width + LABEL_GAP && a.top < b.top + b.height + LABEL_GAP && b.top < a.top + a.height + LABEL_GAP;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/**
 * Places each label just above its element's top-left corner (outside the outline). If that is
 * above the viewport, it goes inside the box at the top-left. A label that would overlap one placed
 * before it moves right past it, or down below it when there is no room on the right. Labels stay
 * inside the viewport horizontally. Requests are placed top to bottom, left to right.
 */
export function placeLabels(requests: readonly LabelRequest[], viewport: Viewport): Map<string, Rect> {
  const order = [...requests].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  const placed: Rect[] = [];
  const result = new Map<string, Rect>();

  for (const req of order) {
    const width = Math.min(req.width, viewport.width);
    const startLeft = clamp(req.box.left - OUTLINE_OUTSET, 0, viewport.width - width);
    let top = req.box.top - OUTLINE_OUTSET - LABEL_GAP - LABEL_HEIGHT;
    if (top < 0) top = Math.max(0, req.box.top + LABEL_GAP);
    const rect: Rect = { left: startLeft, top, width, height: LABEL_HEIGHT };

    // Each step moves past one blocking label, so this ends; the cap guards against odd input.
    for (let step = 0; step < 200; step++) {
      const blocker = placed.find((p) => overlaps(rect, p));
      if (!blocker) break;
      const right = blocker.left + blocker.width + LABEL_GAP;
      if (right + width <= viewport.width) {
        rect.left = right;
      } else {
        rect.left = startLeft;
        rect.top = blocker.top + blocker.height + LABEL_GAP;
      }
    }
    placed.push(rect);
    result.set(req.key, rect);
  }
  return result;
}

/** True when any part of `rect` (grown by `margin`) is inside the viewport. */
export function inViewport(rect: Rect, viewport: Viewport, margin = 0): boolean {
  return rect.left + rect.width >= -margin && rect.top + rect.height >= -margin && rect.left <= viewport.width + margin && rect.top <= viewport.height + margin;
}
