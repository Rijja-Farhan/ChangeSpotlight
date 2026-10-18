import { readFileSync } from 'node:fs';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { describe, expect, it } from 'vitest';
import { tagHostElements } from '../src/transform.js';

/** 1-based line, 0-based column of the n-th occurrence of `token` (as source maps count). */
function position(code: string, token: string, nth = 0): { line: number; column: number } {
  let index = -1;
  for (let i = 0; i <= nth; i++) index = code.indexOf(token, index + 1);
  if (index < 0) throw new Error(`token ${token} not found`);
  const before = code.slice(0, index);
  const line = before.split('\n').length;
  return { line, column: index - (before.lastIndexOf('\n') + 1) };
}

function checkTokens(original: string, tokens: [string, number?][]) {
  const result = tagHostElements(original, { filename: '/repo/src/a.tsx', relPath: 'src/a.tsx', lang: 'tsx' })!;
  const map = new TraceMap(result.map as never);
  for (const [token, nth = 0] of tokens) {
    const generated = position(result.code, token, nth);
    const traced = originalPositionFor(map, generated);
    expect({ token, line: traced.line, column: traced.column }).toEqual({ token, ...position(original, token, nth) });
  }
}

describe('source map', () => {
  const counter = readFileSync(new URL('./fixtures/counter.tsx', import.meta.url), 'utf8');

  it('maps tokens after inserted attributes back to their exact original line and column', () => {
    checkTokens(counter, [['onClick'], ['setCount', 1], ['useState', 1], ['Increment'], ['</button>'], ['</section>'], ['className'], ['type=']]);
  });

  it('stays exact in a CRLF file', () => {
    const crlf = counter.replace(/\n/g, '\r\n');
    checkTokens(crlf, [['onClick'], ['setCount', 1], ['</button>']]);
  });
});
