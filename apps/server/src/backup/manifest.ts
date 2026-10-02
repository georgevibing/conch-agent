/**
 * What's in a backup: the one place that decides, for every file Conch writes
 * under `CONCH_HOME` (ADR 0020).
 *
 * - **kept** — yours, backed up and restored: settings, memories, commands,
 *   routines, skills, integrations, and (behind “Include chats”) your chats.
 * - **secret** — keys and sign-ins. Only in a backup locked with a passphrase,
 *   or in the Undo copy that never leaves this computer.
 * - **derived** — never backed up: Conch rebuilds it by itself, or it's only
 *   about this computer and this run.
 * - **outside** — not Conch's to back up: the backups themselves, and your
 *   work folder.
 *
 * A new store must add its files here (AGENTS.md): `manifest.test.ts` runs a
 * whole Conch in a temp home and fails on any file no rule covers.
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isBrokenCopy } from '../lib/recover';

export type BackupClass = 'kept' | 'secret' | 'derived' | 'outside';

/**
 * What a kept or secret file belongs to. A restore replaces a group as a
 * whole, so what was added since the backup goes too (and Undo brings it back).
 */
export type BackupGroup =
  'settings' | 'memory' | 'commands' | 'routines' | 'skills' | 'integrations' | 'chats' | 'secrets';

