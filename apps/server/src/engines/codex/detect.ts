/** Discover Codex without inspecting ambient credentials or agent state. */
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import type { InstallHint } from '@conch/protocol';

import { findExecutable } from '../../lib/proc';

export const DOCS_URL = 'https://developers.openai.com/codex/cli';
/** App-server dynamic tools, device authentication and protected permission profiles. */
export const MIN_VERSION = '0.159.0';

export function installHints(): InstallHint[] {
  const hints: InstallHint[] = [];
  if (platform() === 'win32')
    hints.push({ label: 'winget', command: 'winget install --exact --id OpenAI.Codex' });
  if (platform() === 'darwin') hints.push({ label: 'Homebrew', command: 'brew install codex' });
  hints.push({ label: 'npm', command: 'npm install -g @openai/codex' });
  return hints;
}

/** Find `codex` on PATH, then in the places its installers put it. */
export function findCodex(explicit?: string): Promise<string | undefined> {
  return findExecutable('codex', { explicit, extraDirs: [join(homedir(), '.codex', 'bin')] });
}

/**
 * `codex --version` prints `codex 0.52.0`. A build from source prints a git
 * revision instead, which is a real install with an unknowable version — we
 * take no version rather than guess one.
 */
export function parseVersion(stdout: string): string | undefined {
  return /\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/.exec(stdout)?.[0];
}

/** Dotted-number comparison. Missing or non-numeric parts count as zero. */
export function isAtLeast(version: string, minimum: string): boolean {
  const left = version.split('.');
  const right = minimum.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = Number.parseInt(left[i] ?? '0', 10) || 0;
    const b = Number.parseInt(right[i] ?? '0', 10) || 0;
    if (a !== b) return a > b;
  }
  return true;
}
