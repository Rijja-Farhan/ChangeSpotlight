// Throwaway git repos for tests. They live under the OS temp dir; nothing here touches the project repo.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const hermeticEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

export interface TempRepo {
  dir: string;
  git(...args: string[]): string;
  /** Like git(), but returns stdout even when git exits with 1 (e.g. diff --no-index). */
  gitAllowFail(...args: string[]): string;
  write(file: string, content: string | Uint8Array): void;
  commitAll(message: string): void;
  cleanup(): void;
}

export function makeRepo(options: { init?: boolean; branch?: string } = {}): TempRepo {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-ext-test-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: hermeticEnv, encoding: 'utf8' });
  const repo: TempRepo = {
    dir,
    git,
    gitAllowFail(...args) {
      try {
        return git(...args);
      } catch (err) {
        return (err as { stdout?: string }).stdout ?? '';
      }
    },
    write(file, content) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    },
    commitAll(message) {
      git('add', '-A');
      git('commit', '-q', '--allow-empty', '-m', message);
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  if (options.init !== false) git('init', '-q', '-b', options.branch ?? 'main');
  return repo;
}

export const ten = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
