// Persists seen progress per repository and branch. Takes a minimal Memento-like interface so it
// works with VS Code's workspaceState and with a plain fake in tests. No vscode import.
import type { SeenSnapshot } from '@change-spotlight/core';

export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export function seenKey(root: string, branch: string | null): string {
  return `changeSpotlight.seen.v1:${root}:${branch ?? 'detached'}`;
}

export class SeenStore {
  constructor(private readonly store: KeyValueStore) {}

  load(root: string, branch: string | null): SeenSnapshot | null {
    const value = this.store.get<SeenSnapshot>(seenKey(root, branch));
    return value && value.version === 1 && typeof value.entries === 'object' ? value : null;
  }

  save(root: string, branch: string | null, snapshot: SeenSnapshot): PromiseLike<void> {
    return this.store.update(seenKey(root, branch), snapshot);
  }

  clear(root: string, branch: string | null): PromiseLike<void> {
    return this.store.update(seenKey(root, branch), undefined);
  }
}
