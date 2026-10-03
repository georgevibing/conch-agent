import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EngineStatus, RoutineRun, RoutineSpending, UsageWindow } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Engine, EngineUsage } from '../engines/types';
import { costAt, priceOf, TYPICAL_RUN } from '../usage/prices';
import {
  DEFAULT_MONTHLY_USD,
  mergeRoutineSpend,
  money,
  PLAN_ROOM_PERCENT,
  RoutineSpend,
  RUN_LIMIT_FALLBACK_USD,
  RUN_LIMIT_TOKENS,
} from './spend';

const DAY = 86_400_000;
/** Mid-month, local time, so a few days either way stay in October. */
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

function windowAt(usedPercent: number, resetsAt = OCT_10 + 3_600_000): UsageWindow {
  return { id: 'session', label: 'Current session', usedPercent, resetsAt, severity: 'normal' };
}

async function setup(target: Engine, now = { at: OCT_10 }) {
  const home = await mkdtemp(join(tmpdir(), 'conch-spend-'));
  const changed: RoutineSpending[] = [];
  const paused = vi.fn();
  const spend = new RoutineSpend({
    home,
    engine: () => target,
    now: () => now.at,
    changed: (s) => changed.push(s),
    paused,
  });
  return { spend, home, changed, paused, now };
}

const run = (fields: Partial<RoutineRun>): RoutineRun => ({
  id: `run_${Math.random()}`,
  routineId: 'r_1',
  trigger: 'schedule',
  status: 'succeeded',
  startedAt: OCT_10,
  ...fields,
});

const daily = {
  schedule: { type: 'daily' as const, time: '08:00' },
  timezone: 'UTC',
  options: { model: 'claude-sonnet-5-5' },
};

describe('prices', () => {
  it('knows the list price of a model whatever its prefix, and nothing it doesn’t know', () => {
    expect(priceOf('claude-opus-5-5')).toMatchObject({ input: 4, output: 20 });
    expect(priceOf('us.anthropic.claude-sonnet-4-6')).toMatchObject({ input: 3, output: 15 });
    expect(priceOf('anthropic/claude-haiku-4-5')).toMatchObject({ input: 1 });
    expect(priceOf('gpt-5-mini')).toMatchObject({ input: 0.25 });
    expect(priceOf('qwen/qwen3.8-omni-flash')).toBeUndefined();
    expect(priceOf(undefined)).toBeUndefined();
  });

  it('bills cached input at the cached price', () => {
    const price = { input: 2, output: 10, cachedInput: 0.2 };
    const fresh = costAt(price, { inputTokens: 1_000_000, outputTokens: 0 });
    const cached = costAt(price, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    });
    expect(fresh).toBeCloseTo(2);
    expect(cached).toBeCloseTo(0.2);
  });
});

