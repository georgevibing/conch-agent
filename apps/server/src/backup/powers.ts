/**
 * What in a backup can act for you (ADR 0020), shown before it's restored:
 * an integration that runs a program on this computer, and everything set
 * to act without asking first — an integration or its tools, new chats in
 * “Full trust”, a routine that runs by itself with it, sites the browser
 * acts on, the browser reaching this computer's apps, other devices opening
 * a terminal.
 *
 * Read from the files themselves, and on purpose more eagerly than the
 * stores read them: an entry a store would still load is always listed,
 * even when something else about it is off. The names come from the file,
 * so they're cut to size, and the page shows them as text.
 */
import { POWER_TEXT_MAX, type BackupPower } from '@conch/protocol';

/** The files the preview reads (routine files, not their run history). */
export function previewReads(path: string): boolean {
  return (
    path === 'integrations.json' ||
    path === 'settings.json' ||
    path === 'browser.json' ||
    path === 'terminal.json' ||
    path === 'channels.json' ||
    path === 'skills.trust.json' ||
    path === 'artifacts/access.json' ||
    /^routines\/[^/]+(?<!\.runs)\.json$/.test(path)
  );
}

type Read = (path: string) => Buffer | undefined;

const MAX_LISTED = 20;

const APP_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  imessage: 'iMessage',
  email: 'Email',
  microsoftteams: 'Microsoft Teams',
  matrix: 'Matrix',
  wechat: 'WeChat',
};

const text = (value: unknown, fallback: string) => {
  const s = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const chosen = s || fallback;
  return chosen.length > POWER_TEXT_MAX ? `${chosen.slice(0, POWER_TEXT_MAX - 1)}…` : chosen;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function json(read: Read, path: string): Record<string, unknown> | undefined {
  const bytes = read(path);
  if (!bytes) return undefined;
  try {
    return record(JSON.parse(bytes.toString('utf8')));
  } catch {
    // A file that won't read is set aside by its store, never loaded.
    return undefined;
  }
}

/** `npx -y @scope/server "/Users/ada/My notes"`: the program and its arguments, as typed. */
function commandLine(command: unknown, args: unknown): string {
  const quote = (part: string) => (/[\s"]/.test(part) ? JSON.stringify(part) : part);
  const parts = [command, ...(Array.isArray(args) ? args : [])]
    .filter((p): p is string => typeof p === 'string')
    .map(quote);
  return text(parts.join(' '), '(a program)');
}

/** Off only when it says so: an entry that doesn't say is listed. */
const on = (value: unknown) => value !== false;

export function powersOf(files: readonly string[], read: Read): BackupPower[] {
  const powers: BackupPower[] = [];

  const integrations = json(read, 'integrations.json')?.integrations;
  for (const raw of Array.isArray(integrations) ? integrations : []) {
    const entry = record(raw);
    if (!entry || !on(entry.enabled)) continue;
    const name = text(entry.name ?? entry.server, 'An integration');
    const transport = record(entry.transport);
    if (transport?.type === 'stdio')
      powers.push({
        kind: 'runs-program',
        name,
        command: commandLine(transport.command, transport.args),
      });
    if (entry.policy === 'trust') {
      powers.push({ kind: 'integration-never-asks', name });
      continue;
    }
    const allowed = (Array.isArray(entry.tools) ? entry.tools : [])
      .map(record)
      .filter((tool) => tool?.policy === 'allow')
      .map((tool) => text(tool?.title ?? tool?.name, 'a tool'));
    if (allowed.length)
      powers.push({
        kind: 'tools-never-ask',
        name,
        tools: allowed.slice(0, MAX_LISTED),
        more: Math.max(0, allowed.length - MAX_LISTED),
      });
  }

  const settings = json(read, 'settings.json');
  if (record(settings?.preferences)?.permissionMode === 'bypassPermissions')
    powers.push({ kind: 'chats-never-ask' });

  for (const path of files.filter((f) => /^routines\/[^/]+(?<!\.runs)\.json$/.test(f)).sort()) {
    const routine = json(read, path);
    // A draft waits for you to turn it on; a paused one doesn't run.
    if (routine?.trust === 'full' && routine.status !== 'draft' && routine.status !== 'paused')
      powers.push({ kind: 'routine-never-asks', name: text(routine.title, 'A routine') });
  }

  const browser = json(read, 'browser.json');
  const sites = (Array.isArray(browser?.sites) ? browser.sites : [])
    .map((site) => record(site)?.site)
    .filter((site): site is string => typeof site === 'string' && site.trim() !== '')
    .map((site) => text(site, 'a site'));
  if (sites.length)
    powers.push({
      kind: 'browser-sites',
      sites: sites.slice(0, MAX_LISTED),
      more: Math.max(0, sites.length - MAX_LISTED),
    });
  if (record(browser?.settings)?.allowLocal === true) powers.push({ kind: 'browser-local' });

  if (record(json(read, 'terminal.json')?.settings)?.allowRemote === true)
    powers.push({ kind: 'terminal-remote' });

  // Pages that read live data (ADR 0046): an old backup mustn't quietly bring back a
  // site you took a page's OK from since.
  const approvals = json(read, 'artifacts/access.json')?.approvals;
  const pageSites = [
    ...new Set(
      (Array.isArray(approvals) ? approvals : [])
        .map((a) => record(a)?.host)
        .filter((host): host is string => typeof host === 'string' && host.trim() !== '')
        .map((host) => text(host, 'a site')),
    ),
  ];
  if (pageSites.length)
    powers.push({
      kind: 'page-data-sites',
      sites: pageSites.slice(0, MAX_LISTED),
      more: Math.max(0, pageSites.length - MAX_LISTED),
    });

  // A bot and the people it answers: restoring an old file must not quietly let
  // back in someone you removed since, so each one is named.
  const channels = json(read, 'channels.json')?.channels;
  for (const raw of Array.isArray(channels) ? channels : []) {
    const channel = record(raw);
    if (!channel || !on(channel.enabled)) continue;
    const people = (Array.isArray(channel.people) ? channel.people : [])
      .map(record)
      .map((person) => text(person?.name ?? person?.username, 'Someone'));
    if (!people.length) continue;
    const bot = text(record(channel.bot)?.name, 'A bot');
    const app = APP_NAMES[String(channel.kind)] ?? 'a chat app';
    powers.push({
      kind: 'channel-people',
      name: text(`${bot} on ${app}`, 'A bot'),
      people: people.slice(0, MAX_LISTED),
      more: Math.max(0, people.length - MAX_LISTED),
    });
  }

  // Trusting a publisher lets its signed updates in: an old backup mustn't bring back
  // someone you stopped trusting.
  const publishers = json(read, 'skills.trust.json')?.publishers;
  const names = (Array.isArray(publishers) ? publishers : [])
    .map(record)
    .filter((p) => p && p.you !== true)
    .map((p) => text(p?.name, 'A publisher'));
  if (names.length)
    powers.push({
      kind: 'trusted-publishers',
      names: names.slice(0, MAX_LISTED),
      more: Math.max(0, names.length - MAX_LISTED),
    });

  return powers;
}
