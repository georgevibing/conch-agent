/**
 * Reading Hermes Agent (ADR 0035), as its docs lay it out (Oct 2026):
 *
 * - `~/.hermes/SOUL.md` (personality), `~/.hermes/memories/MEMORY.md` and
 *   `USER.md` (entries separated by `§`).
 * - `~/.hermes/skills/<category>/<name>/SKILL.md` (or one level, `<name>/`).
 * - `~/.hermes/cron/jobs.json`: jobs with a prompt and a schedule ("every 2h",
 *   a cron line, a time).
 * - `~/.hermes/.env`: `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`,
 *   `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`.
 * - `~/.hermes/config.yaml` (ADR 0042): `model.default` and `model.provider`
 *   (or, in older files, `model: <name>`), and `agent.reasoning_effort`.
 *   Only those are read; keys a custom provider keeps there stay where they are.
 * - Profiles (ADR 0101): more agents, each a Hermes home of its own in
 *   `~/.hermes/profiles/<name>/` (a name like `[a-z0-9][a-z0-9_-]{0,63}`,
 *   with one of `config.yaml`, `.env`, `SOUL.md`, `profile.yaml`), laid out as
 *   above. `profile.yaml` keeps `display_name`, `description` and Bot Mode's
 *   `ui_meta.hermes-bots` (`title`, `avatar`). `~/.hermes` itself is the
 *   `default` profile; `~/.hermes/active_profile` names the one plain
 *   `hermes` uses, which is its default.
 */
import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { effortFrom } from './agents';
import {
  empty,
  keysInEnv,
  type Found,
  type FoundAgent,
  type FoundAvatar,
  type FoundChannel,
  type FoundIdentity,
  type FoundModel,
  type FoundRoutine,
} from './found';
import { hermesModel } from './model';
import {
  changedAt,
  entries,
  get,
  isDir,
  MAX_FILE,
  memoryEntries,
  parseEnv,
  parseJson5,
  parseYaml,
  prose,
  readText,
  str,
} from './read';
import { scheduleFrom, zoneOr } from './schedule';

export async function findHermes(home = homedir()): Promise<string | undefined> {
  const path = join(home, '.hermes');
  return (await isDir(path)) ? path : undefined;
}

/** A profile's name as Hermes allows it (`hermes_constants.PROFILE_ID_RE`), safe in a path. */
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** What makes a folder under `profiles/` a profile, as Hermes decides it. */
const PROFILE_FILES = ['config.yaml', '.env', 'SOUL.md', 'profile.yaml', 'auth.json', 'state.db'];

/** One Hermes home (`~/.hermes` or a profile), read the same way. */
interface HermesHome {
  soul?: string;
  /** When SOUL.md last changed (ms). */
  soulAt?: number;
  about?: { text: string; from: string };
  memories: Found['memories'];
  skills: Found['skills'];
  routines: FoundRoutine[];
  env: Record<string, string>;
  model?: FoundModel;
  effort?: FoundIdentity['effort'];
  meta: { name?: string; role?: string; avatar?: FoundAvatar };
  problems: string[];
}