describe('RoutineSpend: what a run cost, per kind of provider', () => {
  it('takes the provider’s own figure when it gives one', async () => {
    const { spend } = await setup(engine());
    const cost = await spend.cost(
      { inputTokens: 10, outputTokens: 10, costUsd: 0.42 },
      { engine: engine(), model: 'claude-opus-5-5' },
    );
    expect(cost).toMatchObject({ billing: 'metered', usd: 0.42, priced: 'provider' });
  });

  it('prices tokens at list price when the provider only counts them', async () => {
    const { spend } = await setup(engine());
    const cost = await spend.cost(
      { inputTokens: 290_000, outputTokens: 3_000 },
      { engine: engine(), model: 'claude-sonnet-5-5' },
    );
    expect(cost).toMatchObject({ billing: 'metered', priced: 'list' });
    expect(cost.usd).toBeCloseTo(0.61, 2);
  });

  it('says nothing about money for a model it has no price for', async () => {
    const { spend } = await setup(engine());
    const cost = await spend.cost(
      { inputTokens: 290_000, outputTokens: 3_000 },
      { engine: engine(), model: 'someone/new-model' },
    );
    expect(cost).toEqual({ billing: 'metered', engine: 'anthropic', model: 'someone/new-model' });
  });

  it('measures a plan run as its share of the window', async () => {
    let used = 40;
    const plan = engine({
      auth: 'subscription',
      plan: () => ({ kind: 'plan', source: 'Claude Max', windows: [windowAt(used)] }),
    });
    const { spend } = await setup(plan);
    const allowed = await spend.allow('r_1', plan);
    expect(allowed).toMatchObject({ ok: true, billing: 'plan', before: { usedPercent: 40 } });
    used = 43;
    const cost = await spend.cost(
      { inputTokens: 1000, outputTokens: 100, costUsd: 0.3 },
      { engine: plan },
      allowed.ok ? allowed.before : undefined,
    );
    expect(cost).toMatchObject({ billing: 'plan', planPercent: 3 });
    // A plan's notional cost never counts against the month.
    await spend.count('r_1', cost);
    expect((await spend.state()).monthUsd).toBe(0);
  });

  it('knows a plan from the sign-in when the engine can’t read its limits', async () => {
    const { spend } = await setup(engine());
    const codex = engine({ id: 'codex-cli', label: 'Codex', auth: 'subscription' });
    expect(await spend.billing(codex)).toMatchObject({ billing: 'plan', source: 'Claude Max' });
  });

  it('a model on this computer is free, and is never limited', async () => {
    const local = engine({ id: 'ollama', label: 'Ollama', local: true } as Partial<Engine>);
    const { spend } = await setup(local);
    expect(await spend.cost({ inputTokens: 9e6, outputTokens: 9e6 }, { engine: local })).toEqual({
      billing: 'free',
      engine: 'ollama',
    });
    expect(await spend.view(daily, [])).toEqual({ billing: 'free', text: 'Free on this computer' });
    const limit = spend.runLimit({}, [], undefined);
    expect(spend.over(limit, 'free', { inputTokens: 9e9, outputTokens: 0 }, undefined)).toBe(
      undefined,
    );
  });
});

describe('RoutineSpend: what a routine will cost', () => {
  it('projects a month from its schedule and its recent runs', async () => {
    const { spend } = await setup(engine());
    const runs = [0.4, 0.5, 0.45].map((usd) =>
      run({ cost: { billing: 'metered', usd, model: 'claude-sonnet-5-5' } }),
    );
    const view = await spend.view(daily, runs);
    expect(view).toMatchObject({ billing: 'metered', basis: 'runs' });
    expect(view.monthlyUsd).toBeCloseTo(0.45 * 30.4, 1);
    expect(view.text).toBe('About $14 a month');
  });

  it('estimates roughly before the first run, from a typical run on its model', async () => {
    const { spend } = await setup(engine());
    const view = await spend.view(daily, []);
    expect(view.basis).toBe('estimate');
    expect(view.text).toMatch(/^Roughly \$\d+ a month$/);
  });

  it('says nothing when it can’t say honestly', async () => {
    const { spend } = await setup(engine());
    const view = await spend.view({ ...daily, options: { model: 'someone/new-model' } }, []);
    expect(view.text).toBeUndefined();
  });

  it('says what a one-off run costs, not a month', async () => {
    const { spend } = await setup(engine());
    const view = await spend.view(
      { ...daily, schedule: { type: 'once', at: '2026-10-11T08:00' } },
      [run({ cost: { billing: 'metered', usd: 0.4, model: 'claude-sonnet-5-5' } })],
    );
    expect(view.text).toBe('About $0.40');
    expect(view.monthlyUsd).toBeUndefined();
  });

  it('says what a plan run takes of the plan', async () => {
    const plan = engine({
      auth: 'subscription',
      plan: () => ({ kind: 'plan', source: 'Claude Max', windows: [windowAt(10)] }),
    });
    const { spend } = await setup(plan);
    expect((await spend.view(daily, [])).text).toBe('Runs on your Claude Max plan');
    const runs = [3, 4, 5].map((planPercent) => run({ cost: { billing: 'plan', planPercent } }));
    expect((await spend.view(daily, runs)).text).toBe(
      'Uses about 4% of your Claude Max limit each run',
    );
    const tiny = [run({ cost: { billing: 'plan', planPercent: 0.3 } })];
    expect((await spend.view(daily, tiny)).text).toBe('Uses a little of your Claude Max plan');
  });

  it('writes money plainly', () => {
    expect(money(0.001)).toBe('less than a cent');
    expect(money(0.42)).toBe('$0.42');
    expect(money(37.4)).toBe('$37');
  });
});