export interface BackupRule {
  /**
   * Where, relative to `CONCH_HOME` with `/`: `*` stays within a folder, `**`
   * crosses folders. A function for names no glob says well.
   */
  match: string | ((path: string) => boolean);
  class: BackupClass;
  /** For kept and secret files. */
  group?: BackupGroup;
  /**
   * Restored by merging with what's here rather than replacing it (and never
   * removed when the backup has none): `usage` keeps money already spent.
   */
  merge?: 'usage' | 'tasks';
  /** Why, in one line (the ADR quotes these). */
  why: string;
}

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** First match wins, so what's never backed up comes first. */
export const RULES: readonly BackupRule[] = [
  {
    match: 'codex.secrets.json',
    class: 'secret',
    group: 'secrets',
    why: 'Conch’s isolated ChatGPT sign-in; only in encrypted backups.',
  },
  {
    match: 'codex-runtime/**',
    class: 'outside',
    why: 'Transient active Codex credential copies: never backed up.',
  },
  {
    match: 'codex-sessions/**',
    class: 'derived',
    why: 'Provider-native sessions; Conch’s conversation transcript is the durable record.',
  },
  // ── Outside: not Conch's to back up ────────────────────────────────────
  {
    match: 'backups/**',
    class: 'outside',
    why: 'The backups themselves (and a restore being readied): a backup of backups would only grow.',
  },
  {
    match: 'workspace/**',
    class: 'outside',
    why: 'Your work folder: your own files, like any folder you point Conch at. Back it up with your other files.',
  },

  // ── Derived: rebuilt by itself, or only about this computer ────────────
  {
    match: (path) => isBrokenCopy(base(path)),
    class: 'derived',
    why: 'A damaged copy Conch set aside while healing (lib/recover.ts); the good file is backed up.',
  },
  {
    match: '**/*.tmp',
    class: 'derived',
    why: 'Half of an atomic write that a crash interrupted; the real file is backed up.',
  },
  {
    match: 'search.db*',
    class: 'derived',
    why: 'The search index: rebuilt from your chats when it’s missing.',
  },
  {
    match: 'healed.json',
    class: 'derived',
    why: 'What Conch fixed on this computer: reassurance about this machine, not something to move.',
  },
  {
    match: 'import.json',
    class: 'derived',
    why: 'What the last import from OpenClaw or Hermes added, for its Undo: about this computer’s copy of things.',
  },
  {
    match: 'models/**',
    class: 'derived',
    why: 'Conch’s own model for memory search by meaning: a download pinned by hash, fetched again when missing.',
  },
  {
    match: 'memory-index.db*',
    class: 'derived',
    why: 'Memory search by meaning: vectors made from your memories, made again when missing.',
  },
  {
    match: 'memory-tidy.json',
    class: 'derived',
    why: 'What the memory tidy-up changed lately, for Undo: about this computer’s memories, as they were.',
  },
  {
    match: 'gateway.json',
    class: 'derived',
    why: 'Where this run of Conch listens; written again on every start.',
  },
  {
    match: 'background/**',
    class: 'derived',
    why: 'How this computer starts Conch at login (Always on): written for this computer’s paths. Turn Always on on again on a new one; a restore never does it for you.',
  },
  {
    match: 'push.secrets.json',
    class: 'derived',
    why: 'Where notifications go: this Conch’s own key and each browser’s subscription, both tied to this computer. After a restore, each device turns its notifications on again by itself.',
  },
  {
    match: 'voice/**',
    class: 'derived',
    why: 'Private dictation’s speech model (downloaded again when it’s missing) and recordings being read, which are deleted at once.',
  },
  {
    match: 'tasks.json',
    class: 'kept',
    group: 'chats',
    merge: 'tasks',
    why: 'Goals and operation receipts prevent duplicate effects. Restored tasks require explicit resumption and provider reconciliation.',
  },
  {
    match: 'worktrees/**',
    class: 'outside',
    why: 'Helpers’ own copies of your work folder (git worktrees). What they changed is on a branch in your repository; back it up with your code.',
  },
  {
    match: 'shortcut/**',
    class: 'derived',
    why: 'The Conch app’s files for this computer (the Start menu, the app menu): written again from where Conch is.',
  },
  {
    match: 'undo/**',
    class: 'derived',
    why: 'What the assistant changed, kept so it can be undone: copies of files on this computer, about this computer’s folders.',
  },
  {
    match: 'tray/**',
    class: 'derived',
    why: 'Conch’s menu bar helper, built on this computer, and its token: made again on the next start.',
  },
  {
    match: 'logs/**',
    class: 'derived',
    why: 'What Conch said while running in the background: about this computer and these runs.',
  },
  {
    match: 'updates.json',
    class: 'derived',
    why: 'What’s installed on this computer and what’s newest: looked up again. Automatic updates are switched on again by you (it asks that it’s you), never by a restore.',
  },
  {
    match: 'browser/profile/**',
    class: 'derived',
    why: 'The browser’s own cookies and sign-ins: too sensitive to copy around and too big. Sign in to those sites again.',
  },

  // ── Kept: yours ────────────────────────────────────────────────────────
  {
    match: 'settings.json',
    class: 'kept',
    group: 'settings',
    why: 'Personality, about you, preferences.',
  },
  {
    match: 'browser.json',
    class: 'kept',
    group: 'settings',
    why: 'The browser’s settings and the sites you always allow.',
  },
  { match: 'terminal.json', class: 'kept', group: 'settings', why: 'The terminal’s settings.' },
  {
    match: 'backups.json',
    class: 'kept',
    group: 'settings',
    why: 'Whether Conch backs itself up every day.',
  },
  {
    match: 'usage.json',
    class: 'kept',
    group: 'settings',
    merge: 'usage',
    why: 'Your budget, and what you spent (chats you deleted included, so it can’t be rebuilt). Merged on restore: money already spent stays counted.',
  },
  { match: 'memory/*.md', class: 'kept', group: 'memory', why: 'Your memories, one file each.' },
  {
    match: 'artifacts/access.json',
    class: 'kept',
    group: 'chats',
    why: 'The sites each page made for you may read live data from, as you allowed (ADR 0046). A restore lists them first.',
  },
  {
    match: 'artifacts/**',
    class: 'kept',
    group: 'chats',
    why: 'What the assistant made for you in your chats (pages, documents, charts) and the apps you pinned, with their versions.',
  },
  { match: 'commands/*.md', class: 'kept', group: 'commands', why: 'Your slash commands.' },
  { match: 'routines/*.json', class: 'kept', group: 'routines', why: 'Your routines.' },
  {
    match: 'routines/*.runs.jsonl',
    class: 'kept',
    group: 'routines',
    why: 'Each routine’s run history.',
  },
  { match: 'skills/**', class: 'kept', group: 'skills', why: 'Your skills, with their files.' },
  {
    match: 'skill-suggestions.json',
    class: 'kept',
    group: 'skills',
    why: 'Skill suggestions you turned down, and a line of what each was about, so they stay down.',
  },
  {
    match: 'skills.trust.json',
    class: 'kept',
    group: 'skills',
    why: 'Whose signed skills you trust (by their key). A restore names them before bringing them back.',
  },
  {
    match: 'skills.signing.json',
    class: 'secret',
    group: 'secrets',
    why: 'Your own key for signing skills: only in a passphrase-locked backup, so skills you signed keep your name.',
  },
  {
    match: 'signal/attachments/**',
    class: 'derived',
    why: 'Files people sent you on Signal, as signal-cli keeps them; the ones your assistant read are in the chat’s attachments.',
  },
  {
    match: (path) => /^signal\/(avatars|stickers)\//.test(path),
    class: 'derived',
    why: 'Pictures signal-cli fetched for Signal profiles and stickers: fetched again when needed.',
  },
  {
    match: 'skills.json',
    class: 'kept',
    group: 'skills',
    why: 'On, off or when-asked for skills in other agents’ folders.',
  },
  {
    match: 'integrations.json',
    class: 'kept',
    group: 'integrations',
    why: 'What’s connected and how, with your per-tool choices (not its tokens).',
  },
  {
    match: 'channels.json',
    class: 'kept',
    group: 'integrations',
    why: 'Your channels (bots on Telegram, Discord and Slack, your linked WhatsApp and Signal) and who may talk to them (not their keys).',
  },
  {
    match: 'conversations/index.json',
    class: 'kept',
    group: 'chats',
    why: 'The chat list.',
  },
  {
    match: 'conversations/*.jsonl',
    class: 'kept',
    group: 'chats',
    why: 'Each chat, every message and step.',
  },
  {
    match: 'attachments/**',
    class: 'kept',
    group: 'chats',
    why: 'Files, pictures and long pastes sent in chats.',
  },
  {
    match: 'api-sessions/*.json',
    class: 'kept',
    group: 'chats',
    why: 'What a model API needs to carry on a chat: the provider’s own messages, verbatim. Signed thinking can’t be rebuilt from the chat, so this isn’t derived.',
  },
  {
    match: 'browser/shots/**',
    class: 'kept',
    group: 'chats',
    why: 'Pictures of what the agent saw while browsing, shown in the chat.',
  },

  {
    match: 'vault/sources.json',
    class: 'kept',
    group: 'settings',
    why: 'Which password managers Passwords shows, and where your KeePassXC database is. No secrets.',
  },
  {
    match: 'vault/remembered.json',
    class: 'derived',
    why: 'Passwords of the managers you keep unlocked, sealed with this computer’s own key. They never leave this computer; unlock them again on another.',
  },
  {
    match: 'vault/device.*',
    class: 'derived',
    why: 'This computer’s own key to your passwords. It never leaves this computer; a backup carries the vault’s key instead.',
  },

  // ── Secret: only with a passphrase ─────────────────────────────────────
  {
    match: 'secrets.json',
    class: 'secret',
    group: 'secrets',
    why: 'Provider keys (or 1Password references to them).',
  },
  {
    match: 'google.secrets.json',
    class: 'secret',
    group: 'secrets',
    why: 'Google app credentials and account sign-ins.',
  },
  {
    match: 'integrations.secrets.json',
    class: 'secret',
    group: 'secrets',
    why: 'Integration tokens and keys.',
  },
  {
    match: 'channels.secrets.json',
    class: 'secret',
    group: 'secrets',
    why: 'Your bots’ keys.',
  },
  {
    match: 'whatsapp.secrets.json',
    class: 'secret',
    group: 'secrets',
    why: 'Your WhatsApp link: this computer’s keys as a linked device. Whoever has them can read and send your messages.',
  },
  {
    match: 'signal/**',
    class: 'secret',
    group: 'secrets',
    why: 'Your Signal link: signal-cli’s keys as a linked device and its database. Whoever has them can read and send your messages.',
  },
  {
    match: 'vault/vault.json',
    class: 'secret',
    group: 'secrets',
    why: 'Your passwords, encrypted. In a backup only with a passphrase, with the key that opens them (`vault/key.json`).',
  },
  {
    match: 'vault/key.json',
    class: 'secret',
    group: 'secrets',
    why: 'The key to your passwords, only inside a passphrase-locked backup; a restore moves it into this computer’s keychain and deletes the file.',
  },
  {
    match: 'access.json',
    class: 'secret',
    group: 'secrets',
    why: 'Who may sign in: the password hash and access keys. Signed-in devices, approved devices and pairing codes are never backed up.',
  },
];

