import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { SkillStore } from '../skills/store';
import { importCommand, type ImportIo } from './cli';
import { hermesHome, openClawHome } from './fixtures';
import { readHermes } from './hermes';
import { readOpenClaw } from './openclaw';
import { memoryEntries, parseEnv, parseJson5 } from './read';
import { scheduleFrom } from './schedule';
import { ImportService, type ImportTargets } from './service';

let root: string;
let home: string;
let conch: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conch-comehome-'));
  home = join(root, 'home');
  conch = join(root, 'conch');
  mkdirSync(home);
  mkdirSync(conch);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('reading another agent’s files', () => {
  it('reads OpenClaw’s JSON5 config', () => {
    expect(
      parseJson5(`// a comment\n{ a: 1, 'b': 'it\\'s', c: "http://x/y", /* gone */ d: [1, 2,], }`),
    ).toEqual({ a: 1, b: "it's", c: 'http://x/y', d: [1, 2] });
  });

  it('reads .env files', () => {
    expect(parseEnv('export A=1\nB="two words" \n# no\nC=x # note\nbad line\n')).toEqual({
      A: '1',
      B: 'two words',
      C: 'x',
    });
  });

  it('splits memories the way each agent writes them, without headings or placeholders', () => {
    expect(
      memoryEntries('# Memory\n- one thing\n- two things\n\n## More\n- _(add more here)_\n'),
    ).toEqual(['one thing', 'two things']);
    expect(memoryEntries('First fact.\n§\nSecond fact,\nover two lines.\n§\n')).toEqual([
      'First fact.',
      'Second fact, over two lines.',
    ]);
  });

  it('turns their schedules into Conch’s', () => {
    expect(scheduleFrom({ kind: 'cron', expr: '0 8 * * 1-5' })).toEqual({
      type: 'cron',
      expression: '0 8 * * 1-5',
    });
    expect(scheduleFrom({ kind: 'every', everyMs: 2 * 3_600_000 })).toEqual({
      type: 'interval',
      every: 2,
      unit: 'hours',
    });
    expect(scheduleFrom('every 30m')).toEqual({ type: 'interval', every: 30, unit: 'minutes' });
    // Never faster than Conch allows.
    expect(scheduleFrom('every 1m')).toEqual({ type: 'interval', every: 15, unit: 'minutes' });
    expect(scheduleFrom({ kind: 'at', atMs: Date.now() - 1000 })).toBeUndefined();
    expect(scheduleFrom('whenever')).toBeUndefined();
  });
});

describe('OpenClaw', () => {
  it('finds everything, and keeps secrets as secrets', async () => {
    openClawHome(home);
    const found = await readOpenClaw(home);
    expect(found).toMatchObject({
      persona: { name: 'Pearl', instructions: expect.stringContaining('British spelling') },
      about: { text: expect.stringContaining('Ada Lovelace') },
    });
    expect(found?.memories.filter((m) => !m.daily).map((m) => m.text)).toEqual([
      'Ada takes her tea with lemon.',
      'Her sister is called Grace.',
      'The build runs on Fridays.',
    ]);
    expect(found?.memories.filter((m) => m.daily)).toHaveLength(2);
    expect(found?.skills.map((s) => s.name).sort()).toEqual(['solana-helper', 'weekly-review']);
    expect(found?.routines).toEqual([
      expect.objectContaining({
        title: 'Morning briefing',
        timezone: 'Europe/London',
        schedule: { type: 'cron', expression: '0 8 * * 1-5' },
      }),
    ]);
    expect(found?.channels).toMatchObject([{ kind: 'telegram' }]);
    expect(found?.keys.map((k) => k.provider).sort()).toEqual(['anthropic-api', 'openrouter']);
  });

  it('finds an older install under its old name', async () => {
    mkdirSync(join(home, '.clawdbot'));
    writeFileSync(join(home, '.clawdbot', 'clawdbot.json'), '{}');
    expect((await readOpenClaw(home))?.path).toBe(join(home, '.clawdbot'));
  });

  it('a damaged config is a sentence, and the rest still comes', async () => {
    openClawHome(home);
    writeFileSync(join(home, '.openclaw', 'openclaw.json'), '{ this is: not json at all');
    const found = await readOpenClaw(home);
    expect(found?.problems).toEqual([expect.stringMatching(/couldn’t be read/)]);
    expect(found?.memories.length).toBeGreaterThan(0);
  });

  it('never follows a link out of its folder', async () => {
    openClawHome(home);
    writeFileSync(join(home, 'elsewhere.md'), '- A secret from somewhere else.');
    rmSync(join(home, '.openclaw', 'workspace', 'MEMORY.md'));
    const { symlinkSync } = await import('node:fs');
    symlinkSync(join(home, 'elsewhere.md'), join(home, '.openclaw', 'workspace', 'MEMORY.md'));
    const found = await readOpenClaw(home);
    expect(found?.memories.some((m) => m.text.includes('somewhere else'))).toBe(false);
  });
});

