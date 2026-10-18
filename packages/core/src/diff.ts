import { normalizePath } from './paths.js';

/**
 * One changed region. Line numbers are 1-based. Counts follow git: a pure deletion has
 * newCount 0 and newStart = the line *before* the gap (0 when deleted at the top of the file);
 * a pure addition has oldCount 0 and oldStart = the line before the insertion point.
 */
export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  kind: 'add' | 'delete' | 'modify';
  /** Removed line text, without the "-" prefix or a trailing "\r". */
  removed: string[];
  /** Added line text, without the "+" prefix or a trailing "\r". */
  added: string[];
}

export interface DiffFile {
  /** New path, or the old path for a deleted file. Repo-relative, forward slashes. */
  path: string;
  /** Previous path for renames, otherwise null. */
  oldPath: string | null;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  binary: boolean;
  hunks: Hunk[];
}

/** 1-based, inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

export class DiffParseError extends Error {
  constructor(
    message: string,
    /** 1-based line number in the diff text. */
    readonly line: number,
  ) {
    super(`${message} (diff line ${line})`);
    this.name = 'DiffParseError';
  }
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses the output of
 *   git diff -U0 --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ --find-renames
 * Hunk lines are consumed by the counts in each @@ header, never by guessing from prefixes,
 * so content such as "--- x" inside a hunk is never mistaken for a file header.
 */
export function parseDiff(text: string): DiffFile[] {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines[lines.length - 1] === '') lines.pop();

  const files: DiffFile[] = [];
  let file: (DiffFile & { headerOld: string | null; headerNew: string | null }) | undefined;
  let i = 0;

  const finish = () => {
    if (!file) return;
    const { headerOld, headerNew, ...result } = file;
    // Fall back to the "diff --git" header when there were no ---/+++ or rename lines.
    if (result.path === '') result.path = (result.status === 'deleted' ? headerOld : headerNew) ?? '';
    if (result.path === '') throw new DiffParseError('could not determine file path', i);
    files.push(result);
    file = undefined;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const lineNo = i + 1;

    if (line.startsWith('diff --git ')) {
      finish();
      const [headerOld, headerNew] = splitGitHeader(line.slice('diff --git '.length));
      file = { path: '', oldPath: null, status: 'modified', binary: false, hunks: [], headerOld, headerNew };
      i++;
      continue;
    }
    if (!file) {
      if (line === '') {
        i++;
        continue;
      }
      throw new DiffParseError(`expected "diff --git", got ${JSON.stringify(line.slice(0, 40))}`, lineNo);
    }

    if (line.startsWith('@@')) {
      const m = HUNK_HEADER.exec(line);
      if (!m) throw new DiffParseError('malformed hunk header', lineNo);
      const hunk: Hunk = {
        oldStart: Number(m[1]),
        oldCount: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newCount: m[4] === undefined ? 1 : Number(m[4]),
        kind: 'modify',
        removed: [],
        added: [],
      };
      hunk.kind = hunk.oldCount === 0 ? 'add' : hunk.newCount === 0 ? 'delete' : 'modify';
      i++;
      while (hunk.removed.length < hunk.oldCount || hunk.added.length < hunk.newCount) {
        const body = lines[i];
        if (body === undefined) throw new DiffParseError('diff ended inside a hunk', i + 1);
        if (body.startsWith('\\')) {
          // "\ No newline at end of file"
        } else if (body.startsWith('-') && hunk.removed.length < hunk.oldCount) {
          hunk.removed.push(body.slice(1));
        } else if (body.startsWith('+') && hunk.added.length < hunk.newCount) {
          hunk.added.push(body.slice(1));
        } else {
          throw new DiffParseError('hunk line count does not match its @@ header', i + 1);
        }
        i++;
      }
      while (lines[i]?.startsWith('\\')) i++;
      file.hunks.push(hunk);
      continue;
    }

    if (line.startsWith('--- ')) {
      const p = parsePathToken(line.slice(4));
      if (p === null) file.status = 'added';
      else if (file.path === '') file.path = p;
    } else if (line.startsWith('+++ ')) {
      const p = parsePathToken(line.slice(4));
      if (p === null) file.status = 'deleted';
      else file.path = p;
    } else if (line.startsWith('new file mode ')) {
      file.status = 'added';
    } else if (line.startsWith('deleted file mode ')) {
      file.status = 'deleted';
    } else if (line.startsWith('rename from ')) {
      file.status = 'renamed';
      file.oldPath = unquote(line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) {
      file.status = 'renamed';
      file.path = unquote(line.slice('rename to '.length));
    } else if (line.startsWith('Binary files ')) {
      file.binary = true;
    }
    // Other extended headers (index, similarity index, old/new mode…) carry nothing we need.
    i++;
  }
  finish();
  return files;
}

