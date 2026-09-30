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
