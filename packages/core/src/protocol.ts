/**
 * Messages between the browser client, the Vite plugin and the extension.
 * Bump PROTOCOL_VERSION on any incompatible change; receivers drop other versions.
 */
export const PROTOCOL_VERSION = 1;

interface Versioned {
  protocolVersion: number;
}

/** Sent by the plugin as the first line of every /events connection. */
export interface HelloMessage extends Versioned {
  type: 'hello';
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

export type ProtocolMessage = HelloMessage | ClickMessage | VisibilityMessage;

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
      return { ok: true, message: v as unknown as HelloMessage };
    case 'click':
      return typeof v.loc === 'string' && typeof v.page === 'string'
        ? { ok: true, message: v as unknown as ClickMessage }
        : { ok: false, reason: 'invalid-fields' };
    case 'visibility':
      return typeof v.page === 'string' && Array.isArray(v.seen) && v.seen.every((s) => typeof s === 'string')
        ? { ok: true, message: v as unknown as VisibilityMessage }
        : { ok: false, reason: 'invalid-fields' };
    default:
      return { ok: false, reason: 'unknown-type' };
  }
}
