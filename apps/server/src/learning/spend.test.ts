import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EngineStatus, UsageWindow } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine, EngineUsage } from '../engines/types';
import { DEFAULT_LEARNING_USD, LearningSpend, mergeLearningSpend } from './spend';

const OCT_10 = new Date(2026, 9, 10, 9, 0).getTime();

function engine(
  over: Partial<Engine> & {
    auth?: NonNullable<EngineStatus['auth']>['method'];
    plan?: () => EngineUsage;
  } = {},
): Engine {
  const { auth = 'api-key', plan, ...rest } = over;
  return {
    id: 'anthropic',
    label: 'Anthropic',
    integrations: { mode: 'bridge' },
    detect: async () => ({
      engine: 'anthropic',
      label: 'Anthropic',
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: 0,
      auth: { method: auth, description: auth === 'subscription' ? 'Claude Max · a@b.c' : 'Key' },
    }),
    capabilities: async () => ({ models: [], slashCommands: [], permissionModes: [] }),
    runTurn: async function* () {},
    ...(plan && { usage: async () => plan() }),
    ...rest,
  } as unknown as Engine;
}

const windowAt = (usedPercent: number): UsageWindow => ({
  id: 'session',
  label: 'Current session',
  usedPercent,
  resetsAt: OCT_10 + 3_600_000,
  severity: 'normal',
});

async function setup(now = { at: OCT_10 }) {
  const home = await mkdtemp(join(tmpdir(), 'conch-learning-spend-'));
  const notes: string[] = [];
  const spend = new LearningSpend({
    home,
    now: () => now.at,
    heal: (_area, message) => notes.push(message),
  });
  return { home, spend, notes, now };
}

const cost = (usd: number) => ({ inputTokens: 0, outputTokens: 0, costUsd: usd });

describe('what learning may spend (ADR 0087 § 8)', () => {
  it('a dollar a month until a person says otherwise', async () => {
    const { spend } = await setup();
    expect(await spend.state()).toEqual({
      limitUsd: DEFAULT_LEARNING_USD,
      isDefault: true,
      monthUsd: 0,
    });
  });

  it('counts money; pauses at the cap, says so once, and goes again on the 1st', async () => {
    const api = engine();
    const { spend, notes, now } = await setup();
    expect(await spend.record(cost(0.6), api)).toBe(0.6);
    expect(await spend.allow(api)).toEqual({ ok: true });
    await spend.record(cost(0.5), api);
    await spend.record(cost(0.1), api);
    expect(await spend.allow(api)).toMatchObject({ ok: false, reason: 'cap' });
    expect((await spend.state()).paused).toBeDefined();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/rests until the 1st/);
    now.at = new Date(2026, 10, 1, 0, 1).getTime();
    expect(await spend.allow(api)).toEqual({ ok: true });
  });

  it('a plan and this computer cost nothing here; a nearly used plan is left to your chats', async () => {
    let used = 40;
    const plan = engine({
      auth: 'subscription',
      plan: () => ({ kind: 'plan', source: 'Claude Max', windows: [windowAt(used)] }),
    });
    const local = engine({ id: 'ollama', label: 'Ollama', local: true } as Partial<Engine>);
    const { spend } = await setup();
    expect(await spend.record(cost(5), plan)).toBe(0);
    expect(await spend.record(cost(5), local)).toBe(0);
    expect((await spend.state()).monthUsd).toBe(0);
    expect(await spend.allow(plan)).toEqual({ ok: true });
    used = 85;
    expect(await spend.allow(plan)).toMatchObject({ ok: false, reason: 'plan-room' });
    expect(await spend.allow(local)).toEqual({ ok: true });
  });

  it('a person raising the cap lets it go again; no cap means no pause', async () => {
    const api = engine();
    const { spend } = await setup();
    await spend.record(cost(1.2), api);
    expect(await spend.allow(api)).toMatchObject({ ok: false });
    expect(await spend.setLimit(5)).toMatchObject({ limitUsd: 5, isDefault: false });
    expect(await spend.allow(api)).toEqual({ ok: true });
    await spend.setLimit(null);
    await spend.record(cost(50), api);
    expect(await spend.allow(api)).toEqual({ ok: true });
  });

  it('keeps counting across a restart, and a restore keeps what was spent', async () => {
    const api = engine();
    const { spend, home } = await setup();
    await spend.record(cost(0.3), api);
    expect((await new LearningSpend({ home, now: () => OCT_10 }).state()).monthUsd).toBe(0.3);
    const merged = mergeLearningSpend(
      Buffer.from(JSON.stringify({ version: 1, months: { '2026-10': 0.3 } })),
      Buffer.from(
        JSON.stringify({ version: 1, limit: 3, months: { '2026-10': 0.1, '2026-09': 0.8 } }),
      ),
    );
    expect(merged).toEqual({ version: 1, limit: 3, months: { '2026-10': 0.3, '2026-09': 0.8 } });
    expect(mergeLearningSpend(undefined, Buffer.from('nonsense')).months).toEqual({});
  });

  it('nothing to count is nothing counted', async () => {
    const { spend } = await setup();
    expect(await spend.record(undefined, engine())).toBe(0);
    expect(
      await spend.record({ inputTokens: 10, outputTokens: 10 }, engine(), 'an-unknown-model'),
    ).toBe(0);
  });
});
