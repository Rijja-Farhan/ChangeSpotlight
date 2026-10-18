import { describe, expect, it } from 'vitest';
import { resolveId } from '../src/ids.js';

const root = '/repo';

describe('resolveId', () => {
  it('maps files in a subfolder app to repo-relative paths', () => {
    expect(resolveId('/repo/playground/src/A.tsx', root)).toEqual({ file: '/repo/playground/src/A.tsx', relPath: 'playground/src/A.tsx', lang: 'tsx' });
  });

  it('strips harmless queries and skips raw/url/inline/worker imports', () => {
    expect(resolveId('/repo/src/A.tsx?v=123', root)?.relPath).toBe('src/A.tsx');
    expect(resolveId('/repo/src/A.tsx?t=1&import', root)?.relPath).toBe('src/A.tsx');
    for (const q of ['raw', 'url', 'inline', 'worker', 'sharedworker', 'import&raw']) {
      expect(resolveId(`/repo/src/A.tsx?${q}`, root)).toBeNull();
    }
  });

  it('chooses the parser language from the extension and skips non-JSX files', () => {
    expect(resolveId('/repo/a.jsx', root)?.lang).toBe('jsx');
    expect(resolveId('/repo/a.js', root)?.lang).toBe('jsx');
    expect(resolveId('/repo/a.mjs', root)?.lang).toBe('jsx');
    expect(resolveId('/repo/a.cjs', root)?.lang).toBe('jsx');
    for (const f of ['a.ts', 'a.mts', 'a.cts', 'a.css', 'a.html']) expect(resolveId(`/repo/${f}`, root)).toBeNull();
  });

  it('skips virtual ids and files outside the repo', () => {
    expect(resolveId('\0virtual:x.tsx', root)).toBeNull();
    expect(resolveId('/other/A.tsx', root)).toBeNull();
    expect(resolveId('/repo-two/A.tsx', root)).toBeNull();
  });

  it('handles Windows ids case-insensitively', () => {
    expect(resolveId('C:/Repo/app/src/A.tsx', 'c:/repo')?.relPath).toBe('app/src/A.tsx');
    expect(resolveId('C:\\Repo\\app\\A.tsx', 'c:\\repo')?.relPath).toBe('app/A.tsx');
  });
});
