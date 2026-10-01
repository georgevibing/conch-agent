/**
 * Reading OpenClaw (ADR 0035), as its docs lay it out (Sept 2026):
 *
 * - `~/.openclaw/openclaw.json` (JSON5): `agents.defaults.workspace`, channel
 *   keys (`channels.telegram.botToken`, `channels.discord.token`,
 *   `channels.slack.botToken` / `appToken`), and `env` for provider keys.
 * - The workspace (default `~/.openclaw/workspace`): `SOUL.md` (persona),
 *   `IDENTITY.md` (name), `USER.md` (about you), `MEMORY.md`,
 *   `memory/YYYY-MM-DD.md` (daily notes), `skills/<name>/SKILL.md`.
 * - `~/.openclaw/skills/` (managed skills), `~/.openclaw/cron/jobs.json`,
 *   `~/.openclaw/.env`, and `agents/<id>/agent/auth-profiles.json` for keys.
 *
 * Older installs used `~/.clawdbot` (`clawdbot.json`) and `~/.moltbot`.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { empty, type Found } from './found';
import {
  entries,
  get,
  isDir,
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

  // The workspace: where its personality, memory and own skills are.
  const configured =
    str(get(config, 'agents.defaults.workspace')) ?? str(get(config, 'agent.workspace'));
  const workspace = configured ? expand(configured, home) : join(where.path, 'workspace');
  // A configured workspace outside the home folder is still read, but only these named files.

  const soul = await readText(join(workspace, 'SOUL.md'));
  const identity = await readText(join(workspace, 'IDENTITY.md'));
  const name =
    identity && /^\s*[-*]?\s*\**name\**\s*:\s*\**\s*(.+?)\**\s*$/im.exec(identity)?.[1]?.trim();
  const instructions = soul ? prose(soul) : undefined;
  if (instructions || name)
    found.persona = {
      ...(name && { name: name.slice(0, 40) }),
      ...(instructions && { instructions }),
      from: soul ? 'SOUL.md' : 'IDENTITY.md',
    };

  const user = await readText(join(workspace, 'USER.md'));
  const about = user ? prose(user) : undefined;
  if (about) found.about = { text: about, from: 'USER.md' };

  const memory = await readText(join(workspace, 'MEMORY.md'));
  if (memory)
    for (const text of memoryEntries(memory)) found.memories.push({ text, from: 'MEMORY.md' });
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
      found.memories.push({ text: entry, from: `memory/${day}`, daily: true });
  }

  const seen = new Set<string>();
  for (const skill of [
    ...(await skillsIn(join(workspace, 'skills'))),
    ...(await skillsIn(join(where.path, 'skills'))),
  ]) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    found.skills.push(skill);
  }

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
        found.routines.push({
          title: (str(j.name) ?? prompt).slice(0, 60),
          prompt: prompt.slice(0, 20_000),
          schedule,
          timezone: zoneOr(get(j, 'schedule.tz') ?? j.tz),
          enabled: j.enabled !== false,
        });
      }
    } catch {
      found.problems.push('Its scheduled jobs couldn’t be read, so they stay behind.');
    }
  }

  // Chat apps it answers in.
  const telegram =
    str(get(config, 'channels.telegram.botToken')) ?? str(get(config, 'channels.telegram.token'));
  if (telegram) found.channels.push({ kind: 'telegram', token: telegram, from: 'openclaw.json' });
  const discord =
    str(get(config, 'channels.discord.token')) ?? str(get(config, 'channels.discord.botToken'));
  if (discord) found.channels.push({ kind: 'discord', token: discord, from: 'openclaw.json' });
  const slackBot = str(get(config, 'channels.slack.botToken'));
  const slackApp = str(get(config, 'channels.slack.appToken'));
  if (slackBot && slackApp)
    found.channels.push({
      kind: 'slack',
      token: slackBot,
      appToken: slackApp,
      from: 'openclaw.json',
    });

  // Provider keys: its .env, the config's env block, and the main agent's auth profiles.
  const env = {
    ...parseEnv((await readText(join(where.path, '.env'))) ?? ''),
    ...Object.fromEntries(
      Object.entries((get(config, 'env') as Record<string, unknown> | undefined) ?? {}).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    ),
  };
  const auth = await readText(join(where.path, 'agents', 'main', 'agent', 'auth-profiles.json'));
  if (auth) {
    try {
      const profiles = (get(parseJson5(auth), 'profiles') ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const p of Object.values(profiles)) {
        const provider = str(p.provider);
        const key = str(p.key) ?? str(p.apiKey);
        // An API key, not a Claude sign-in (those are Claude Code's to keep).
        if (provider === 'anthropic' && key && p.type !== 'oauth' && p.type !== 'token')
          env.ANTHROPIC_API_KEY ??= key;
        if (provider === 'openrouter' && key) env.OPENROUTER_API_KEY ??= key;
      }
    } catch {
      found.problems.push('Its saved sign-ins couldn’t be read; add keys in Conch yourself.');
    }
  }
  if (env.ANTHROPIC_API_KEY)
    found.keys.push({ provider: 'anthropic-api', value: env.ANTHROPIC_API_KEY, from: 'OpenClaw' });
  if (env.OPENROUTER_API_KEY)
    found.keys.push({ provider: 'openrouter', value: env.OPENROUTER_API_KEY, from: 'OpenClaw' });

  return found;
}
