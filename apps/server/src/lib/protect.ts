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
    join(home, 'codex.secrets.json'),
    join(home, 'codex-runtime'),
    join(home, 'codex-sessions'),
    join(home, 'secrets.json'),
    join(home, 'integrations.secrets.json'),
    join(home, 'google.secrets.json'),
    join(home, 'channels.secrets.json'),
    // A linked WhatsApp or Signal: whoever has these reads and sends your messages (ADR 0043).
    join(home, 'whatsapp.secrets.json'),
    join(home, 'signal'),
    // A Matrix session's encryption store, and what Teams chats Conch knows (ADR 0045).
    join(home, 'channels'),
    // Whether the public door is open: the agent mustn't open it.
    join(home, 'door.json'),
    join(home, 'access.json'),
    // Task evidence is authority: the model must never forge completion or erase dedupe.
    join(home, 'tasks.json'),
    // Whose skills are trusted, and your signing key (ADR 0031): an assistant
    // that could write the one would vouch for its own skills.
    join(home, 'skills.trust.json'),
    join(home, 'skills.signing.json'),
    // Conch's own versions and which one runs (ADR 0048): writing there would run the assistant's code as Conch.
    join(home, 'versions'),
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

/**
 * `pnpm conch skills sign|trust|forget|key` from the assistant's own shell:
 * signing with your key, or changing whose skills you trust, would let it
 * vouch for its own skills (ADR 0047). The terminal command opens your key
 * the way the gateway does, so these are the person's to type, never the
 * assistant's. A fence for the obvious spellings, not a box: protected paths
 * and sealing still stand behind it.
 */
const CONCH_POWERS = /\b(?:conch|cli\.[cm]?[jt]s)["']?\s+skills\s+(?:sign|trust|forget|key)\b/i;

export function runsConchPower(toolName: string, input: unknown): boolean {
  if (toolName !== 'Bash') return false;
  const command = (input as { command?: unknown } | undefined)?.command;
  return typeof command === 'string' && CONCH_POWERS.test(command);
}

export const CONCH_POWER_MESSAGE =
  'Signing skills and choosing whose skills to trust are for the user to do in their own terminal, not for the assistant. Tell them the command to run instead.';
