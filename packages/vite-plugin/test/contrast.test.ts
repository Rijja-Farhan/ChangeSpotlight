// The overlay's colour pairs meet WCAG contrast: 4.5:1 for text, 3:1 for outlines on a white page.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sources = ['overlayLayer', 'finderUi', 'card'].map((f) => readFileSync(new URL(`../src/client/${f}.ts`, import.meta.url), 'utf8')).join('\n');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT: [fg: string, bg: string, where: string][] = [
  ['#ffffff', '#b45309', 'unseen label, edge arrow'],
  ['#ffffff', '#15803d', 'seen label'],
  ['#ffffff', '#1f4fd1', 'counting label'],
  ['#f6f5f2', '#1d1c1a', 'pill, panel, card text'],
  ['#c9c5bc', '#1d1c1a', 'panel summary, card status'],
  ['#a8a49b', '#1d1c1a', 'section headings, muted notes'],
  ['#d8d5ce', '#1d1c1a', 'footer labels'],
  ['#fbbf72', '#1d1c1a', 'Scroll to / Open page, card title'],
  ['#d8d5ce', '#2b2926', 'card code preview'],
  ['#1d1c1a', '#f6f5f2', 'Open in VS Code button'],
  ['#f6f5f2', '#34322e', 'eye button, close button'],
];
const GRAPHICS: [fg: string, bg: string, where: string][] = [
  ['#b45309', '#ffffff', 'unseen outline'],
  ['#15803d', '#ffffff', 'seen outline'],
  ['#1f4fd1', '#ffffff', 'counting outline'],
  ['#fbbf72', '#1d1c1a', 'focus ring on dark controls'],
];

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it.each(TEXT)('text %s on %s (%s) is at least 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(GRAPHICS)('outline %s on %s (%s) is at least 3:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it('checks colours the overlay really uses', () => {
    for (const [fg, bg] of [...TEXT, ...GRAPHICS]) for (const c of [fg, bg]) if (c !== '#ffffff') expect(sources.toLowerCase()).toContain(c);
  });
});
