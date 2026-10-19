import { homedir } from 'node:os';
import { join, posix } from 'node:path';

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
    // Past chats from other apps (ADR 0111) are read through `read_chat`, never edited by hand:
    // a line written into one would read as something you once said.
    join(home, 'past-chats'),
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
    // Errands' own browser sessions: copies of sign-ins (ADR 0141).
    join(home, 'browser.errands.secrets.json'),
    // The cloud sandbox's key, and SSH's shared connections to your machines (ADR 0106).
    join(home, 'workplaces.secrets.json'),
    join(home, 'workplaces'),
    // Whether the assistant may use your apps, and the ones it always may (ADR 0110).
    join(home, 'computer-use.json'),
    // Where Conch's numbers go, and whether chats' words go with them (ADR 0121): pointed
    // elsewhere by the assistant, it would be a way out for what it read.
    join(home, 'telemetry.json'),
    join(home, 'telemetry.secrets.json'),
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
    // Standing orders and the check-in's choices (ADR 0107): an assistant that could write
    // these would give itself orders, or choose what interrupts you and when.
    join(home, 'standing-orders.json'),
    join(home, 'checkin.json'),
    join(home, 'checkin'),
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
  const plain = paths.some((p) => {
    const path = p.replaceAll('\\', '/');
    const tilde = path.startsWith(home) ? `~${path.slice(home.length)}` : undefined;
    return text.includes(path) || (tilde !== undefined && text.includes(tilde));
  });
  return plain || spelledOtherwise(stringsOf(input), paths, home);
}

/** Every string in a tool's input, however deep. */
function stringsOf(input: unknown, out: string[] = [], depth = 0): string[] {
  if (typeof input === 'string') out.push(input);
  else if (depth < 20 && input && typeof input === 'object')
    for (const value of Object.values(input)) stringsOf(value, out, depth + 1);
  return out;
}

/** The words of a command that could be paths: what quotes and shell marks leave. */
const WORD = /[^\s"'`|;&<>(){}=,]+/g;
const GLOB = /[*?[]/;

const pathKey = (path: string) =>
  posix
    .normalize(path.replaceAll('\\', '/'))
    .replace(/(?<=.)\/+$/, '')
    .toLowerCase();

/** A word as the place it names: `~` and `$HOME` read, `.`, `..` and `//` folded, any case. */
function placeOf(word: string, home: string, cwd: string | undefined): string | undefined {
  let path = word.replace(/^~(?=\/|$)/, home).replaceAll('\\', '/');
  if (!path.startsWith('/') && !/^[a-z]:\//i.test(path)) {
    if (!cwd || path.startsWith('-') || path.startsWith('$')) return undefined;
    path = `${cwd}/${path}`;
  }
  return pathKey(path);
}

/** A glob's one folder or file name, as a pattern. */
const segmentPattern = (segment: string) =>
  new RegExp(
    `^${segment
      .replace(/[.+^${}()|\\]/g, '\\$&')
      .replaceAll('*', '[^/]*')
      .replaceAll('?', '[^/]')}$`,
  );

/** Whether a place (maybe a glob) is a protected path or inside one. */
function inside(place: string, protectedKeys: readonly string[]): boolean {
  if (!GLOB.test(place)) return protectedKeys.some((p) => place === p || place.startsWith(`${p}/`));
  const segments = place.split('/');
  return protectedKeys.some((p) => {
    const wanted = p.split('/');
    if (segments.length < wanted.length) return false;
    return wanted.every((name, i) => {
      const segment = segments[i] ?? '';
      if (!GLOB.test(segment)) return segment === name;
      try {
        return segmentPattern(segment).test(name);
      } catch {
        return true;
      }
    });
  });
}

/**
 * The same places written another way (review): `$HOME`, `./` and `//`, another case
 * (macOS and Windows don't mind), `..`, a glob, or a `cd` into Conch's folder and a
 * name from there. A fence for what a model plausibly writes, not a box: sealing
 * still stands behind it.
 */
function spelledOtherwise(strings: readonly string[], paths: readonly string[], home: string) {
  const keys = paths.map(pathKey);
  for (const value of strings) {
    let cwd: string | undefined;
    let changing = false;
    const words = value.replace(/\$\{HOME\}|\$HOME\b/g, home).match(WORD) ?? [];
    for (const word of words) {
      if (changing) {
        changing = false;
        cwd = placeOf(word, home, cwd) ?? cwd;
        if (cwd && inside(cwd, keys)) return true;
        continue;
      }
      if (word === 'cd' || word === 'pushd') {
        changing = true;
        continue;
      }
      const place = placeOf(word, home, cwd);
      if (place && inside(place, keys)) return true;
    }
  }
  return false;
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
 *   in, and from where;
 * - `dashboards send|prometheus|token`: where Conch's numbers go, and who may
 *   read them (ADR 0121). Looking (`dashboards`, `status`, `test`) and `off` are anyone's.
 *
 * Whether it's typed `conch …` (the command the installer adds) or
 * `pnpm conch …`, the terminal commands open your keys the way the gateway
 * does, so these are the person's to type, never the assistant's. A fence for
 * the obvious spellings, not a box: protected paths and sealing still stand
 * behind it.
 */
const CONCH_POWERS =
  /\b(?:conch(?:\.cmd|\.exe|\.ps1)?|cli\.[cm]?[jt]s)["']?(?:\s+-\S*)*\s+(?:skills\s+(?:sign|trust|forget|key)|devices\s+(?:approve|on|off|reject|remove)|passkeys\s+remove|dashboards\s+(?:send|prometheus|token)|open|hello|setup|address|phone|password|key|revoke|pair|reset|sign-out-everywhere)\b/i;

export function runsConchPower(toolName: string, input: unknown): boolean {
  if (toolName !== 'Bash') return false;
  const command = (input as { command?: unknown } | undefined)?.command;
  return typeof command === 'string' && CONCH_POWERS.test(command);
}

export const CONCH_POWER_MESSAGE =
  'Signing skills, choosing whose skills to trust, deciding who may sign in and opening Conch as this computer are for the user to do in their own terminal, not for the assistant. Tell them the command to run instead.';
