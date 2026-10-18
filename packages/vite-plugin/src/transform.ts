// Adds data-cs-loc="path:start-end" to every host element (div, button, my-widget…) in a JSX file.
// Pure: no fs, git or Vite imports, so it can be tested on plain strings.
import { formatLoc } from '@change-spotlight/core';
import MagicString, { type SourceMap } from 'magic-string';
import { parseSync, Visitor } from 'oxc-parser';

export interface TagOptions {
  /** Absolute file name, used as the source-map source. */
  filename: string;
  /** Repo-relative path written into data-cs-loc. */
  relPath: string;
  lang: 'jsx' | 'tsx';
}

/** Same rule React's JSX compilers use to decide "string tag" vs component. */
export function isHostTag(name: string): boolean {
  return name !== 'this' && (/^[a-z]/.test(name) || name.includes('-'));
}

/** Offsets of each line start. Only "\n" ends a line, as in git, so CRLF works and a lone "\r" does not. */
function lineStarts(code: string): number[] {
  const starts = [0];
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export function tagHostElements(code: string, options: TagOptions): { code: string; map: SourceMap } | null {
  if (!code.includes('<')) return null;
  const parsed = parseSync(options.filename, code, { lang: options.lang });
  if (parsed.errors.length > 0) return null; // let the normal pipeline report the syntax error

  const s = new MagicString(code);
  let starts: number[] | undefined;

  new Visitor({
    JSXElement(node) {
      const opening = node.openingElement;
      if (opening.name.type !== 'JSXIdentifier' || !isHostTag(opening.name.name)) return;
      const explicit = opening.attributes.some(
        (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'data-cs-loc',
      );
      if (explicit) return;

      starts ??= lineStarts(code);
      const value = formatLoc({ path: options.relPath, start: lineOf(starts, node.start), end: lineOf(starts, node.end - 1) });
      // After the last attribute: React merges props left to right, so a spread like {...props}
      // placed after our attribute could otherwise override it.
      const last = opening.attributes[opening.attributes.length - 1];
      const at = last ? last.end : opening.name.end;
      // Expression form: JSX string attributes have no escapes and decode HTML entities.
      s.appendLeft(at, ` data-cs-loc={${JSON.stringify(value)}}`);
    },
  }).visit(parsed.program);

  if (!s.hasChanged()) return null;
  return { code: s.toString(), map: s.generateMap({ source: options.filename, includeContent: true, hires: true }) };
}
