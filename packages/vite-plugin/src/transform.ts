// Adds data-cs-loc="path:start-end" to every host element (div, button, my-widget…) in a JSX file.
// Pure: no fs, git or Vite imports, so it can be tested on plain strings.
import { formatLoc } from '@change-spotlight/core';
import MagicString, { type SourceMap } from 'magic-string';
import { findHostNodes, lineOf, lineStarts, parseJsx, type ParseOptions } from './elements.js';

export { isHostTag } from './elements.js';
export type TagOptions = ParseOptions;

export function tagHostElements(code: string, options: TagOptions): { code: string; map: SourceMap } | null {
  if (!code.includes('<')) return null;
  const program = parseJsx(code, options);
  if (program === null) return null; // let the normal pipeline report the syntax error

  const s = new MagicString(code);
  let starts: number[] | undefined;
  for (const node of findHostNodes(program)) {
    if (node.explicit) continue;
    starts ??= lineStarts(code);
    const value = formatLoc({ path: options.relPath, start: lineOf(starts, node.start), end: lineOf(starts, node.end - 1) });
    // After the last attribute: React merges props left to right, so a spread like {...props}
    // placed after our attribute could otherwise override it.
    // Expression form: JSX string attributes have no escapes and decode HTML entities.
    s.appendLeft(node.insertAt, ` data-cs-loc={${JSON.stringify(value)}}`);
  }

  if (!s.hasChanged()) return null;
  return { code: s.toString(), map: s.generateMap({ source: options.filename, includeContent: true, hires: true }) };
}
