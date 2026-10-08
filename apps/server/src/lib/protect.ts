import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where Conch keeps the person's passwords and its own keys (ADR 0025 §
 * Agent's own tools). The agent's file and shell tools never touch these:
 * values only leave through Passwords, with the person's OK.
 */
export function protectedPaths(home: string): string[] {
  return [
    // Memories are read into every chat: the assistant writes them only through
    // `remember`, which checks them (ADR 0087), never by hand; and the key that
    // seals them would let it forge one.
    join(home, 'memory'),
    join(home, 'memory.seal'),
    // What a tidy-up changed: its Undo puts those words back.
    join(home, 'memory-tidy.json'),
    // Each agent's persona and instructions are read into every turn it answers (ADR 0101):
    // only a person changes them, in Conch, never the assistant's own file tools.
    join(home, 'agents'),
    join(home, 'vault'),
    join(home, 'codex.secrets.json'),
    join(home, 'codex-runtime'),
    join(home, 'codex-sessions'),
    join(home, 'secrets.json'),
    join(home, 'integrations.secrets.json'),
    join(home, 'google.secrets.json'),
    join(home, 'slack.secrets.json'),
    // A 1Password service account's token: whoever has it reads those vaults.
    join(home, 'onepassword.secrets.json'),
    // A cloud browser's key, or the address of a browser elsewhere (ADR 0080).
    join(home, 'browser.secrets.json'),
    join(home, 'channels.secrets.json'),
    // The secrets other apps sign their messages to routines with (ADR 0056).
    join(home, 'routines.secrets.json'),
    // What starts a routine: the assistant drafts these through Conch, never by hand.
    join(home, 'routines', 'when'),
    // A linked WhatsApp or Signal: whoever has these reads and sends your messages (ADR 0043).
    join(home, 'whatsapp.secrets.json'),
    join(home, 'signal'),
    // A Matrix session's encryption store, and what Teams chats Conch knows (ADR 0045).
    join(home, 'channels'),
    // Whether the public door is open: the agent mustn't open it.
    join(home, 'door.json'),
    // An address of your own lets the internet reach Conch, and its folder holds the
    // certificate's private key and the ACME account key (ADR 0064).
    join(home, 'address.json'),
    join(home, 'address'),
    // Where the running Conch listens and the names it answers to: `conch hello` puts its
    // one-time link at those names, so a name written here would receive the link's code.
    join(home, 'gateway.json'),
    // Restart budgets and recovery evidence cannot be reset by an agent's tools.
    join(home, 'recovery'),
    join(home, 'access.json'),
    // What proves a browser or a program is on this computer (ADR 0063): this computer's key,
    // the one-time files that open Conch, and the menu bar helper's token. With either, the
    // assistant could make itself "this computer" and approve its own devices.
    join(home, 'here'),
    join(home, 'tray'),
    // Task evidence is authority: the model must never forge completion or erase dedupe.
    join(home, 'tasks.json'),
    // What Conch learned and what it was told never to learn again, and what learning may
    // spend (ADR 0088): an assistant that could write these would clear its own never-list
    // or raise its own cap.
    join(home, 'learning'),
    join(home, 'learning-spend.json'),
    // Whose skills are trusted, and your signing key (ADR 0031): an assistant
    // that could write the one would vouch for its own skills.
    join(home, 'skills.trust.json'),
    join(home, 'skills.signing.json'),
    // Where a skill from Discover came from (ADR 0074): an assistant that wrote it could give
    // a skill a publisher, a pin or a check it never had.
    join(home, 'skills-market.json'),
    // Conch's own versions and which one runs (ADR 0051): writing there would run the assistant's code as Conch.
    join(home, 'versions'),
    // Programs Conch fetched and runs (whisper.cpp), and the voice models they read (ADR 0077).
    join(home, 'tools'),
    join(home, 'voice'),
    // Apps you added, their data and their keys (ADR 0061): the assistant changes an app
    // only through a card the person presses, and never reads what it keeps.
    join(home, 'conch-apps'),
    join(home, 'conch-app-data'),
    join(home, 'conch-apps.json'),
    // Which repositories publishing may push to: the assistant mustn't point it elsewhere.
    join(home, 'conch-apps-published.json'),
    join(home, 'conch-apps.secrets.json'),
    // Outside agents' keys (ADR 0112); the list is with your agents, in `agents`.
    join(home, 'a2a.secrets.json'),
    // Apps paired with Conch and their keys (ADR 0073): with one, the assistant could
    // reach Conch as that app, and with the list it could widen what one may use.
    join(home, 'mcp'),
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
 * `pnpm conch …` from the assistant's own shell, for what is the person's to do:
 *
 * - `skills sign|trust|forget|key`: signing with your key, or changing whose
 *   skills you trust, would let it vouch for its own skills (ADR 0047);
 * - `open`: hands out a link that makes a browser "this computer" (ADR 0063);
 * - `hello`: on a Conch nobody has claimed, a link whose opener owns it (ADR 0064);
 * - `setup`, `address`, `phone`: where Conch can be reached from (ADR 0064, 0027);
 * - `password`, `key`, `revoke`, `pair`, `reset`, `sign-out-everywhere`,
 *   `passkeys remove` and `devices approve|on|off|reject|remove`: who may sign
 *   in, and from where.
 *
 * Whether it's typed `conch …` (the command the installer adds) or
 * `pnpm conch …`, the terminal commands open your keys the way the gateway
 * does, so these are the person's to type, never the assistant's. A fence for
 * the obvious spellings, not a box: protected paths and sealing still stand
 * behind it.
 */
const CONCH_POWERS =
  /\b(?:conch(?:\.cmd|\.exe|\.ps1)?|cli\.[cm]?[jt]s)["']?(?:\s+-\S*)*\s+(?:skills\s+(?:sign|trust|forget|key)|devices\s+(?:approve|on|off|reject|remove)|passkeys\s+remove|open|hello|setup|address|phone|password|key|revoke|pair|reset|sign-out-everywhere)\b/i;

export function runsConchPower(toolName: string, input: unknown): boolean {
  if (toolName !== 'Bash') return false;
  const command = (input as { command?: unknown } | undefined)?.command;
  return typeof command === 'string' && CONCH_POWERS.test(command);
}

export const CONCH_POWER_MESSAGE =
  'Signing skills, choosing whose skills to trust, deciding who may sign in and opening Conch as this computer are for the user to do in their own terminal, not for the assistant. Tell them the command to run instead.';
