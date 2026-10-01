import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where Conch keeps the person's passwords and its own keys (ADR 0025 §
 * Agent's own tools). The agent's file and shell tools never touch these:
 * values only leave through Passwords, with the person's OK.
 */
export function protectedPaths(home: string): string[] {
  return [
    join(home, 'vault'),
    join(home, 'secrets.json'),
    join(home, 'integrations.secrets.json'),
    join(home, 'channels.secrets.json'),
    join(home, 'access.json'),
  ];
}

/** Whether a tool's input names one of them (as is, or with `~` for the home folder). */
export function touchesProtected(input: unknown, paths: readonly string[]): boolean {
  if (!paths.length) return false;
  const text = JSON.stringify(input ?? '')
    .replaceAll('\\\\', '/')
    .replaceAll('\\\\', '/');
  const home = homedir().replaceAll('\\', '/');
  return paths.some((p) => {
    const path = p.replaceAll('\\', '/');
    const tilde = path.startsWith(home) ? `~${path.slice(home.length)}` : undefined;
    return text.includes(path) || (tilde !== undefined && text.includes(tilde));
  });
}

export const PROTECTED_MESSAGE =
  'That’s where Conch keeps the user’s passwords and its own keys; it isn’t for reading or changing with files or commands. Use passwords_find, passwords_read or passwords_request instead.';
