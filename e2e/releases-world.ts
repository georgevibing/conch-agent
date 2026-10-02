/**
 * What a pretend Conch release is made of, for the `releases` journey and
 * its gateway (e2e/releases-gateway.ts).
 */
import { join } from 'node:path';

import { conchFiles } from '../apps/server/src/release/testing';

const repoRoot = join(import.meta.dirname, '..');

/** A version of the pretend Conch: its files, and a start file that runs the real gateway. */
export function pretendConch(version: string, signers: string): Record<string, string> {
  return {
    ...conchFiles(version, signers),
    'apps/server/src/start.ts': `// The pretend Conch ${version} runs the real gateway (e2e/releases-gateway.ts).\nawait import(${JSON.stringify(join(repoRoot, 'apps/server/src/main.ts'))});\n`,
  };
}

/** A version that breaks as it starts: the supervisor must go back by itself. */
export function brokenConch(version: string, signers: string): Record<string, string> {
  return {
    ...conchFiles(version, signers),
    'apps/server/src/start.ts': `throw new Error('The pretend Conch ${version} breaks as it starts, on purpose.');\n`,
  };
}

/** A release's tag message. */
export const notes = (version: string, lines: string[]) =>
  `Conch ${version}\n\nNew\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
