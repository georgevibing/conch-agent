import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEvent, EngineStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { ConversationManager } from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { SkillService } from './service';
import { SkillStore } from './store';
import { SHELF_DAYS, SkillUsage, skillUsedIn, stale } from './usage';

const DAY = 86_400_000;

describe('the tidy shelf', () => {
  const skill = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    title: id,
    mode: 'auto' as const,
    source: 'conch' as const,
    ...extra,
  });
  const empty = { used: {}, from: {}, kept: {} };
  const now = 1_000 * DAY;

  it('offers only what Conch put there, on and unused for two months', () => {
    const file = {
      ...empty,
      from: {
        learned: { origin: 'learned' as const, at: now - 90 * DAY },
        imported: { origin: 'imported' as const, at: now - 90 * DAY },
        fresh: { origin: 'suggested' as const, at: now - 10 * DAY },
        usedLately: { origin: 'suggested' as const, at: now - 90 * DAY },
        off: { origin: 'learned' as const, at: now - 90 * DAY },
        broken: { origin: 'learned' as const, at: now - 90 * DAY },
        elsewhere: { origin: 'learned' as const, at: now - 90 * DAY },
      },
      used: { usedLately: now - 5 * DAY, learned: now - 70 * DAY },
    };
    const found = stale(
      [
        skill('learned'),
        skill('imported', { mode: 'manual' }),
        skill('fresh'),
        skill('usedLately'),
        skill('off', { mode: 'off' }),
        skill('broken', { problem: 'No description.' }),
        skill('elsewhere', { source: 'claude' }),
        // Yours: written by you, never offered, however long it sits.
        skill('yours'),
      ],
      file,
      now,
    );
    expect(found).toEqual([
      { id: 'imported', name: 'imported', title: 'imported', idleSince: now - 90 * DAY },
      {
        id: 'learned',
        name: 'learned',
        title: 'learned',
        lastUsedAt: now - 70 * DAY,
        idleSince: now - 70 * DAY,
      },
    ]);
  });

  it('Keep restarts the clock', () => {
    const file = { ...empty, from: { a: { origin: 'imported' as const, at: now - 400 * DAY } } };
    expect(stale([skill('a')], file, now)).toHaveLength(1);
    expect(stale([skill('a')], { ...file, kept: { a: now - 30 * DAY } }, now)).toEqual([]);
    expect(
      stale([skill('a')], { ...file, kept: { a: now - 30 * DAY } }, now + 31 * DAY),
    ).toHaveLength(1);
    expect(SHELF_DAYS).toBe(60);
  });

  it('remembers, follows a rename, forgets a removed skill, and survives a damaged file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-usage-'));
    let at = 5 * DAY;
    const usage = new SkillUsage(home, undefined, () => at);
    await usage.note('old-name', 'learned');
    at += DAY;
    await usage.used('old-name');
    await usage.renamed('old-name', 'new-name');
    expect(await usage.read()).toMatchObject({
      used: { 'new-name': 6 * DAY },
      from: { 'new-name': { origin: 'learned', at: 5 * DAY } },
    });
    await usage.forget('new-name');
    expect(await usage.read()).toEqual(empty);
    await writeFile(join(home, 'skill-usage.json'), '{ broken');
    const notes: string[] = [];
    const healing = new SkillUsage(
      home,
      (_area, message) => notes.push(message),
      () => at,
    );
    expect(await healing.read()).toEqual(empty);
    expect(notes).toHaveLength(1);
  });
});

/** A provider whose turns are scripted: it can load a skill itself, like any model. */
class Scripted implements Engine {
  readonly id = 'mock' as const;
  readonly label = 'Scripted';
  readonly integrations = { mode: 'bridge' as const };
  script: ((input: TurnInput) => AsyncGenerator<EngineEvent>)[] = [];

  async detect(): Promise<EngineStatus> {
    return {
      engine: 'mock',
      label: 'Scripted',
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }
  async capabilities(): Promise<Capabilities> {
    return {
      engine: 'mock',
      label: 'Scripted',
      models: [],
      commands: [],
      permissionModes: ['default'],
    };
  }
  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const next = this.script.shift();
    if (next) yield* next(input);
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-usage-paths-'));
  for (const name of ['weekly', 'release-notes']) {
    const dir = join(home, 'skills', name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Does ${name}.\n---\n# ${name}\n\nDo it.\n`,
    );
  }
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'mock', autoTitle: false } });
  let at = 10 * DAY;
  const usage = new SkillUsage(home, undefined, () => at);
  const skills = new SkillService({
    store: new SkillStore(home, []),
    engines: async () => [],
    emit: () => undefined,
    usage,
  });
  const engine = new Scripted();
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
    tools: (ctx) => skills.tools(ctx),
    expand: (text) => skills.expand(text),
    skillPermissions: (id) => skills.permissions(id),
  });
  // As Services wires it.
  manager.events.on((event) => {
    const used = skillUsedIn(event);
    if (used) skills.used(used);
  });
  return {
    home,
    usage,
    skills,
    engine,
    manager,
    later: (days: number) => {
      at += days * DAY;
    },
  };
}

