// Finds host elements in JSX source. Shared by the plugin's transform (to tag them) and the
// extension (to know which elements show which changed lines), so both always agree.
// Imports nothing from Vite, and walks the AST by hand: oxc's Visitor lazily requires a file
// that does not survive bundling into the extension.
import type { HostElement } from '@change-spotlight/core';
import { parseSync } from 'oxc-parser';

export interface ParseOptions {
  filename: string;
  /** Repo-relative path written into data-cs-loc. */
  relPath: string;
  lang: 'jsx' | 'tsx';
}

/** Same rule React's JSX compilers use to decide "string tag" vs component. */
export function isHostTag(name: string): boolean {
  return name !== 'this' && (/^[a-z]/.test(name) || name.includes('-'));
}

interface AstNode {
  type?: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface JsxAttribute extends AstNode {
  name: AstNode & { name?: string };
}

export interface HostNode {
  /** Offsets of the whole element (UTF-16, as oxc reports them). */
  start: number;
  end: number;
  /** Number of enclosing host elements. */
  depth: number;
  /** The element already has an explicit data-cs-loc: never tagged, never reported. */
  explicit: boolean;
  /** Where the transform inserts the attribute: after the last attribute, else after the tag name. */
  insertAt: number;
}

/** All host JSX elements in a parsed program, in source order. */
export function findHostNodes(program: unknown): HostNode[] {
  const found: HostNode[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth);
      return;
    }
    const node = value as AstNode;
    let childDepth = depth;
    if (node.type === 'JSXElement') {
      const opening = node.openingElement as AstNode & { name: AstNode & { name?: string }; attributes: JsxAttribute[] };
      if (opening.name.type === 'JSXIdentifier' && isHostTag(opening.name.name ?? '')) {
        const explicit = opening.attributes.some(
          (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'data-cs-loc',
        );
        const last = opening.attributes[opening.attributes.length - 1];
        found.push({ start: node.start, end: node.end, depth, explicit, insertAt: last ? last.end : opening.name.end });
        childDepth = depth + 1;
      }
    }
    for (const key in node) if (key !== 'parent') visit(node[key], childDepth);
  };
  visit(program, 0);
  return found;
}

/** Offsets of each line start. Only "\n" ends a line, as in git, so CRLF works and a lone "\r" does not. */
export function lineStarts(code: string): number[] {
  const starts = [0];
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

export function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Parses JSX source; returns null on a syntax error. */
export function parseJsx(code: string, options: ParseOptions): unknown | null {
  const parsed = parseSync(options.filename, code, { lang: options.lang });
  return parsed.errors.length > 0 ? null : parsed.program;
}

/**
 * The host elements the browser will report for this file, with the exact ranges the transform
 * writes into data-cs-loc. Null when the file does not parse.
 */
export function collectHostElements(code: string, options: ParseOptions): HostElement[] | null {
  if (!code.includes('<')) return [];
  const program = parseJsx(code, options);
  if (program === null) return null;
  const starts = lineStarts(code);
  return findHostNodes(program)
    .filter((n) => !n.explicit)
    .map((n) => ({ path: options.relPath, start: lineOf(starts, n.start), end: lineOf(starts, n.end - 1), depth: n.depth }));
}
