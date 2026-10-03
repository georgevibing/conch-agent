/** Routines and what they spend, end to end on the mock engine (ADR 0057). */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RoutineRun } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { loadConfig } from '../config';
import type { EngineUsage } from '../engines/types';
import { Services } from '../services';

const HOUR = 3_600_000;
let services: Services | undefined;

async function setup(usage?: 'metered' | 'exhausted') {
  process.env.CONCH_MOCK_SPEED = '0.02';
  if (usage) process.env.CONCH_MOCK_USAGE = usage;
  const home = await mkdtemp(join(tmpdir(), 'conch-spending-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_USAGE;
  return services;
}

async function settled(s: Services, routineId: string): Promise<RoutineRun> {
  for (let i = 0; i < 300; i++) {
    const [run] = (await s.routines.detail(routineId)).runs;
    if (run && !['running'].includes(run.status) && run.finishedAt) return run;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`never finished: ${JSON.stringify((await s.routines.detail(routineId)).runs)}`);
}

/** Wait until a routine has `count` runs (a scheduled run starts without being awaited). */
async function runs(s: Services, routineId: string, count: number): Promise<RoutineRun[]> {
  for (let i = 0; i < 300; i++) {
    const all = (await s.routines.detail(routineId)).runs;
    if (all.length >= count) return all;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`only ${(await s.routines.detail(routineId)).runs.length} runs`);
}

const base = {
  title: 'Morning briefing',
  summary: 'Today at a glance.',
  prompt: 'Summarise my day.',
  timezone: 'Europe/Berlin',
  schedule: { type: 'interval' as const, every: 1, unit: 'hours' as const },
};

afterEach(() => services?.routines.stop());

describe('routines and spending', () => {
  it('records what each run cost, and what the routine will cost a month', async () => {
    const s = await setup('metered');
    const r = await s.routines.create(base, { createdBy: 'user' });
    await s.routines.runNow(r.id);
    const run = await settled(s, r.id);
    expect(run.cost).toMatchObject({ billing: 'metered', usd: 0.002, priced: 'provider' });
    const { routine } = await s.routines.detail(r.id);
    expect(routine.spend).toMatchObject({ billing: 'metered', basis: 'runs' });
    // Hourly at $0.002 a run: about $1.46 a month.
    expect(routine.spend?.text).toBe('About $1.46 a month');
    expect((await s.routines.spending())?.monthUsd).toBe(0);
  });

  it('on a plan, records its share of the window instead of money', async () => {
    const s = await setup();
    const r = await s.routines.create(base, { createdBy: 'user' });
    await s.routines.runNow(r.id);
    const run = await settled(s, r.id);
    expect(run.cost).toMatchObject({ billing: 'plan', planPercent: 4 });
    expect((await s.routines.detail(r.id)).routine.spend?.text).toBe(
      'About 4% of your Claude Max limit a run',
    );
  });

  it('stops a run that goes past its limit, cleanly, and asks for a look', async () => {
    const s = await setup('metered');
    const r = await s.routines.create(
      { ...base, prompt: 'Find everything about this. Keep digging until there is nothing left.' },
      { createdBy: 'user' },
    );
    await s.routines.runNow(r.id);
    const run = await settled(s, r.id);
    expect(run).toMatchObject({
      status: 'needs-you',
      guard: 'run',
      outcome: expect.stringMatching(
        /^This run stopped at its spending limit: it had used about \$3\.\d0, and a run may use \$3\.00\.$/,
      ),
    });
    // It stopped within a step of the limit, not at the end of the loop ($24).
    expect(run.cost?.usd).toBeLessThan(4);
    const chat = await s.conversations.detail(run.conversationId ?? '');
    expect(chat.events.find((e) => e.type === 'turn.completed')).toMatchObject({
      outcome: 'interrupted',
    });
    // “Let it use more”: a person's choice, and the next run may.
    const more = await s.routines.update(r.id, { runLimitUsd: 30 });
    expect(more.spend?.runLimit).toEqual({ usd: 30, custom: true });
    expect((await s.routines.update(r.id, { runLimitUsd: null })).runLimitUsd).toBeUndefined();
  });

  it('pauses at the monthly limit, says so once, and runs again when it’s raised', async () => {
    const s = await setup('metered');
    const told = vi.spyOn(s.push, 'routinesPaused');
    await s.routineSpend.setLimit(0.003);
    const r = await s.routines.create(base, { createdBy: 'user' });
    await s.routines.runNow(r.id);
    await settled(s, r.id);
    await s.routines.runNow(r.id);
    await settled(s, r.id);
    expect((await s.routines.spending())?.paused).toBeDefined();
    expect(told).toHaveBeenCalledTimes(1);

    const realNow = Date.now;
    try {
      Date.now = () => realNow() + HOUR + 1000;
      await s.routines.checkNow();
      const [held] = await runs(s, r.id, 3);
      expect(held).toMatchObject({
        status: 'skipped',
        guard: 'month',
        outcome: expect.stringMatching(/^Paused: your routines have used/),
      });
      // Said once, not every hour.
      Date.now = () => realNow() + 2 * HOUR + 1000;
      await s.routines.checkNow();
      await new Promise((r) => setTimeout(r, 200));
      expect((await s.routines.detail(r.id)).runs).toHaveLength(3);
      expect(told).toHaveBeenCalledTimes(1);

      // Repair everything says what only a person can do.
      const report = await s.doctor.run({ repair: false });
      expect(report.items.find((i) => i.id === 'routines:spending')).toMatchObject({
        state: 'needs-you',
        action: { kind: 'open', place: 'usage', focus: 'routines' },
      });

      await s.routineSpend.setLimit(5);
      Date.now = () => realNow() + 3 * HOUR + 1000;
      await s.routines.checkNow();
      await runs(s, r.id, 4);
      expect(await settled(s, r.id)).toMatchObject({ status: 'succeeded', trigger: 'schedule' });
    } finally {
      Date.now = realNow;
    }
  });

  it('waits for room on a plan, then runs once there is', async () => {
    const s = await setup('exhausted');
    const r = await s.routines.create(base, { createdBy: 'user' });
    const engine = s.providers.engineFor(undefined);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + HOUR + 1000;
      await s.routines.checkNow();
      const [held] = await runs(s, r.id, 1);
      expect(held).toMatchObject({
        status: 'skipped',
        guard: 'plan-room',
        outcome: expect.stringMatching(/^Waited so your own chats have room/),
      });
      expect(s.routines.waitingForRoom()).toEqual([r.id]);

      // The window resets: there's room again.
      const roomy: EngineUsage = {
        kind: 'plan',
        source: 'Claude Max',
        windows: [
          {
            id: 'session',
            label: 'Current session',
            usedPercent: 10,
            resetsAt: realNow() + 5 * HOUR,
            severity: 'normal',
          },
        ],
      };
      vi.spyOn(engine, 'usage').mockResolvedValue(roomy);
      Date.now = () => realNow() + HOUR + 0.7 * HOUR;
      await s.routines.checkNow();
      await runs(s, r.id, 2);
      expect(await settled(s, r.id)).toMatchObject({ trigger: 'catch-up', status: 'succeeded' });
      expect(s.routines.waitingForRoom()).toEqual([]);
    } finally {
      Date.now = realNow;
    }
  });

  it('never lets the agent change what routines may spend', async () => {
    const s = await setup('metered');
    const tools = s.routines.tools({ conversationId: 'c_test', append: () => undefined });
    expect(tools.map((t) => t.name)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/spend|limit|budget/)]),
    );
    const update = tools.find((t) => t.name === 'update_routine');
    const create = tools.find((t) => t.name === 'create_routine');
    if (!update || !create) throw new Error('tools');
    // The schema doesn't offer it…
    expect(Object.keys(update.input)).not.toContain('runLimitUsd');
    expect(Object.keys(create.input)).not.toContain('runLimitUsd');
    // …and a call that slips it in anyway changes nothing.
    await create.run({ ...base, runLimitUsd: 500 } as never);
    const [draft] = await s.routines.list();
    expect(draft?.runLimitUsd).toBeUndefined();
    await update.run({ id: draft?.id ?? '', title: 'Briefing', runLimitUsd: 500 } as never);
    expect((await s.routines.list())[0]).toMatchObject({ title: 'Briefing' });
    expect((await s.routines.list())[0]?.runLimitUsd).toBeUndefined();
    expect(z.object(update.input).strict().safeParse({ id: 'x', runLimitUsd: 5 }).success).toBe(
      false,
    );
  });

  it('lets the agent pick the provider’s small model for a simple job, never a bigger one', async () => {
    const s = await setup();
    const tools = s.routines.tools({ conversationId: 'c_test', append: () => undefined });
    await tools
      .find((t) => t.name === 'create_routine')
      ?.run({ ...base, title: 'Water the plants', light: true } as never);
    const [routine] = await s.routines.list();
    expect(routine?.options).toEqual({ engine: 'mock', model: 'haiku' });
  });
});
