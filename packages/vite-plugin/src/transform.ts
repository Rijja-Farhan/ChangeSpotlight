// SPIKE: tags host elements with data-cs-loc. Hardened version + fixture tests come in Phase 4.
import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

interface Node {
  type?: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

/** Offsets of the first character of every line, for offset -> 1-based line lookup. */
function lineStarts(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
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

/**
 * Adds data-cs-loc="relPath:start-end" to every lowercase host element (div, button…).
 * Components (<Foo>, <motion.div>) and fragments are left alone.
 */
export function tagHostElements(code: string, filename: string, relPath: string) {
  const result = parseSync(filename, code, { lang: filename.endsWith('.jsx') ? 'jsx' : 'tsx' });
  if (result.errors.length > 0) return null; // let the normal pipeline report syntax errors

  const s = new MagicString(code);
  const starts = lineStarts(code);

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as Node;
    if (node.type === 'JSXElement') {
      const opening = node.openingElement as Node & { name: Node & { name?: string }; attributes: Node[] };
      const isHost = opening.name.type === 'JSXIdentifier' && /^[a-z]/.test(opening.name.name ?? '');
      const alreadyTagged = opening.attributes.some(
        (a) => (a.name as { name?: string } | undefined)?.name === 'data-cs-loc',
      );
      if (isHost && !alreadyTagged) {
        const loc = `${relPath}:${lineOf(starts, node.start)}-${lineOf(starts, node.end - 1)}`;
        s.appendLeft(opening.name.end, ` data-cs-loc="${loc}"`);
      }
    }
    for (const key in node) if (key !== 'parent') visit(node[key]);
  };
  visit(result.program);

  if (!s.hasChanged()) return null;
  return { code: s.toString(), map: s.generateMap({ source: filename, includeContent: true, hires: true }) };
}
