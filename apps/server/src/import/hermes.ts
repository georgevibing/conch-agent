/**
 * Reading Hermes Agent (ADR 0035), as its docs lay it out (Sept 2026):
 *
 * - `~/.hermes/SOUL.md` (personality), `~/.hermes/memories/MEMORY.md` and
 *   `USER.md` (entries separated by `§`).
 * - `~/.hermes/skills/<category>/<name>/SKILL.md` (or one level, `<name>/`).
 * - `~/.hermes/cron/jobs.json`: jobs with a prompt and a schedule ("every 2h",
 *   a cron line, a time).
 * - `~/.hermes/.env`: `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`,
 *   `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

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

export async function findHermes(home = homedir()): Promise<string | undefined> {
  const path = join(home, '.hermes');
  return (await isDir(path)) ? path : undefined;
}

export async function readHermes(home = homedir()): Promise<Found | undefined> {
  const path = await findHermes(home);
  if (!path) return undefined;
  const found = empty('hermes', 'Hermes', path);

  const soul = await readText(join(path, 'SOUL.md'));
  const instructions = soul ? prose(soul) : undefined;
  if (instructions) found.persona = { instructions, from: 'SOUL.md' };

  const user = await readText(join(path, 'memories', 'USER.md'));
  const about = user ? prose(memoryEntries(user).join('\n')) : undefined;
  if (about) found.about = { text: about, from: 'memories/USER.md' };

  const memory = await readText(join(path, 'memories', 'MEMORY.md'));
  if (memory)
    for (const text of memoryEntries(memory))
      found.memories.push({ text, from: 'memories/MEMORY.md' });

  // Skills, by category or on their own.
  for (const e of await entries(join(path, 'skills'))) {
    if (!e.dir) continue;
    const dir = join(path, 'skills', e.name);
    if ((await readText(join(dir, 'SKILL.md'))) !== undefined) {
      found.skills.push({ name: e.name, path: dir });
      continue;
    }
    for (const inner of await entries(dir)) {
      if (!inner.dir) continue;
      const skill = join(dir, inner.name);
      if (
        (await readText(join(skill, 'SKILL.md'))) !== undefined &&
        !found.skills.some((s) => s.name === inner.name)
      )
        found.skills.push({ name: inner.name, path: skill });
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
        found.routines.push({
          title: (str(j.name) ?? prompt).slice(0, 60),
          prompt: prompt.slice(0, 20_000),
          schedule,
          timezone: zoneOr(j.timezone ?? get(j, 'schedule.tz')),
          enabled: j.enabled !== false && j.paused !== true,
        });
      }
    } catch {
      found.problems.push('Its scheduled jobs couldn’t be read, so they stay behind.');
    }
  }

  const env = parseEnv((await readText(join(path, '.env'))) ?? '');
  if (env.TELEGRAM_BOT_TOKEN)
    found.channels.push({ kind: 'telegram', token: env.TELEGRAM_BOT_TOKEN, from: '.env' });
  if (env.DISCORD_BOT_TOKEN)
    found.channels.push({ kind: 'discord', token: env.DISCORD_BOT_TOKEN, from: '.env' });
  if (env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN)
    found.channels.push({
      kind: 'slack',
      token: env.SLACK_BOT_TOKEN,
      appToken: env.SLACK_APP_TOKEN,
      from: '.env',
    });
  if (env.ANTHROPIC_API_KEY)
    found.keys.push({ provider: 'anthropic-api', value: env.ANTHROPIC_API_KEY, from: 'Hermes' });
  if (env.OPENROUTER_API_KEY)
    found.keys.push({ provider: 'openrouter', value: env.OPENROUTER_API_KEY, from: 'Hermes' });

  return found;
}
