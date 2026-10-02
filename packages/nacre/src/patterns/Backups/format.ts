import { formatBytes } from '../Attachments/fileType';

/** What a backup holds, counted (mirrors `BackupContents` in `@conch/protocol`). */
export interface BackupContentsInfo {
  settings: boolean;
  memories: number;
  commands: number;
  routines: number;
  skills: number;
  integrations: number;
  /** Integrations that sign in: without the backup's keys, they ask again. */
  integrationsSigningIn: number;
  /** Chats, when they're in it. */
  chats?: number;
  /** Files and pictures sent in those chats. */
  attachments?: number;
  /** Keys and sign-ins: locked with a passphrase, or an Undo copy's, kept here. */
  secrets?: 'passphrase' | 'local';
}

/**
 * Something in a backup that lets Conch act for you (mirrors `BackupPower`
 * in `@conch/protocol`). Names and commands come from the file: shown as
 * text, never as markup.
 */
export type BackupPowerInfo =
  | { kind: 'runs-program'; name: string; command: string }
  | { kind: 'integration-never-asks'; name: string }
  | { kind: 'tools-never-ask'; name: string; tools: string[]; more?: number }
  | { kind: 'chats-never-ask' }
  | { kind: 'routine-never-asks'; name: string }
  | { kind: 'browser-sites'; sites: string[]; more?: number }
  | { kind: 'browser-local' }
  | { kind: 'terminal-remote' }
  | { kind: 'channel-people'; name: string; people: string[]; more?: number }
  | { kind: 'trusted-publishers'; names: string[]; more?: number }
  | { kind: 'page-data-sites'; sites: string[]; more?: number };

/** What it is (“Files”, “The browser”), when the words need one. */
export interface PowerWords {
  subject?: string;
  text: string;
  /** A program and its arguments, shown as code. */
  code?: string;
}

/** “A”, “A and B”, “A, B and 3 more”, each name in quotes. */
function named(names: string[], more = 0): string {
  const quoted = names.map((n) => `“${n}”`);
  if (more > 0) return `${quoted.join(', ')} and ${more} more`;
  if (quoted.length <= 1) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1) ?? ''}`;
}

/** One thing that acts for you, in plain words. */
export function powerWords(power: BackupPowerInfo): PowerWords {
  switch (power.kind) {
    case 'runs-program':
      return {
        subject: power.name,
        text: 'Runs a program on this computer:',
        code: power.command,
      };
    case 'integration-never-asks':
      return { subject: power.name, text: 'Lets Conch act without asking you first' };
    case 'tools-never-ask':
      return {
        subject: power.name,
        text: `Lets Conch use ${named(power.tools, power.more)} without asking you first`,
      };
    case 'chats-never-ask':
      return { subject: 'New chats', text: 'Let Conch act without asking you first' };
    case 'routine-never-asks':
      return {
        subject: power.name,
        text: 'Runs by itself, and lets Conch act without asking you first',
      };
    case 'browser-sites':
      return {
        subject: 'The browser',
        text: `Acts on ${named(power.sites, power.more)} without asking you first`,
      };
    case 'browser-local':
      return { subject: 'The browser', text: 'Can open apps on this computer and your network' };
    case 'terminal-remote':
      return { text: 'Other devices can open a terminal on this computer' };
    case 'page-data-sites':
      return {
        subject: 'Pages',
        text: `Read live data from ${named(power.sites, power.more)} without asking again`,
      };
    case 'trusted-publishers':
      return {
        subject: 'Skills',
        text: `Trusts skills signed by ${named(power.names, power.more)}, and their updates`,
      };
    case 'channel-people':
      return {
        subject: power.name,
        text: `Lets ${named(power.people, power.more)} talk to your assistant`,
      };
  }
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${new Intl.NumberFormat().format(n)} ${n === 1 ? one : many}`;

/**
 * The short line for a list: “12 memories · 3 routines · 240 chats · 48 MB”.
 * Only what's there, most personal first.
 */
export function describeBackup(contents: BackupContentsInfo, size?: number): string {
  const parts = [
    contents.memories && plural(contents.memories, 'memory', 'memories'),
    contents.routines && plural(contents.routines, 'routine'),
    contents.skills && plural(contents.skills, 'skill'),
    contents.integrations && plural(contents.integrations, 'integration'),
    contents.chats && plural(contents.chats, 'chat'),
    size !== undefined && formatBytes(size),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Settings only';
}

/** “Tuesday 30 Sept, 14:02” (in the reader's own words for dates). */
export function formatBackupDate(
  at: number,
  options: { now?: number; locale?: string; timeZone?: string } = {},
): string {
  const now = options.now ?? Date.now();
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  const day = new Intl.DateTimeFormat(options.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: options.timeZone,
  }).format(at);
  const time = new Intl.DateTimeFormat(options.locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: options.timeZone,
  }).format(at);
  return `${day}, ${time}`;
}
