// A small glob matcher for repo-relative paths ("**/test/**", "*.spec.tsx", "src/{a,b}/*.tsx").
// Pure and dependency-free, so the extension and its tests share it.

/** Default for the changeSpotlight.exclude setting: tests, fixtures and stories never count. */
export const DEFAULT_EXCLUDE: readonly string[] = ['**/test/**', '**/tests/**', '**/__tests__/**', '**/fixtures/**', '**/*.test.*', '**/*.spec.*', '**/*.stories.*'];

const cache = new Map<string, RegExp>();

/**
 * `**` matches any number of folders, `*` anything but "/", `?` one character but "/", and
 * `{a,b}` either alternative. Everything else is literal. A pattern without "/" matches the file
 * name in any folder (as in .gitignore), so "*.spec.tsx" works without a leading "**\/".
 */
export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  const glob = pattern.includes('/') ? pattern.replace(/^\/+/, '') : `**/${pattern}`;
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*' && glob[i + 1] === '*') {
      const slashAfter = glob[i + 2] === '/';
      re += slashAfter ? '(?:.*/)?' : '.*';
      i += slashAfter ? 2 : 1;
    } else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else if (ch === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) re += '\\{';
      else {
        re += `(?:${glob.slice(i + 1, end).split(',').map(escape).join('|')})`;
        i = end;
      }
    } else re += escape(ch);
  }
  const result = new RegExp(`^${re}$`);
  cache.set(pattern, result);
  return result;
}

function escape(text: string): string {
  return text.replace(/[.+^$()|[\]\\{}*?]/g, '\\$&');
}

/** True when the repo-relative `path` matches any of `patterns`. */
export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => p.trim() !== '' && globToRegExp(p.trim()).test(path));
}