function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*' && glob.charAt(i + 1) === '*') {
      i++;
      if (glob.charAt(i + 1) === '/') {
        i++;
        source += '(?:.*/)?';
      } else source += '.*';
    } else if (c === '*') source += '[^/]*';
    else source += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

const compiled = RULES.map((rule) => ({
  rule,
  test:
    typeof rule.match === 'function'
      ? rule.match
      : (
          (re: RegExp) => (path: string) =>
            re.test(path)
        )(globToRegExp(rule.match)),
}));

/** The rule for a path relative to `CONCH_HOME` (with `/`), or undefined if none covers it. */
export function classify(path: string): BackupRule | undefined {
  return compiled.find((c) => c.test(path))?.rule;
}

/** A whole folder that's never backed up, so a walk needn't go in (a browser profile is big). */
function skipped(dir: string): boolean {
  return RULES.some(
    (rule) => (rule.class === 'derived' || rule.class === 'outside') && rule.match === `${dir}/**`,
  );
}

export interface HomeFile {
  /** Relative to `CONCH_HOME`, with `/`. */
  path: string;
  size: number;
  rule?: BackupRule;
}

/**
 * Every file under `home`, with its rule. Links are never followed (a link
 * could point anywhere). `all` goes into folders that are never backed up
 * too — for the coverage test.
 */