async function settle(manager: ConversationManager, id: string) {
  for (let i = 0; i < 2000; i++) {
    const { events } = await manager.detail(id);
    if (events.some((e: ConversationEvent) => e.type === 'turn.completed')) return events;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

async function eventually<T>(fn: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 400; i++) {
    const value = await fn();
    if (ok(value)) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never happened');
}

describe('every way a skill is used is counted', () => {
  it('typed as /name: the composer, ⌘K and a chat app all send it that way', async () => {
    const t = await setup();
    const convo = await t.manager.send({ clientMessageId: 'u1', text: '/weekly plan Tuesday' });
    await settle(t.manager, convo.id);
    expect(
      (
        await eventually(
          () => t.usage.read(),
          (f) => 'weekly' in f.used,
        )
      ).used.weekly,
    ).toBe(10 * DAY);
  });

  it('picked by the assistant with use_skill', async () => {
    const t = await setup();
    t.engine.script.push(async function* (input) {
      const useSkill = input.tools.find((tool) => tool.name === 'use_skill');
      await useSkill?.run({ name: 'release-notes' });
      yield { type: 'text', messageId: 'm', delta: 'ok' };
    });
    const convo = await t.manager.send({ clientMessageId: 'u1', text: 'Notes for 1.3, please' });
    await settle(t.manager, convo.id);
    await eventually(
      () => t.usage.read(),
      (f) => 'release-notes' in f.used,
    );
  });

  it('a routine’s instruction, and a skill carried into a task’s chat', async () => {
    const t = await setup();
    const run = await t.manager.start({
      title: 'Weekly',
      text: '/weekly',
      origin: { kind: 'routine', routineId: 'r1', runId: 'run1' },
      extras: {},
    });
    await run.result;
    const task = await t.manager.start({
      title: 'Notes',
      text: 'Finish the notes',
      origin: { kind: 'task', taskId: 't1' },
      extras: {
        skills: [
          {
            skillId: 'release-notes',
            name: 'release-notes',
            seq: 0,
            title: 'release-notes',
            permissions: { declared: false, capabilities: ['files', 'web'], words: [] },
            from: 'c0',
          },
        ],
      },
    });
    await task.result;
    const file = await eventually(
      () => t.usage.read(),
      (f) => 'weekly' in f.used && 'release-notes' in f.used,
    );
    expect(Object.keys(file.used).sort()).toEqual(['release-notes', 'weekly']);
  });
});

describe('the shelf, end to end', () => {
  it('offers a skill Conch put here once it’s sat unused, and only your press turns it off', async () => {
    const t = await setup();
    const learned = await t.skills.create({
      instructions: '1. Find the last tag.\n2. List the commits since it.',
      title: 'Release notes',
      description: 'Writes release notes. Use when asked for release notes.',
      mode: 'manual',
      suggestion: 'ws_0123456789abcdef',
    });
    expect(await t.skills.shelf()).toEqual({ stale: [], days: 60 });
    t.later(61);
    const { stale: found } = await t.skills.shelf();
    // The two you wrote yourself (weekly, release-notes) are never offered.
    expect(found.map((s) => s.id)).toEqual([learned.id]);
    // Looking changes nothing.
    await t.skills.shelf();
    expect((await t.skills.detail(learned.id)).mode).toBe('manual');
    // Something that isn't on the shelf is left alone, whatever is sent.
    expect(await t.skills.tidyShelf('off', ['weekly', 'release-notes'])).toBe(0);
    expect((await t.skills.detail('weekly')).mode).toBe('auto');
    expect(await t.skills.tidyShelf('off', [learned.id])).toBe(1);
    expect((await t.skills.detail(learned.id)).mode).toBe('off');
    // Off, it's kept: still there, still backed up, one switch away.
    expect((await t.skills.list()).skills.map((s) => s.id)).toContain(learned.id);
    expect((await t.skills.shelf()).stale).toEqual([]);
  });

  it('Keep puts the question off for another two months; using it does too', async () => {
    const t = await setup();
    const a = await t.skills.create({
      instructions: '1. Do the first thing.\n2. Do the second.',
      title: 'Imported one',
      description: 'Does a thing. Use when asked.',
      mode: 'auto',
      suggestion: 'hs_0123456789abcdef',
    });
    t.later(61);
    expect(await t.skills.tidyShelf('keep', [a.id])).toBe(1);
    expect((await t.skills.shelf()).stale).toEqual([]);
    t.later(61);
    expect((await t.skills.shelf()).stale.map((s) => s.id)).toEqual([a.id]);
    t.skills.used(a.id);
    await eventually(
      () => t.skills.shelf(),
      (s) => s.stale.length === 0,
    );
    expect((await t.usage.read()).from[a.id]).toMatchObject({ origin: 'suggested' });
  });
});
