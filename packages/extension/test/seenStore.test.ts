import { describe, expect, it } from 'vitest';
import { SeenStore, seenKey } from '../src/seenStore';
import { memento } from './memento';

describe('SeenStore', () => {
  const snap = { version: 1 as const, entries: { a: { ownerCount: 1, seenOwners: [0], pages: ['/'], lastInDiffAt: 1 } } };

  it('round-trips a snapshot per repo and branch', async () => {
    const m = memento();
    const store = new SeenStore(m);
    await store.save('/repo', 'feature', snap);
    expect(store.load('/repo', 'feature')).toEqual(snap);
    expect(store.load('/repo', 'other')).toBeNull();
    expect(store.load('/other-repo', 'feature')).toBeNull();
    expect([...m.data.keys()]).toEqual(['changeSpotlight.seen.v1:/repo:feature']);
  });

  it('uses "detached" for a detached HEAD, and clears', async () => {
    const store = new SeenStore(memento());
    expect(seenKey('/r', null)).toBe('changeSpotlight.seen.v1:/r:detached');
    await store.save('/r', null, snap);
    await store.clear('/r', null);
    expect(store.load('/r', null)).toBeNull();
  });

  it('ignores data in an unknown format', async () => {
    const m = memento();
    m.data.set(seenKey('/r', 'b'), { version: 2, whatever: true });
    expect(new SeenStore(m).load('/r', 'b')).toBeNull();
  });
});
