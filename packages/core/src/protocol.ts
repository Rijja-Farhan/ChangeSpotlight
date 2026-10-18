/**
 * Messages between the browser client, the Vite plugin and the extension.
 * Bump PROTOCOL_VERSION on any incompatible change; receivers drop other versions.
 */
import type { SeenTotals } from './seenModel.js';

export const PROTOCOL_VERSION = 1;

interface Versioned {
  protocolVersion: number;
}

/** First frame from a client (the extension) to the plugin's bridge server. */
export interface HelloMessage extends Versioned {
  type: 'hello';
  /** Secret from the discovery file; proves the client can read the repo's .git directory. */
  token: string;
}

/** Server reply to a valid hello. Only after this are other messages exchanged. */
export interface WelcomeMessage extends Versioned {
  type: 'welcome';
}

/** The user clicked a tagged element. `loc` is its data-cs-loc value. */
export interface ClickMessage extends Versioned {
  type: 'click';
  loc: string;
  page: string;
}

/** Batched data-cs-loc values that met the "seen" rule on `page` (filled in Phase 5). */
export interface VisibilityMessage extends Versioned {
  type: 'visibility';
  page: string;
  seen: string[];
}

/** One changed element in the browser overlay. Its status comes only from VS Code's seen model. */
export interface OverlayItem {
  /** The element's data-cs-loc value. */
  loc: string;
  path: string;
  /** First and last changed line (1-based) of the hunks this element shows. */
  line: number;
  endLine: number;
  /** seen: in all its hunks; partly: in some; unseen: in none. */
  status: 'unseen' | 'partly' | 'seen';
  /** How many of `hunkIds` count this element as seen. */
  seenHunks: number;
  hunkIds: string[];
  /** First changed line of the first hunk, shortened (as in the tree). */
  preview: string;
  /** Pages the element was seen on. */
  pages: string[];
}

/** VS Code -> browser (relayed by the plugin): everything the overlay draws. */
export interface OverlayMessage extends Versioned {
  type: 'overlay';
  branch: string | null;
  totals: SeenTotals;
  items: OverlayItem[];
  /** Sorted union of the items' pages. */
  pages: string[];
  /** Locs of items not seen on any page yet. */
  unplaced: string[];
}

/** Browser -> VS Code: "Open in VS Code". `path` is repo-relative. */
export interface OpenMessage extends Versioned {
  type: 'open';
  path: string;
  line: number;
}

/** Browser -> VS Code: "Mark as seen" for these hunks. */
export interface MarkMessage extends Versioned {
  type: 'mark';
  hunkIds: string[];
}

export type ProtocolMessage =
  | HelloMessage
  | WelcomeMessage
  | ClickMessage
  | VisibilityMessage
  | OverlayMessage
  | OpenMessage
  | MarkMessage;

export type ParseResult =
  | { ok: true; message: ProtocolMessage }
  | { ok: false; reason: 'not-object' | 'version-mismatch' | 'unknown-type' | 'invalid-fields' };

/**
 * Checks an untrusted value (e.g. JSON from the network). Unknown extra fields are allowed so
 * that a newer sender can add optional data without breaking older receivers.
 */
export function parseMessage(value: unknown): ParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, reason: 'not-object' };
  const v = value as Record<string, unknown>;
  if (v.protocolVersion !== PROTOCOL_VERSION) return { ok: false, reason: 'version-mismatch' };

  switch (v.type) {
    case 'hello':
      return typeof v.token === 'string'
        ? { ok: true, message: v as unknown as HelloMessage }
        : { ok: false, reason: 'invalid-fields' };
    case 'welcome':
      return { ok: true, message: v as unknown as WelcomeMessage };
    case 'click':
      return typeof v.loc === 'string' && typeof v.page === 'string'
        ? { ok: true, message: v as unknown as ClickMessage }
        : { ok: false, reason: 'invalid-fields' };
    case 'visibility':
      return typeof v.page === 'string' && Array.isArray(v.seen) && v.seen.every((s) => typeof s === 'string')
        ? { ok: true, message: v as unknown as VisibilityMessage }
        : { ok: false, reason: 'invalid-fields' };
    case 'overlay':
      return isOverlay(v) ? { ok: true, message: v as unknown as OverlayMessage } : { ok: false, reason: 'invalid-fields' };
    case 'open':
      return typeof v.path === 'string' && v.path !== '' && isLine(v.line)
        ? { ok: true, message: v as unknown as OpenMessage }
        : { ok: false, reason: 'invalid-fields' };
    case 'mark':
      return isStrings(v.hunkIds) ? { ok: true, message: v as unknown as MarkMessage } : { ok: false, reason: 'invalid-fields' };
    default:
      return { ok: false, reason: 'unknown-type' };
  }
}

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');
const isLine = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 1;
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const STATUSES: readonly unknown[] = ['unseen', 'partly', 'seen'];

function isOverlayItem(x: unknown): boolean {
  if (!isRecord(x)) return false;
  return (
    typeof x.loc === 'string' &&
    typeof x.path === 'string' &&
    isLine(x.line) &&
    isLine(x.endLine) &&
    x.endLine >= x.line &&
    STATUSES.includes(x.status) &&
    isCount(x.seenHunks) &&
    isStrings(x.hunkIds) &&
    typeof x.preview === 'string' &&
    isStrings(x.pages)
  );
}

function isOverlay(v: Record<string, unknown>): boolean {
  const t = v.totals;
  return (
    (v.branch === null || typeof v.branch === 'string') &&
    isRecord(t) &&
    isCount(t.seen) &&
    isCount(t.total) &&
    isCount(t.untrackable) &&
    Array.isArray(v.items) &&
    v.items.every(isOverlayItem) &&
    isStrings(v.pages) &&
    isStrings(v.unplaced)
  );
}

/** WebSocket close codes used by the bridge (4000-4999 is the application range). */
export const CLOSE_CODES = {
  /** First frame was not a hello. */
  protocolError: 4000,
  badToken: 4001,
  /** Reason text carries the server's protocol version. */
  versionMismatch: 4002,
  handshakeTimeout: 4003,
} as const;

/**
 * Reads a hello without checking the version, so a server can tell a client which version it
 * speaks. Returns null when the value is not a hello at all.
 */
export function readHello(value: unknown): { protocolVersion: unknown; token: unknown } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return v.type === 'hello' ? { protocolVersion: v.protocolVersion, token: v.token } : null;
}

/** Contents of a discovery file: <gitDir>/change-spotlight/servers/<pid>-<port>.json */
export interface ServerInfo {
  protocolVersion: number;
  pid: number;
  port: number;
  token: string;
  /** Repo root the dev server belongs to. */
  root: string;
  /** Vite project root (may be a subfolder of the repo). */
  viteRoot: string;
}

export function parseServerInfo(value: unknown): ServerInfo | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const int = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x > 0;
  if (!int(v.protocolVersion) || !int(v.pid) || !int(v.port) || (v.port as number) > 65535) return null;
  if (typeof v.token !== 'string' || v.token === '' || typeof v.root !== 'string' || typeof v.viteRoot !== 'string') return null;
  return v as unknown as ServerInfo;
}