describe('Hermes', () => {
  it('finds its § memories, skills by category, cron and .env', async () => {
    hermesHome(home);
    const found = await readHermes(home);
    expect(found?.memories.map((m) => m.text)).toEqual([
      'User prefers metric units.',
      'The project lives in ~/code/engine.',
    ]);
    expect(found?.about?.text).toContain('Timezone: Europe/London');
    expect(found?.skills.map((s) => s.name)).toEqual(['inbox-zero']);
    expect(found?.routines[0]).toMatchObject({
      title: 'Stand-up notes',
      enabled: false,
      schedule: { type: 'interval', every: 2 },
    });
    expect(found?.channels).toMatchObject([{ kind: 'discord', token: 'x.y.z' }]);
    expect(found?.keys).toMatchObject([{ provider: 'anthropic-api' }]);
  });
});

/** Conch's own stores in a temp home, and pretend routines, bots and keys. */
function targets(): ImportTargets & {
  log: string[];
  routines: ImportTargets['routines'] & { made: { title: string; status: string }[] };
} {
  const settings = new SettingsStore(conch);
  const memory = new MemoryStore(join(conch, 'memory'));
  const skills = new SkillStore(conch);
  const log: string[] = [];
  const made: { id: string; title: string; status: string }[] = [];
  const keys = new Set<string>();
  return {
    log,
    settings,
    memory,
    skills: {
      names: async () => (await skills.list({ fresh: true })).skills.map((s) => s.name),
      adopt: (folder, base) => skills.adopt(folder, base),
      remove: (id) => skills.remove(id),
    },
    routines: {
      made,
      create: async (input) => {
        const routine = { id: `r_${made.length}`, title: input.title, status: input.status };
        made.push(routine);
        return routine as never;
      },
      remove: async (id) => {
        made.splice(
          made.findIndex((r) => r.id === id),
          1,
        );
      },
    },
    channels: {
      connect: async (c) => {
        log.push(`connect ${c.kind}`);
        return { id: 'ch_1', name: '@pearl_bot' };
      },
      remove: async (id) => log.push(`remove ${id}`),
    },
    keys: {
      has: async (p) => keys.has(p),
      set: async (p) => keys.add(p),
      clear: async (p) => keys.delete(p),
    },
    backup: async () => {
      log.push('backup');
      return { id: 'auto-1' };
    },
  };
}

