/**
 * Reading OpenClaw (ADR 0035), as its docs lay it out (Oct 2026):
 *
 * - `~/.openclaw/openclaw.json` (JSON5): channel keys
 *   (`channels.telegram.botToken`, or `channels.telegram.accounts.<id>.botToken`
 *   with `defaultAccount`; Discord's `token`, Slack's `botToken` / `appToken`),
 *   and `env` for provider keys.
 * - The workspace (default `~/.openclaw/workspace`): `SOUL.md` (persona),
 *   `IDENTITY.md` (`- **Name:**`, `Emoji`, `Avatar`, `Theme`, `Creature`,
 *   `Vibe` lines), `AGENTS.md` (standing orders), `USER.md` (about you),
 *   `MEMORY.md`, `memory/YYYY-MM-DD.md` (daily notes), `skills/<name>/SKILL.md`.
 * - `~/.openclaw/skills/` (managed skills), `~/.openclaw/cron/jobs.json`,
 *   `~/.openclaw/.env`, and `agents/<id>/agent/auth-profiles.json` for keys.
 * - Its agents (ADR 0042, ADR 0101): `agents.entries.<id>` (and the older
 *   `agents.list` roster, `[{ id, default, ... }]`), each with `name`,
 *   `workspace`, `model` (`provider/model` or `{ primary }`), `thinkingDefault`
 *   and `identity: { name, theme, emoji, avatar }` (a workspace-relative path,
 *   an `http(s)` address or a `data:` URI). Other agents' workspaces are
 *   `~/.openclaw/workspace-<id>` by default. A cron job's `agentId` says which
 *   one it ran as. The default is the roster's legacy `default: true`, else
 *   `agents.defaults.systemAgent.agentId`, else the only agent there is.
 * - `bindings: [{ agentId, match: { channel, accountId?, peer? } }]`: which
 *   agent answers which chat app's account.
 * - The model: `agents.defaults.model`, `provider/model` or `{ primary }`.
 * - Slack over HTTP has a bot token and a signing secret, but no app token.
 *
 * Older installs used `~/.clawdbot` (`clawdbot.json`) and `~/.moltbot`.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { effortFrom } from './agents';
import {
  empty,
  KEY_SOURCES,
  keysInEnv,
  type Found,
  type FoundAgent,
  type FoundAvatar,
  type FoundChannel,
  type FoundIdentity,
  type FoundRoutine,
} from './found';
import { openClawModel } from './model';
import {
  entries,
  frontMatter,
  get,
  isDir,
  MAX_FILE,
  memoryEntries,
  parseEnv,
  parseJson5,
  prose,
  readText,
  str,
} from './read';
import { scheduleFrom, zoneOr } from './schedule';

const NAMES = [
  { dir: '.openclaw', config: 'openclaw.json' },
  { dir: '.clawdbot', config: 'clawdbot.json' },
  { dir: '.moltbot', config: 'moltbot.json' },
];

/** OpenClaw's folder on this computer, newest name first. */
export async function findOpenClaw(
  home = homedir(),
): Promise<{ path: string; config: string } | undefined> {
  for (const n of NAMES) {
    const path = join(home, n.dir);
    if (await isDir(path)) return { path, config: join(path, n.config) };
  }
  return undefined;
}

const expand = (path: string, home: string) =>
  path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : resolve(path);

/** Skill folders under `dir`: one level, each with a SKILL.md. */
async function skillsIn(dir: string): Promise<{ name: string; path: string }[]> {
  const out: { name: string; path: string }[] = [];
  for (const e of await entries(dir)) {
    if (!e.dir) continue;
    const path = join(dir, e.name);
    if ((await readText(join(path, 'SKILL.md'))) !== undefined) out.push({ name: e.name, path });
  }
  return out;
}

/** An agent id as OpenClaw allows it, and safe as part of a path. */
export const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** IDENTITY.md's fields: `- **Name:** Pearl` lines, its template's placeholders ignored. */
type IdentityField = 'name' | 'emoji' | 'avatar' | 'theme' | 'creature' | 'vibe';
type IdentityFields = Partial<Record<IdentityField, string>>;

