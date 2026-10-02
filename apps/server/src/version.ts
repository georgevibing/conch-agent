/**
 * Conch's version, reported to the web app and to MCP servers Conch connects
 * to. It's written in one place only, the root `package.json` (ADR 0051):
 * `pnpm release` moves it on, and everything else reads it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function written(): string {
  try {
    const root = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8'),
    ) as { version?: unknown };
    return typeof root.version === 'string' ? root.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const SERVER_VERSION = written();