describe('RoutineSpend: one run’s limit', () => {
  it('is three times the routine’s usual run, never under a dollar', async () => {
    const { spend } = await setup(engine());
    const runs = [0.9, 1.1, 1.0].map((usd) =>
      run({ cost: { billing: 'metered', usd, model: 'claude-sonnet-5-5' } }),
    );
    expect(spend.runLimit({}, runs, 'claude-sonnet-5-5').usd).toBeCloseTo(3);
    const cheap = [0.01, 0.02].map((usd) =>
      run({ cost: { billing: 'metered', usd, model: 'claude-sonnet-5-5' } }),
    );
    expect(spend.runLimit({}, cheap, 'claude-sonnet-5-5').usd).toBe(1);
  });

  it('before a history, is three times a typical briefing on its model', async () => {
    const { spend } = await setup(engine());
    const typical = costAt(priceOf('claude-opus-5-5') ?? { input: 0, output: 0 }, TYPICAL_RUN);
    expect(spend.runLimit({}, [], 'claude-opus-5-5').usd).toBeCloseTo(3 * typical, 2);
    expect(spend.runLimit({}, [], 'someone/new-model')).toMatchObject({
      usd: RUN_LIMIT_FALLBACK_USD,
      tokens: RUN_LIMIT_TOKENS,
    });
  });

  it('is the person’s own number when they let it use more', async () => {
    const { spend } = await setup(engine());
    expect(spend.runLimit({ runLimitUsd: 12 }, [], 'claude-opus-5-5')).toEqual({
      usd: 12,
      custom: true,
    });
  });

  it('a run that cut short doesn’t teach it what’s usual', async () => {
    const { spend } = await setup(engine());
    const runs = [
      run({ guard: 'run', status: 'needs-you', cost: { billing: 'metered', usd: 50 } }),
      run({ cost: { billing: 'metered', usd: 0.5 } }),
      run({ cost: { billing: 'metered', usd: 0.5 } }),
    ];
    expect(spend.runLimit({}, runs, undefined).usd).toBe(1.5);
  });

  it('says why to stop once a run is past it, in money or in tokens', async () => {
    const { spend } = await setup(engine());
    const limit = { usd: 2, tokens: 500_000, custom: false };
    expect(
      spend.over(limit, 'metered', { inputTokens: 1, outputTokens: 1, costUsd: 1.9 }, undefined),
    ).toBe(undefined);
    expect(
      spend.over(limit, 'metered', { inputTokens: 1, outputTokens: 1, costUsd: 2.1 }, undefined),
    ).toMatch(
      /stopped at its spending limit: it had used about \$2\.10, and a run may use \$2\.00/,
    );
    expect(
      spend.over(limit, 'plan', { inputTokens: 1, outputTokens: 1, costUsd: 2.1 }, undefined),
    ).toMatch(/far more than usual/);
    expect(
      spend.over(limit, 'plan', { inputTokens: 600_000, outputTokens: 0 }, 'unknown-model'),
    ).toMatch(/600 thousand tokens/);
  });
});

