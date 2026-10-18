// Finds the host elements of every changed JSX file, using the same collector the Vite plugin
// uses to tag them, so the extension knows which element shows which changed line. No vscode import.
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { DiffFile, HostElement } from '@change-spotlight/core';
import { collectHostElements } from '@change-spotlight/vite-plugin/elements';

/** Matches the plugin's default include/exclude. */
const JSX_FILE = /\.[jt]sx$/;

export async function analyzeElements(root: string, files: readonly DiffFile[]): Promise<Map<string, HostElement[] | null>> {
  const result = new Map<string, HostElement[] | null>();
  for (const file of files) {
    if (file.binary || file.status === 'deleted' || !JSX_FILE.test(file.path) || file.path.split('/').includes('node_modules')) continue;
    const abs = path.join(root, file.path);
    try {
      const code = await readFile(abs, 'utf8');
      result.set(file.path, collectHostElements(code, { filename: abs, relPath: file.path, lang: file.path.endsWith('.tsx') ? 'tsx' : 'jsx' }));
    } catch {
      result.set(file.path, null); // vanished or unreadable since the diff ran
    }
  }
  return result;
}