async function readHome(path: string, whose: string): Promise<HermesHome> {
  const out: HermesHome = {
    memories: [],
    skills: [],
    routines: [],
    env: {},
    meta: {},
    problems: [],
  };
  const soul = await readText(join(path, 'SOUL.md'));
  const instructions = soul ? prose(soul, MAX_FILE) : undefined;
  if (instructions) out.soul = instructions;
  const soulAt = await changedAt(join(path, 'SOUL.md'));
  if (soulAt) out.soulAt = soulAt;

  const user = await readText(join(path, 'memories', 'USER.md'));
  const about = user ? prose(memoryEntries(user).join('\n')) : undefined;
  if (about) out.about = { text: about, from: 'memories/USER.md' };

  const memory = await readText(join(path, 'memories', 'MEMORY.md'));
  if (memory)
    for (const text of memoryEntries(memory))
      out.memories.push({ text, from: 'memories/MEMORY.md' });

  // Skills, by category or on their own.
  for (const e of await entries(join(path, 'skills'))) {
    if (!e.dir) continue;
    const dir = join(path, 'skills', e.name);
    if ((await readText(join(dir, 'SKILL.md'))) !== undefined) {
      out.skills.push({ name: e.name, path: dir });
      continue;
    }
    for (const inner of await entries(dir)) {
      if (!inner.dir) continue;
      const skill = join(dir, inner.name);
      if (
        (await readText(join(skill, 'SKILL.md'))) !== undefined &&
        !out.skills.some((s) => s.name === inner.name)
      )
        out.skills.push({ name: inner.name, path: skill });
    }
  }

  const cron = await readText(join(path, 'cron', 'jobs.json'));
  if (cron !== undefined) {
    try {
      const parsed = parseJson5(cron) as { jobs?: unknown[] } | unknown[];
      const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs ?? []);
      for (const job of jobs) {
        if (!job || typeof job !== 'object') continue;
        const j = job as Record<string, unknown>;
        const prompt = str(j.prompt) ?? str(j.message) ?? str(j.task);
        const schedule = scheduleFrom(j.schedule ?? j.schedule_display ?? j.cron);
        if (!prompt || !schedule) continue;
        out.routines.push({
          title: (str(j.name) ?? prompt).slice(0, 60),
          prompt: prompt.slice(0, 20_000),
          schedule,
          timezone: zoneOr(j.timezone ?? get(j, 'schedule.tz')),
          enabled: j.enabled !== false && j.paused !== true,
        });
      }
    } catch {
      out.problems.push(`${whose} scheduled jobs couldn’t be read, so they stay behind.`);
    }
  }

  out.env = parseEnv((await readText(join(path, '.env'))) ?? '');

  // The model it answers with, and how hard it thinks.
  const config = await readText(join(path, 'config.yaml'));
  if (config !== undefined) {
    try {
      const parsed = parseYaml(config);
      const model = hermesModel(parsed);
      if (model) out.model = model;
      else if (parsed.model !== undefined && parsed.model !== '')
        out.problems.push(
          `${whose} model choice in config.yaml couldn’t be read, so it stays behind.`,
        );
      const effort = effortFrom(get(parsed, 'agent.reasoning_effort'));
      if (effort) out.effort = effort;
    } catch {
      out.problems.push(`${whose} config.yaml couldn’t be read, so its model choice stays behind.`);
    }
  }

  // Its name and face, as Hermes's profiles and Bot Mode keep them. Never a reason to stop.
  const meta = await readText(join(path, 'profile.yaml'));
  if (meta !== undefined) {
    try {
      const parsed = parseYaml(meta);
      const name = str(get(parsed, 'ui_meta.hermes-bots.title')) ?? str(parsed.display_name);
      if (name) out.meta.name = name.slice(0, 80);
      const role = str(parsed.description);
      if (role) out.meta.role = role;
      const avatar = str(get(parsed, 'ui_meta.hermes-bots.avatar'));
      if (avatar)
        out.meta.avatar = /^data:/i.test(avatar)
          ? { kind: 'data', data: avatar }
          : /^https?:\/\//i.test(avatar)
            ? { kind: 'web' }
            : avatar.startsWith('/') ||
                avatar.startsWith('~') ||
                avatar.split(/[\\/]+/).includes('..') ||
                /^[a-z][a-z0-9+.-]*:/i.test(avatar)
              ? { kind: 'outside' }
              : { kind: 'file', root: path, path: avatar };
    } catch {
      // A profile.yaml Conch can't read only costs it its title.
    }
  }
  return out;
}