describe('bringing things over', () => {
  it('starts with the safe things ticked, and the rest unticked with why', async () => {
    openClawHome(home);
    const t = targets();
    await t.memory.add({ content: 'Ada takes her tea with lemon.', source: 'user' });
    const plan = await new ImportService({ home: conch, sourceHome: home, targets: t }).plan(
      'openclaw',
    );
    const by = (id: string) => plan.items.find((i) => i.id === id);
    expect(by('persona:name')).toMatchObject({
      checked: true,
      title: 'Call your assistant “Pearl”',
    });
    expect(by('persona:instructions')).toMatchObject({
      checked: true,
      preview: expect.stringContaining('British'),
    });
    expect(by('memory:0')).toMatchObject({ checked: false, duplicate: true });
    expect(by('memory:1')).toMatchObject({ checked: true });
    expect(
      plan.items.filter((i) => i.detail?.startsWith('A note from')).every((i) => !i.checked),
    ).toBe(true);
    expect(by('skill:weekly-review')).toMatchObject({
      checked: true,
      review: { verdict: 'clean' },
    });
    expect(by('skill:solana-helper')).toMatchObject({
      checked: false,
      review: { verdict: 'danger' },
      warning: expect.stringMatching(/worrying/),
    });
    expect(by('routine:0')).toMatchObject({
      checked: true,
      detail: expect.stringMatching(/draft/),
    });
    expect(by('channel:telegram')).toMatchObject({
      checked: false,
      warning: expect.stringMatching(/Stop OpenClaw first/),
    });
    expect(by('key:openrouter')).toMatchObject({ checked: false });
    // No secret ever reaches the plan.
    expect(JSON.stringify(plan)).not.toMatch(/not-real|from-hermes/);
  });

  it('backs up first, brings the ticked things, and undoes them — putting back what it replaced', async () => {
    openClawHome(home);
    const t = targets();
    await t.settings.update({
      persona: { instructions: 'My own words.' },
      profile: { about: 'I like maps.' },
    });
    const service = new ImportService({ home: conch, sourceHome: home, targets: t });
    const plan = await service.plan('openclaw');
    const ticked = [
      ...plan.items.filter((i) => i.checked).map((i) => i.id),
      'persona:instructions',
      'channel:telegram',
    ];
    const result = await service.run('openclaw', ticked);
    expect(t.log[0]).toBe('backup');
    expect(result).toMatchObject({
      backupId: 'auto-1',
      undoable: true,
      counts: { memories: 3, skills: 1, routines: 1, channels: 1 },
    });
    expect(result.outcomes.find((o) => o.id === 'channel:telegram')?.message).toMatch(
      /Say hello to @pearl_bot/,
    );

    const settings = await t.settings.get();
    expect(settings.persona).toMatchObject({
      name: 'Pearl',
      instructions: expect.stringContaining('British spelling'),
    });
    expect(settings.profile.about).toBe(
      'I like maps.\n\nAda Lovelace, in London. Works on analytical engines.',
    );
    expect((await t.memory.list()).length).toBe(3);
    const skills = new SkillStore(conch);
    const [weekly] = (await skills.list({ fresh: true })).skills;
    expect(weekly).toMatchObject({ name: 'weekly-review', mode: 'off' });
    // The link in the folder stayed behind.
    expect(existsSync(join(conch, 'skills', 'weekly-review', 'stolen.txt'))).toBe(false);
    expect(t.routines.made).toEqual([
      expect.objectContaining({ title: 'Morning briefing', status: 'draft' }),
    ]);
    // The other app's folder wasn't touched.
    expect(readFileSync(join(home, '.openclaw', 'workspace', 'MEMORY.md'), 'utf8')).toContain(
      'tea with lemon',
    );

    expect((await service.status()).last).toMatchObject({ source: 'openclaw' });
    const undone = await service.undo();
    expect(undone.removed).toBeGreaterThanOrEqual(6);
    const after = await t.settings.get();
    expect(after.persona.instructions).toBe('My own words.');
    expect(after.profile.about).toBe('I like maps.');
    expect(await t.memory.list()).toEqual([]);
    expect((await skills.list({ fresh: true })).skills).toEqual([]);
    expect(t.log).toContain('remove ch_1');
    await expect(service.undo()).rejects.toThrow(/no import to undo/);
    expect((await service.status()).sources[0]?.imported).toMatchObject({
      count: result.outcomes.length,
    });
  });

  it('a key comes over only when Conch has none, and Undo takes it back', async () => {
    hermesHome(home);
    const t = targets();
    const service = new ImportService({ home: conch, sourceHome: home, targets: t });
    await service.plan('hermes');
    await service.run('hermes', ['key:anthropic-api']);
    expect(await t.keys.has('anthropic-api')).toBe(true);
    await service.undo();
    expect(await t.keys.has('anthropic-api')).toBe(false);
  });

  it('says so when there’s nothing ticked, or nothing there', async () => {
    const t = targets();
    const service = new ImportService({ home: conch, sourceHome: home, targets: t });
    await expect(service.plan('openclaw')).rejects.toThrow(/isn’t on this computer/);
    hermesHome(home);
    await expect(service.run('hermes', [])).rejects.toThrow(/Tick something/);
    expect((await service.status()).sources.map((s) => s.id)).toEqual(['hermes']);
  });
});

describe('pnpm conch import', () => {
  const io = (running = false) => {
    const lines: string[] = [];
    const plain = (s: string) => s;
    const value: ImportIo = {
      say: (l = '') => lines.push(l),
      bold: plain,
      dim: plain,
      green: plain,
      yellow: plain,
      running: async () => running,
    };
    return { value, lines };
  };

  it('a dry run lists what would come, and changes nothing', async () => {
    openClawHome(home);
    const t = targets();
    const run = vi.spyOn(ImportService.prototype, 'run');
    const { value, lines } = io();
    expect(
      await importCommand(
        ['--from', 'openclaw', '--dry-run'],
        new ImportService({ home: conch, sourceHome: home, targets: t }),
        value,
      ),
    ).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('✓ Ada takes her tea with lemon.');
    expect(text).toContain('○ Your Telegram bot');
    expect(text).toContain('Nothing was changed');
    expect(run).not.toHaveBeenCalled();
    run.mockRestore();
  });

  it('leaves it to Conch when Conch is running, and never brings bots or keys', async () => {
    openClawHome(home);
    const t = targets();
    const service = new ImportService({ home: conch, sourceHome: home, targets: t });
    const busy = io(true);
    expect(await importCommand(['--from', 'openclaw'], service, busy.value)).toBe(1);
    expect(busy.lines.join('\n')).toMatch(/Conch is running/);
    const free = io(false);
    await importCommand(['--from', 'openclaw'], service, free.value);
    expect(t.log).not.toContain('connect telegram');
    expect(await t.keys.has('openrouter')).toBe(false);
  });
});