/** A template's placeholder (`_(pick something you like)_`), or nothing at all. */
const placeholder = (value: string) =>
  !value || /^_?\(.*\)_?$/.test(value) || /^_.*_$/.test(value) || /^[-–—]$/.test(value);

export function identityFields(text: string): IdentityFields {
  const out: IdentityFields = {};
  const lines = frontMatter(text).body.split('\n');
  for (const [i, line] of lines.entries()) {
    const m =
      /^\s*[-*+]?\s*\**\s*(name|emoji|avatar|theme|creature|vibe)\s*\**\s*:\s*\**\s*(.*?)\s*\**\s*$/i.exec(
        line,
      );
    const key = m?.[1]?.toLowerCase() as IdentityField | undefined;
    if (!m || !key || out[key]) continue;
    let value = (m[2] ?? '').trim();
    // The template puts the hint on the next line; someone may put the answer there.
    const next = lines[i + 1];
    if (!value && next && /^\s{2,}\S/.test(next) && !/^\s*[-*+]\s/.test(next)) value = next.trim();
    if (placeholder(value)) continue;
    out[key] = value.slice(0, 2000);
  }
  return out;
}

/**
 * The sections of OpenClaw's own AGENTS.md template (and its older ones):
 * how OpenClaw keeps its files, heartbeats and group chats. They describe
 * OpenClaw, not the person, so they stay behind; what the person added comes.
 */
const TEMPLATE_SECTIONS = new Set(
  [
    'AGENTS.md - Your Workspace',
    'AGENTS.md',
    'First Run',
    'Session Startup',
    'Every Session',
    'Memory',
    'Write It Down',
    'Write It Down - No "Mental Notes"!',
    'Memory Maintenance',
    'MEMORY.md - Your Long-Term Memory',
    'MEMORY.md - Durable Facts and Decisions',
    'USER.md - Durable User Directives',
    'Red Lines',
    'Safety',
    'Existing Solutions Preflight',
    'External vs Internal',
    'Group Chats',
    'Know When to Speak',
    'Know When to Speak!',
    'React Like a Human',
    'React Like a Human!',
    'Tools',
    'Local notes',
    'Automations - Be Proactive',
    'Heartbeats - Be Proactive!',
    '💓 Heartbeats - Be Proactive!',
    'Heartbeat vs Cron: When to Use Each',
    'Make It Yours',
    'Related',
  ].map((h) => headingKey(h)),
);
const TEMPLATE_LINES = new Set(
  [
    'Keep workspace conventions here. Personality and tone belong in `SOUL.md`.',
    'This folder is home. Treat it that way.',
  ].map((l) => l.toLowerCase()),
);

