import { describe, expect, it } from 'vitest';
import { CARD_WIDTH, cardPreview, cardStatus, cardTitle, placeCard } from '../src/client/card.js';

const viewport = { width: 800, height: 600 };

describe('hover card text', () => {
  it('names the file and the changed lines', () => {
    expect(cardTitle({ path: 'playground/src/components/Counter.tsx', line: 8, endLine: 10 })).toBe('Counter.tsx · lines 8–10');
    expect(cardTitle({ path: 'src/App.tsx', line: 3, endLine: 3 })).toBe('App.tsx · line 3');
  });

  it('shows the preview as a diff line', () => {
    expect(cardPreview({ preview: 'onClick={() => setCount((c) => c + 1)}' })).toBe('+ onClick={() => setCount((c) => c + 1)}');
    expect(cardPreview({ preview: 'deleted: <hr/>' })).toBe('- <hr/>');
    expect(cardPreview({ preview: '' })).toBe('');
  });

  it('says the status in words', () => {
    expect(cardStatus({ status: 'unseen', seenHunks: 0, hunkIds: ['a'] })).toBe('Not seen yet · 1 change');
    expect(cardStatus({ status: 'partly', seenHunks: 1, hunkIds: ['a', 'b'] })).toBe('Partly seen: 1 of 2 changes');
    expect(cardStatus({ status: 'seen', seenHunks: 2, hunkIds: ['a', 'b'] })).toBe('Seen · 2 changes');
  });
});

describe('placeCard', () => {
  const label = (left: number, top: number) => ({ left, top, width: 150, height: 22 });
  it('goes below the label, or above when there is no room below', () => {
    expect(placeCard(label(100, 100), 130, viewport)).toEqual({ left: 100, top: 128 });
    expect(placeCard(label(100, 500), 130, viewport)).toEqual({ left: 100, top: 364 });
  });
  it('stays inside the viewport horizontally', () => {
    expect(placeCard(label(700, 100), 130, viewport).left).toBe(800 - CARD_WIDTH);
  });
});