describe('RoutineSpend: the month', () => {
  it('pauses money-spending runs at the limit, says so once, and goes on next month', async () => {
    const api = engine();
    const { spend, paused, now } = await setup(api);
    expect(await spend.state()).toMatchObject({
      limitUsd: DEFAULT_MONTHLY_USD,
      isDefault: true,
      monthUsd: 0,
    });
    await spend.record('r_1', { inputTokens: 0, outputTokens: 0, costUsd: 15 }, { engine: api });
    expect(await spend.allow('r_1', api)).toMatchObject({ ok: true });
    await spend.record('r_1', { inputTokens: 0, outputTokens: 0, costUsd: 6 }, { engine: api });
    const held = await spend.allow('r_1', api);
    expect(held).toMatchObject({ ok: false, guard: 'month' });
    expect(held.ok ? '' : held.message).toBe(
      'Paused: your routines have used $21.00 of this month’s $20, so this waits until November 1.',
    );
    // A check before a run that still slips through is counted, but not said twice.
    await spend.record('r_2', { inputTokens: 0, outputTokens: 0, costUsd: 1 }, { engine: api });
    expect(paused).toHaveBeenCalledTimes(1);
    expect((await spend.state()).paused).toMatchObject({ dismissed: false });

    // A plan or this computer is never paused for money.
    const local = engine({ local: true } as Partial<Engine>);
    expect(await spend.allow('r_1', local)).toMatchObject({ ok: true });

    now.at = new Date(2026, 10, 1, 0, 1).getTime();
    expect(await spend.allow('r_1', api)).toMatchObject({ ok: true });
    expect((await spend.state()).monthUsd).toBe(0);
  });

  it('a person raising the limit lets runs go again; keeping it paused hides the card', async () => {
    const api = engine();
    const { spend } = await setup(api);
    await spend.record('r_1', { inputTokens: 0, outputTokens: 0, costUsd: 25 }, { engine: api });
    expect((await spend.keepPaused()).paused).toMatchObject({ dismissed: true });
    expect(await spend.setLimit(40)).toMatchObject({ limitUsd: 40, isDefault: false });
    expect(await spend.allow('r_1', api)).toMatchObject({ ok: true });
    expect((await spend.setLimit(null)).limitUsd).toBeNull();
    await spend.record('r_1', { inputTokens: 0, outputTokens: 0, costUsd: 500 }, { engine: api });
    expect(await spend.allow('r_1', api)).toMatchObject({ ok: true });
  });

  it('keeps counting across a restart', async () => {
    const api = engine();
    const { spend, home } = await setup(api);
    await spend.record('r_1', { inputTokens: 0, outputTokens: 0, costUsd: 3 }, { engine: api });
    const again = new RoutineSpend({ home, engine: () => api, now: () => OCT_10 + DAY });
    expect((await again.state()).monthUsd).toBe(3);
  });

  it('a restore keeps the money already spent, and the backup’s limit', async () => {
    const merged = mergeRoutineSpend(
      Buffer.from(JSON.stringify({ version: 1, months: { '2026-10': 12 }, told: '2026-10' })),
      Buffer.from(
        JSON.stringify({ version: 1, limit: 30, months: { '2026-10': 4, '2026-09': 9 } }),
      ),
    );
    expect(merged).toEqual({
      version: 1,
      limit: 30,
      months: { '2026-10': 12, '2026-09': 9 },
      told: '2026-10',
    });
  });

  it('starts the count again from a ledger that won’t read, and says so', async () => {
    const api = engine();
    const home = await mkdtemp(join(tmpdir(), 'conch-spend-'));
    await writeFile(join(home, 'routine-spend.json'), '{ not json');
    const heal = vi.fn();
    const spend = new RoutineSpend({ home, engine: () => api, now: () => OCT_10, heal });
    expect((await spend.state()).monthUsd).toBe(0);
    expect(heal).toHaveBeenCalledWith('routines', expect.stringMatching(/started the count again/));
    await spend.record('r_1', { inputTokens: 0, outputTokens: 0, costUsd: 1 }, { engine: api });
    expect(JSON.parse(await readFile(join(home, 'routine-spend.json'), 'utf8'))).toMatchObject({
      months: { '2026-10': 1 },
    });
  });
});

describe('RoutineSpend: room on a plan', () => {
  it('leaves the last part of a window to the person, and says when it goes', async () => {
    let used = PLAN_ROOM_PERCENT + 5;
    const plan = engine({
      auth: 'subscription',
      plan: () => ({ kind: 'plan', source: 'Claude Max', windows: [windowAt(used)] }),
    });
    const { spend } = await setup(plan);
    const held = await spend.allow('r_1', plan);
    expect(held).toMatchObject({ ok: false, guard: 'plan-room', until: OCT_10 + 3_600_000 });
    expect(held.ok ? '' : held.message).toMatch(
      /^Waited so your own chats have room: your Claude Max plan is 85% used\. It runs when it resets at /,
    );
    used = 30;
    expect(await spend.allow('r_1', plan)).toMatchObject({ ok: true });
  });
});