function headingKey(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** AGENTS.md without OpenClaw's own template: the sections and lines a person wrote. */
export function ownConventions(text: string): string | undefined {
  const kept: string[] = [];
  let keep = true;
  for (const line of frontMatter(text).body.split('\n')) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      keep = !TEMPLATE_SECTIONS.has(headingKey(heading[2] ?? ''));
      if (keep) kept.push(line);
      continue;
    }
    if (!keep || TEMPLATE_LINES.has(line.trim().toLowerCase())) continue;
    kept.push(line);
  }
  // A heading with nothing under it says nothing.
  const blocks = kept.join('\n').split(/\n(?=#{1,6}\s)/);
  const said = blocks.filter((b) => b.replace(/^#{1,6}\s+[^\n]*\n?/, '').trim()).join('\n');
  return prose(said, MAX_FILE);
}

/** Where its picture is: a file in its workspace, a `data:` URI, or a web address (never fetched). */
function avatarAt(value: string | undefined, workspace: string): FoundAvatar | undefined {
  if (!value) return undefined;
  if (/^data:/i.test(value)) return { kind: 'data', data: value };
  if (/^https?:\/\//i.test(value)) return { kind: 'web' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[A-Za-z]:[\\/]/.test(value))
    return { kind: 'outside' };
  if (value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:/.test(value))
    return { kind: 'outside' };
  if (value.split(/[\\/]+/).includes('..')) return { kind: 'outside' };
  return { kind: 'file', root: workspace, path: value };
}

/** What one workspace holds: its persona, about you, memories and own skills. */
async function readWorkspace(workspace: string): Promise<{
  identity: IdentityFields;
  soul?: string;
  conventions?: string;
  about?: { text: string; from: string };
  memories: FoundAgent['memories'];
  skills: FoundAgent['skills'];
}> {
  const soulText = await readText(join(workspace, 'SOUL.md'));
  const identityText = await readText(join(workspace, 'IDENTITY.md'));
  const agentsText = await readText(join(workspace, 'AGENTS.md'));
  const out: Awaited<ReturnType<typeof readWorkspace>> = {
    identity: identityText ? identityFields(identityText) : {},
    memories: [],
    skills: [],
  };
  const soul = soulText ? prose(soulText, MAX_FILE) : undefined;
  if (soul) out.soul = soul;
  const conventions = agentsText ? ownConventions(agentsText) : undefined;
  if (conventions) out.conventions = conventions;

  const user = await readText(join(workspace, 'USER.md'));
  const about = user ? prose(user) : undefined;
  if (about) out.about = { text: about, from: 'USER.md' };

  const memory = await readText(join(workspace, 'MEMORY.md'));
  if (memory)
    for (const text of memoryEntries(memory)) out.memories.push({ text, from: 'MEMORY.md' });
  // Daily notes: the newest two months, offered but not ticked.
  const days = (await entries(join(workspace, 'memory')))
    .filter((e) => !e.dir && /^\d{4}-\d{2}-\d{2}\.md$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .slice(-60);
  for (const day of days) {
    const text = await readText(join(workspace, 'memory', day));
    if (!text) continue;
    for (const entry of memoryEntries(text).slice(0, 40))
      out.memories.push({ text: entry, from: `memory/${day}`, daily: true });
  }
  out.skills = await skillsIn(join(workspace, 'skills'));
  return out;
}

/** `work` → “Work”. */
const titled = (id: string) => {
  const text = id.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** One agent in the config: from the keyed `agents.entries`, or the older `agents.list`. */
interface Listed {
  id: string;
  name?: string;
  workspace?: string;
  main: boolean;
  model?: unknown;
  thinking?: unknown;
  identity: { name?: string; emoji?: string; avatar?: string; theme?: string };
}

function roster(config: unknown): Listed[] {
  const read = (id: string, a: Record<string, unknown>, main: boolean): Listed => ({
    id,
    name: str(a.name),
    workspace: str(a.workspace),
    main,
    model: a.model,
    thinking: a.thinkingDefault,
    identity: {
      name: str(get(a, 'identity.name')),
      emoji: str(get(a, 'identity.emoji')),
      avatar: str(get(a, 'identity.avatar')),
      theme: str(get(a, 'identity.theme')),
    },
  });
  const out: Listed[] = [];
  const keyed = get(config, 'agents.entries');
  if (keyed && typeof keyed === 'object' && !Array.isArray(keyed))
    for (const [id, a] of Object.entries(keyed as Record<string, unknown>))
      if (a && typeof a === 'object')
        out.push(
          read(id, a as Record<string, unknown>, (a as { default?: unknown }).default === true),
        );
  const listed = get(config, 'agents.list');
  if (Array.isArray(listed))
    for (const a of listed)
      if (a && typeof a === 'object') {
        const r = a as Record<string, unknown>;
        const id = str(r.id) ?? '';
        if (!out.some((o) => o.id === id)) out.push(read(id, r, r.default === true));
      }
  return out.filter((a) => AGENT_ID.test(a.id));
}

const CHANNEL_KINDS = ['telegram', 'discord', 'slack'] as const;

/**
 * One chat app's bot: its own keys, else its default account's
 * (`channels.<app>.accounts.<defaultAccount ?? 'default'>`). Other accounts
 * are counted, to say they stay behind.
 */
function channelKeys(
  config: unknown,
  kind: (typeof CHANNEL_KINDS)[number],
): { keys: Record<string, unknown>; account?: string; others: number } | undefined {
  const block = get(config, `channels.${kind}`);
  if (!block || typeof block !== 'object') return undefined;
  const accounts = get(block, 'accounts');
  const ids =
    accounts && typeof accounts === 'object' && !Array.isArray(accounts)
      ? Object.keys(accounts).sort()
      : [];
  const top = block as Record<string, unknown>;
  const has = (k: Record<string, unknown>) =>
    Boolean(str(k.botToken) ?? str(k.token) ?? str(k.appToken));
  if (has(top)) return { keys: top, others: ids.length };
  const account = str(top.defaultAccount) ?? (ids.includes('default') ? 'default' : ids[0]);
  const keys = account ? get(accounts, account) : undefined;
  if (!account || !keys || typeof keys !== 'object') return undefined;
  return {
    keys: keys as Record<string, unknown>,
    account,
    others: ids.filter((id) => id !== account).length,
  };
}

/**
 * Which agent answered each chat app's bot (`bindings`): a route for the
 * whole account (no peer, guild or team), the bot's own account first, then
 * the app-wide `*`. Only the bot Come home brings is matched.
 */
function boundAgents(
  config: unknown,
  accounts: Partial<Record<FoundChannel['kind'], string | undefined>>,
): Map<FoundChannel['kind'], string> {
  const list = get(config, 'bindings');
  const out = new Map<FoundChannel['kind'], string>();
  if (!Array.isArray(list)) return out;
  const routes = list.filter(
    (b): b is Record<string, unknown> =>
      Boolean(b) &&
      typeof b === 'object' &&
      ((b as { type?: unknown }).type === undefined || (b as { type?: unknown }).type === 'route'),
  );
  for (const kind of CHANNEL_KINDS) {
    if (!(kind in accounts)) continue;
    // The bot Come home brings is the app's default account, so a binding
    // without an account means it too.
    const own = accounts[kind] ?? 'default';
    let wide: string | undefined;
    for (const b of routes) {
      const match = b.match as Record<string, unknown> | undefined;
      const agentId = str(b.agentId);
      if (!match || !agentId || str(match.channel) !== kind) continue;
      if (match.peer || match.guildId || match.teamId) continue;
      const account = str(match.accountId);
      if (account === '*') wide ??= agentId;
      else if (!account || account === own) {
        out.set(kind, agentId);
        break;
      }
    }
    if (!out.has(kind) && wide) out.set(kind, wide);
  }
  return out;
}

export async function readOpenClaw(home = homedir()): Promise<Found | undefined> {
  const where = await findOpenClaw(home);
  if (!where) return undefined;
  const found = empty('openclaw', 'OpenClaw', where.path);

  let config: unknown = {};
  const raw = await readText(where.config);
  if (raw !== undefined) {
    try {
      config = parseJson5(raw);
    } catch {
      found.problems.push(`${where.config} couldn’t be read, so its settings stay behind.`);
    }
  }

  // Its agents: the main one (its default, else the first), and any others.
  const agents = roster(config);
  const marked = agents.find((a) => a.main)?.id;
  const system = str(get(config, 'agents.defaults.systemAgent.agentId'));
  const knownDefault =
    marked ??
    (system && agents.some((a) => a.id === system) ? system : undefined) ??
    (agents.length <= 1 ? (agents[0]?.id ?? 'main') : undefined);
  const mainId = knownDefault ?? agents[0]?.id ?? 'main';
  if (knownDefault) found.defaultAgent = knownDefault;
  found.mainAgent = mainId;
  const mainListed = agents.find((a) => a.id === mainId);

  // The main workspace: where its personality, memory and own skills are.
  const defaultsWorkspace = str(get(config, 'agents.defaults.workspace'));
  const configured =
    mainListed?.workspace ?? defaultsWorkspace ?? str(get(config, 'agent.workspace'));
  const workspace = configured ? expand(configured, home) : join(where.path, 'workspace');
  // A configured workspace outside the home folder is still read, but only these named files.
  const main = await readWorkspace(workspace);
  if (main.about) found.about = main.about;
  found.memories.push(...main.memories);

  const seen = new Set<string>();
  for (const skill of [...main.skills, ...(await skillsIn(join(where.path, 'skills')))]) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    found.skills.push(skill);
  }

  const identity = (
    listed: Listed | undefined,
    id: string,
    read: Awaited<ReturnType<typeof readWorkspace>>,
    dir: string,
  ): FoundIdentity => {
    const fields = read.identity;
    const name = (fields.name ?? listed?.identity.name ?? listed?.name ?? titled(id)).slice(0, 80);
    const vibe = fields.theme ?? listed?.identity.theme ?? fields.creature ?? fields.vibe;
    const model = listed?.model !== undefined ? openClawModel(listed.model) : undefined;
    const effort = effortFrom(listed?.thinking);
    const avatar = avatarAt(fields.avatar ?? listed?.identity.avatar, dir);
    const emoji = fields.emoji ?? listed?.identity.emoji;
    return {
      id,
      name,
      ...(emoji && { emoji }),
      ...(avatar && { avatar }),
      ...(vibe && { vibe }),
      ...(read.soul && { soul: { text: read.soul, from: 'SOUL.md' } }),
      ...(read.conventions && { conventions: { text: read.conventions, from: 'AGENTS.md' } }),
      ...(model && { model }),
      ...(effort && { effort }),
      channels: [],
    };
  };
  const identities = new Map<string, FoundIdentity>();
  identities.set(mainId, identity(mainListed, mainId, main, workspace));

  // The others, each in its own workspace. One the config doesn't list (a
  // damaged config, a hand-made folder) is still found by its folder's name.
  for (const e of await entries(where.path)) {
    const id = /^workspace-(.+)$/.exec(e.name)?.[1];
    if (e.dir && id && AGENT_ID.test(id) && !agents.some((a) => a.id === id))
      agents.push({ id, main: false, identity: {} });
  }
  const others = new Map<string, FoundAgent>();
  for (const a of agents) {
    if (a.id === mainId || others.has(a.id)) continue;
    const candidates = [
      ...(a.workspace ? [expand(a.workspace, home)] : []),
      join(where.path, `workspace-${a.id}`),
      ...(defaultsWorkspace ? [join(expand(defaultsWorkspace, home), a.id)] : []),
    ];
    let dir: string | undefined;
    for (const c of candidates)
      if (c !== workspace && (await isDir(c))) {
        dir = c;
        break;
      }
    if (!dir) continue;
    const read = await readWorkspace(dir);
    const who = identity(a, a.id, read, dir);
    if (!read.soul && !read.identity.name && !a.workspace && !read.memories.length) {
      // `<defaults.workspace>/<id>` that's only a folder of something else: not an agent.
      if (dir !== join(where.path, `workspace-${a.id}`)) continue;
    }
    identities.set(a.id, who);
    const agent: FoundAgent = {
      id: a.id,
      name: who.name,
      ...(read.about && { about: read.about }),
      memories: read.memories,
      skills: read.skills.filter((s) => !seen.has(s.name)),
      routines: [],
    };
    for (const s of agent.skills) seen.add(s.name);
    others.set(a.id, agent);
  }

  const model = openClawModel(get(config, 'agents.defaults.model'));
  if (model) found.model = model;

  // Automations: cron jobs, each with a message for the agent.
  const cron = await readText(join(where.path, 'cron', 'jobs.json'));
  if (cron !== undefined) {
    try {
      const parsed = parseJson5(cron) as { jobs?: unknown[] } | unknown[];
      const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs ?? []);
      for (const job of jobs) {
        if (!job || typeof job !== 'object') continue;
        const j = job as Record<string, unknown>;
        const prompt =
          str(get(j, 'payload.message')) ??
          str(get(j, 'payload.text')) ??
          str(j.message) ??
          str(j.prompt);
        const schedule = scheduleFrom(j.schedule ?? j.cron);
        if (!prompt || !schedule) continue;
        const routine: FoundRoutine = {
          title: (str(j.name) ?? prompt).slice(0, 60),
          prompt: prompt.slice(0, 20_000),
          schedule,
          timezone: zoneOr(get(j, 'schedule.tz') ?? j.tz),
          enabled: j.enabled !== false,
        };
        // A job that ran as another agent goes with that agent.
        const owner = others.get(str(j.agentId) ?? '');
        (owner ? owner.routines : found.routines).push(routine);
      }
    } catch {
      found.problems.push('Its scheduled jobs couldn’t be read, so they stay behind.');
    }
  }

  // Chat apps it answers in: one bot each (the app's own, else its default account's).
  const accounts: Partial<Record<FoundChannel['kind'], string | undefined>> = {};
  const names = { telegram: 'Telegram', discord: 'Discord', slack: 'Slack' } as const;
  for (const kind of CHANNEL_KINDS) {
    const at = channelKeys(config, kind);
    if (!at) continue;
    const k = at.keys;
    if (at.others)
      found.problems.push(
        `OpenClaw’s other ${names[kind]} ${at.others === 1 ? 'bot stays' : 'bots stay'} behind: Come home brings one ${names[kind]} bot.`,
      );
    if (kind === 'slack') {
      // Slack over HTTP keeps a bot token and a signing secret, but no app token:
      // it's offered anyway, with a step to get the other key (ADR 0042).
      const bot = str(k.botToken);
      const app = str(k.appToken);
      if (!bot && !app) continue;
      found.channels.push({
        kind,
        ...(bot && { token: bot }),
        ...(app && { appToken: app }),
        from: 'openclaw.json',
      });
    } else {
      const token =
        kind === 'telegram' ? (str(k.botToken) ?? str(k.token)) : (str(k.token) ?? str(k.botToken));
      if (!token) continue;
      found.channels.push({ kind, token, from: 'openclaw.json' });
    }
    accounts[kind] = at.account;
  }
  for (const [kind, agentId] of boundAgents(config, accounts))
    identities.get(agentId)?.channels.push(kind);

  // Provider keys: its .env, the config's env block, and its agents' auth profiles.
  const env = {
    ...parseEnv((await readText(join(where.path, '.env'))) ?? ''),
    ...Object.fromEntries(
      Object.entries((get(config, 'env') as Record<string, unknown> | undefined) ?? {}).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    ),
  };
  // The main agent's sign-ins first; another agent's only fill a gap.
  for (const id of [mainId, ...others.keys()]) {
    const auth = await readText(join(where.path, 'agents', id, 'agent', 'auth-profiles.json'));
    if (!auth) continue;
    try {
      const profiles = (get(parseJson5(auth), 'profiles') ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const p of Object.values(profiles)) {
        const provider = str(p.provider);
        const key = str(p.key) ?? str(p.apiKey);
        // An API key, not a sign-in (a Claude or ChatGPT sign-in is its own app's to keep).
        if (!key || p.type === 'oauth' || p.type === 'token') continue;
        const source = KEY_SOURCES.find((s) => provider && s.names.includes(provider));
        const variable = source?.env[0];
        if (variable) env[variable] ??= key;
      }
    } catch {
      const problem = 'Its saved sign-ins couldn’t be read; add keys in Conch yourself.';
      if (!found.problems.includes(problem)) found.problems.push(problem);
    }
  }
  found.keys.push(...keysInEnv(env, 'OpenClaw'));

  found.agents = [...others.values()].filter(
    (a) => a.about || a.memories.length || a.skills.length || a.routines.length,
  );
  // Every agent with something of its own: a voice, a name, a face or a job.
  found.identities = [...identities.values()].filter(
    (i) =>
      i.id === mainId ||
      i.soul ||
      i.conventions ||
      i.emoji ||
      i.avatar ||
      agents.some((a) => a.id === i.id && (a.name || a.identity.name)) ||
      others.get(i.id)?.routines.length,
  );
  // A main agent with nothing of its own (no SOUL.md, no name) isn't one to bring.
  const first = found.identities[0];
  if (
    first?.id === mainId &&
    !first.soul &&
    !first.conventions &&
    first.name === titled(mainId) &&
    !first.emoji &&
    !first.avatar
  )
    found.identities.shift();
  return found;
}
