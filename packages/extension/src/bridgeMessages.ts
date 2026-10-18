// Turns one NDJSON line from the plugin into an Output channel line. Pure, so it is unit-tested.
import { parseLoc, parseMessage } from '@change-spotlight/core';

export function describeMessage(line: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const result = parseMessage(value);
  if (!result.ok) {
    return result.reason === 'version-mismatch'
      ? `Ignored message with protocol version ${String((value as { protocolVersion?: unknown })?.protocolVersion)}.`
      : null;
  }
  const message = result.message;
  switch (message.type) {
    case 'hello':
    case 'welcome':
    case 'overlay':
      return null;
    case 'open':
      return `Browser asked to open ${message.path}:${message.line}`;
    case 'mark':
      return `Browser marked ${message.hunkIds.length} change(s) as seen`;
    case 'click': {
      // loc is "path:start-end"; report "path:start" like a normal file:line reference.
      const loc = parseLoc(message.loc);
      const fileLine = loc ? `${loc.path}:${loc.start}` : message.loc;
      return `Clicked ${fileLine}  (element spans ${message.loc}, page ${message.page})`;
    }
    case 'visibility':
      return [`Seen ${message.seen.length} element(s) on ${message.page}`, ...message.seen.map((l) => `  ${l}`)].join('\n');
  }
}