/** New-side changed line ranges per file, sorted. Pure deletions and deleted files are left out. */
export function changedRanges(files: DiffFile[]): Map<string, LineRange[]> {
  const result = new Map<string, LineRange[]>();
  for (const file of files) {
    if (file.status === 'deleted') continue;
    const ranges = file.hunks
      .filter((h) => h.newCount > 0)
      .map((h) => ({ start: h.newStart, end: h.newStart + h.newCount - 1 }))
      .sort((a, b) => a.start - b.start);
    if (ranges.length > 0) result.set(file.path, ranges);
  }
  return result;
}

/**
 * Parses a path from a ---/+++ line: "a/x", "b/x", "/dev/null" (returns null) or a quoted
 * form. Git appends a TAB after unquoted paths that contain spaces; unquoted paths can never
 * contain a TAB themselves, so everything from the first TAB is dropped.
 */
function parsePathToken(token: string): string | null {
  const raw = token.startsWith('"') ? unquote(token) : token.split('\t')[0]!;
  if (raw === '/dev/null') return null;
  return stripPrefix(raw);
}

function stripPrefix(p: string): string {
  return normalizePath(p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p);
}

/**
 * Splits "a/x b/x" from a "diff --git" line. Quoted halves are unambiguous. Unquoted paths
 * with spaces are ambiguous in general, but this header is only a fallback for files without
 * ---/+++ or rename lines, where old and new path are the same, so split in the middle.
 */
function splitGitHeader(rest: string): [string | null, string | null] {
  if (rest.startsWith('"')) {
    const end = quotedEnd(rest);
    const second = rest.slice(end + 1).trimStart();
    return [stripPrefix(unquote(rest.slice(0, end))), stripPrefix(second.startsWith('"') ? unquote(second) : second)];
  }
  const quoteAt = rest.indexOf(' "');
  if (quoteAt >= 0) return [stripPrefix(rest.slice(0, quoteAt)), stripPrefix(unquote(rest.slice(quoteAt + 1)))];

  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === ' ' && rest.slice(2, half) === rest.slice(half + 3)) {
    return [stripPrefix(rest.slice(0, half)), stripPrefix(rest.slice(half + 1))];
  }
  return [null, null];
}

/** Index just past the closing quote of a quoted token that starts at 0. */
function quotedEnd(s: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i + 1;
  }
  return s.length;
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/**
 * Decodes git's C-style quoted paths ("b/\303\274n.txt"). Octal escapes are raw UTF-8 bytes,
 * so the whole string is turned into bytes and decoded as UTF-8. Unquoted input is returned as is.
 */
function unquote(s: string): string {
  if (!s.startsWith('"')) return s;
  const body = s.slice(1, quotedEnd(s) - 1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      utf8Encode(body.codePointAt(i)!, bytes);
      if (body.codePointAt(i)! > 0xffff) i++;
      continue;
    }
    const next = body[++i] ?? '';
    const octal = /^[0-7]{3}/.exec(body.slice(i, i + 3));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 2;
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
    }
  }
  return utf8Decode(bytes);
}

function utf8Encode(cp: number, out: number[]): void {
  if (cp < 0x80) out.push(cp);
  else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
  else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
}

/** Minimal UTF-8 decoder (TextDecoder is not available without DOM/Node types). Invalid bytes become U+FFFD. */
function utf8Decode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    const len = b < 0x80 ? 1 : b >> 5 === 6 ? 2 : b >> 4 === 14 ? 3 : b >> 3 === 30 ? 4 : 0;
    const tail = bytes.slice(i + 1, i + len);
    if (len === 0 || tail.length !== len - 1 || tail.some((t) => t >> 6 !== 2)) {
      out += '�';
      i++;
      continue;
    }
    let cp = len === 1 ? b : b & (0xff >> (len + 1));
    for (const t of tail) cp = (cp << 6) | (t & 63);
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}