export async function walk(home: string, options: { all?: boolean } = {}): Promise<HomeFile[]> {
  const files: HomeFile[] = [];
  const visit = async (dir: string, rel: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!options.all && skipped(path)) continue;
        await visit(full, path);
      } else if (entry.isFile()) {
        const info = await lstat(full).catch(() => undefined);
        if (info?.isFile()) files.push({ path, size: info.size, rule: classify(path) });
      }
    }
  };
  await visit(home, '');
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The groups a backup holds, given whether chats and secrets go in. */
export function groupsFor(options: { chats: boolean; secrets: boolean }): BackupGroup[] {
  const groups: BackupGroup[] = [
    'settings',
    'memory',
    'commands',
    'routines',
    'skills',
    'integrations',
  ];
  if (options.chats) groups.push('chats');
  if (options.secrets) groups.push('secrets');
  return groups;
}

/**
 * The folders each group owns whole. A restore clears them first (what was
 * added since goes too), and makes them again even when empty: an empty
 * `commands/` keeps the starter commands from coming back.
 */
export const GROUP_DIRS: Partial<Record<BackupGroup, string[]>> = {
  memory: ['memory'],
  commands: ['commands'],
  routines: ['routines'],
  skills: ['skills'],
  chats: ['conversations', 'attachments', 'api-sessions', 'browser/shots'],
};

/** What a set of files holds, counted for the preview. Reads `integrations.json` from `read`. */
export async function countContents(
  files: readonly { path: string }[],
  read: (path: string) => Promise<Buffer | undefined>,
  options: { chats: boolean },
) {
  const paths = files.map((f) => f.path);
  const count = (re: RegExp) => paths.filter((p) => re.test(p)).length;
  const skills = new Set(
    paths.filter((p) => /^skills\/[^/]+\/SKILL\.md$/.test(p)).map((p) => p.split('/')[1]),
  );
  let integrations = 0;
  let integrationsSigningIn = 0;
  if (paths.includes('integrations.json')) {
    try {
      const raw = JSON.parse((await read('integrations.json'))?.toString('utf8') ?? '{}') as {
        integrations?: { auth?: string }[];
      };
      const list = Array.isArray(raw.integrations) ? raw.integrations : [];
      integrations = list.length;
      integrationsSigningIn = list.filter((i) => i.auth === 'oauth' || i.auth === 'token').length;
    } catch {
      // A damaged list counts as none; the store heals it when it's read.
    }
  }
  return {
    settings: paths.includes('settings.json'),
    memories: count(/^memory\/[^/]+\.md$/),
    commands: count(/^commands\/[^/]+\.md$/),
    routines: count(/^routines\/[^/]+(?<!\.runs)\.json$/),
    skills: skills.size,
    integrations,
    integrationsSigningIn,
    ...(options.chats && {
      chats: count(/^conversations\/[^/]+\.jsonl$/),
      attachments: count(/^attachments\/[^/]+\/meta\.json$/),
    }),
  };
}

/** Read a file under `home` by its relative path, or undefined if it's gone. */
export function reader(home: string) {
  return (path: string) => readFile(join(home, ...path.split('/'))).catch(() => undefined);
}