/** `coder` → “Coder”. */
const titled = (id: string) => {
  const text = id.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const BOTS = [
  ['telegram', 'TELEGRAM_BOT_TOKEN'],
  ['discord', 'DISCORD_BOT_TOKEN'],
] as const;

export async function readHermes(home = homedir()): Promise<Found | undefined> {
  const path = await findHermes(home);
  if (!path) return undefined;
  const found = empty('hermes', 'Hermes', path);
  found.mainAgent = 'default';

  const root = await readHome(path, 'Its');
  if (root.about) found.about = root.about;
  found.memories.push(...root.memories);
  found.skills.push(...root.skills);
  found.routines.push(...root.routines);
  found.problems.push(...root.problems);

  const env = root.env;
  const channels: FoundChannel['kind'][] = [];
  for (const [kind, name] of BOTS)
    if (env[name]) {
      found.channels.push({ kind, token: env[name], from: '.env' });
      channels.push(kind);
    }
  // One Slack key without the other is offered anyway, with a step to get the other (ADR 0042).
  if (env.SLACK_BOT_TOKEN || env.SLACK_APP_TOKEN) {
    found.channels.push({
      kind: 'slack',
      ...(env.SLACK_BOT_TOKEN && { token: env.SLACK_BOT_TOKEN }),
      ...(env.SLACK_APP_TOKEN && { appToken: env.SLACK_APP_TOKEN }),
      from: '.env',
    });
    channels.push('slack');
  }
  if (root.model) found.model = root.model;

  const identity = (id: string, h: HermesHome, fallback: string): FoundIdentity => ({
    id,
    name: h.meta.name ?? fallback,
    ...(h.meta.role && { role: h.meta.role }),
    ...(h.meta.avatar && { avatar: h.meta.avatar }),
    ...(h.soul && {
      soul: { text: h.soul, from: id === 'default' ? 'SOUL.md' : `profiles/${id}/SOUL.md` },
    }),
    ...(h.soulAt && { wordsAt: h.soulAt }),
    ...(h.effort && { effort: h.effort }),
    channels: [],
  });
  // The default profile: its bots answered as it. Its model is the app's own (the model item).
  const main = identity('default', root, 'Hermes');
  main.channels = channels;
  // Hermes with nothing of its own (no SOUL.md, no name or face) isn't an agent to bring.
  if (root.soul || root.meta.name || root.meta.avatar || root.meta.role)
    found.identities.push(main);

  // Its other profiles, each a home of its own.
  const keys = new Map(keysInEnv(env, 'Hermes').map((k) => [k.provider, k]));
  const skillNames = new Set(found.skills.map((s) => s.name));
  for (const e of (await entries(join(path, 'profiles'))).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!e.dir || !PROFILE_ID.test(e.name) || e.name === 'default') continue;
    const dir = join(path, 'profiles', e.name);
    const present = await Promise.all(
      PROFILE_FILES.map(async (f) => (await lstat(join(dir, f)).catch(() => undefined))?.isFile()),
    );
    if (!present.some(Boolean)) continue;
    const h = await readHome(dir, `${titled(e.name)}’s`);
    found.problems.push(...h.problems);
    const who = identity(e.name, h, titled(e.name));
    // Its own model, when it's not the app's default.
    if (h.model && h.model.model !== root.model?.model)
      who.model = { ...h.model, from: `profiles/${e.name}/config.yaml` };
    found.identities.push(who);
    const agent: FoundAgent = {
      id: e.name,
      name: who.name,
      ...(h.about &&
        h.about.text !== found.about?.text && {
          about: { ...h.about, from: `profiles/${e.name}/${h.about.from}` },
        }),
      memories: h.memories.map((m) => ({ ...m, from: `profiles/${e.name}/${m.from}` })),
      skills: h.skills.filter((s) => !skillNames.has(s.name)),
      routines: h.routines,
    };
    for (const s of agent.skills) skillNames.add(s.name);
    if (agent.about || agent.memories.length || agent.skills.length || agent.routines.length)
      found.agents.push(agent);
    // A profile's own keys only fill a gap; its own bots stay with it.
    for (const k of keysInEnv(h.env, 'Hermes')) if (!keys.has(k.provider)) keys.set(k.provider, k);
    const bots = [
      ...BOTS.filter(([, n]) => h.env[n] && h.env[n] !== env[n]).map(([kind]) => kind),
      ...(h.env.SLACK_BOT_TOKEN && h.env.SLACK_BOT_TOKEN !== env.SLACK_BOT_TOKEN ? ['slack'] : []),
    ];
    if (bots.length)
      found.problems.push(
        `${who.name}’s own chat bots stay behind: Come home brings the main profile’s. Connect them in Apps → Talk to me here.`,
      );
  }
  found.keys.push(...keys.values());

  // `hermes profile use <name>` makes it the one plain `hermes` talks to: its default.
  const active = (await readText(join(path, 'active_profile')))?.trim();
  found.defaultAgent = active && found.identities.some((i) => i.id === active) ? active : 'default';
  return found;
}
