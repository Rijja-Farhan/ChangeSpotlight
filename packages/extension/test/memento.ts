// In-memory stand-in for VS Code's workspaceState.
import type { KeyValueStore } from '../src/seenStore';

export function memento(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: <T>(key: string) => data.get(key) as T | undefined,
    update: async (key, value) => {
      if (value === undefined) data.delete(key);
      else data.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
}
