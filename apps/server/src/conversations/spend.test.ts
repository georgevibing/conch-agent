import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  Capabilities,
  ConversationEvent,
  EngineId,
  EngineStatus,
  ModelInfo,
  Usage,
} from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine, EngineEvent, EngineUsage, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { Billings, cacheSaving, turnCost } from '../usage/billing';
import { ChatSpendDesk } from '../usage/desk';
import { UsageService } from '../usage/service';
import { ConversationManager, type TurnRoute } from './manager';
import { addTurn, allowance, CARRY_ON, niceUp, overLimit, raiseTo } from './spend';
import { ConversationStore } from './store';

const model = (id: string, label = id): ModelInfo => ({
  id,
  label,
  description: '',
  efforts: [],
  supportsFastMode: false,
  supportsAutoMode: false,
});

/**
 * Answers each turn after reporting what it has used, step by step, as a
 * real tool loop does (a running total, then the end).
 */
class FakeEngine implements Engine {
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  /** Each turn's steps: the running total after each request. */
  steps: Usage[] = [{ inputTokens: 1000, outputTokens: 100, costUsd: 0.01 }];

  constructor(
    readonly id: EngineId,
    readonly label: string,
    readonly models: ModelInfo[],
    private readonly charges: EngineUsage['kind'] | 'local',
  ) {}

  get local() {
    return this.charges === 'local';
  }

  async detect(): Promise<EngineStatus> {
    return {
      engine: this.id,
      label: this.label,
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }

  async usage(): Promise<EngineUsage> {
    if (this.charges === 'plan')
      return {
        kind: 'plan',
        source: 'Claude Max',
        windows: [
          {
            id: 'session',
            label: 'Current session',
            usedPercent: 42,
            severity: 'normal',
          },
        ],
      };
    return { kind: 'metered', source: this.label, windows: [] };
  }

  async capabilities(): Promise<Capabilities> {
    return {
      engine: this.id,
      label: this.label,
      models: this.models,
      commands: [],
      permissionModes: ['default'],
      tools: { host: true, files: true, shell: false, approvals: true },
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    yield { type: 'session', resumeId: `${this.id}-s`, model: input.options.model ?? 'default' };
    let total: Usage = { inputTokens: 0, outputTokens: 0 };
    for (const [i, step] of this.steps.entries()) {
      if (input.signal.aborted) {
        yield { type: 'done', outcome: 'interrupted', usage: total };
        return;
      }
      total = step;
      if (i < this.steps.length - 1) {
        yield { type: 'usage', usage: total };
        await new Promise((r) => setTimeout(r, 1));
      }
    }
    yield { type: 'text', messageId: `m${Math.random()}`, delta: `heard: ${input.prompt}` };
    yield { type: 'done', outcome: 'success', usage: total };
  }
}

async function setup(
  options: {
    local?: boolean;
    plan?: boolean;
    budget?: number;
    tasks?: Record<string, string>;
  } = {},
) {
  const home = await mkdtemp(join(tmpdir(), 'conch-spend-'));
  const api = new FakeEngine(
    'anthropic-api',
    'Anthropic',
    [model('claude-opus-5-5', 'Opus 5.5'), model('claude-haiku-4-5', 'Haiku 4.5')],
    'metered',
  );
  const engines = new Map<EngineId, FakeEngine>([['anthropic-api', api]]);
  if (options.local)
    engines.set(
      'ollama',
      new FakeEngine('ollama', 'Ollama', [model('gemma3', 'Gemma 3')], 'local'),
    );
  if (options.plan)
    engines.set(
      'claude-code',
      new FakeEngine('claude-code', 'Claude Code', [model('opus', 'Opus')], 'plan'),
    );
  const settings = new SettingsStore(home);
  await settings.update({
    preferences: { engine: 'anthropic-api', model: 'claude-opus-5-5', autoTitle: false },
  });
  const engine = (id?: EngineId) => engines.get(id ?? 'anthropic-api') ?? api;
  const usage = new UsageService({ home, engine: () => api });
  if (options.budget) await usage.setBudget(options.budget);
  const desk = new ChatSpendDesk({
    billings: new Billings(),
    usage: () => usage,
    engineFor: (id) => engine(id),
    catalog: async () => ({
      default: 'anthropic-api',
      providers: await Promise.all(
        [...engines.values()].map(async (e) => ({ ...(await e.capabilities()), local: e.local })),
      ),
    }),
    task: async (id) => {
      const parent = options.tasks?.[id];
      return parent ? { parentConversationId: parent } : undefined;
    },
  });
  const store = new ConversationStore(join(home, 'conversations'));
  const make = () =>
    new ConversationManager({
      store,
      settings,
      memory: new MemoryStore(join(home, 'memory')),
      engine,
      route: async (e): Promise<TurnRoute> => ({ kind: 'use', engine: e }),
      spend: desk,
    });
  return { manager: make(), make, api, engines, usage, home };
}

async function idle(manager: ConversationManager, id: string) {
  for (let i = 0; i < 2000; i++) {
    const { conversation } = await manager.detail(id);
    if (conversation.status === 'idle' || conversation.status === 'error') return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

const log = async (manager: ConversationManager, id: string): Promise<ConversationEvent[]> =>
  (await manager.detail(id)).events;

const of = <T extends ConversationEvent['type']>(events: ConversationEvent[], type: T) =>
  events.filter((e): e is Extract<ConversationEvent, { type: T }> => e.type === type);

async function say(manager: ConversationManager, text: string, conversationId?: string) {
  const convo = await manager.send({
    clientMessageId: `u${Math.random()}`,
    text,
    ...(conversationId && { conversationId }),
  });
  await idle(manager, convo.id);
  return convo.id;
}

describe('what a turn costs (ADR 0079)', () => {
  it('says what each reply cost, adds it to the chat and the month, and what the cache saved', async () => {
    const { manager, api, usage } = await setup();
    api.steps = [{ inputTokens: 100_000, cachedInputTokens: 80_000, outputTokens: 1_000 }];
    const id = await say(manager, 'hello');
    const [done] = of(await log(manager, id), 'turn.completed');
    // Priced at list price, since the provider didn't say: 20k fresh at $4, 80k cached at
    // $0.20, 1k out at $20 a million.
    expect(done?.cost).toMatchObject({ billing: 'metered', priced: 'list' });
    expect(done?.cost?.usd).toBeCloseTo(0.08 + 0.016 + 0.02, 6);
    expect(done?.cost?.savedUsd).toBeCloseTo((80_000 * (4 - 0.2)) / 1e6, 6);
    const { conversation } = await manager.detail(id);
    expect(conversation.spend?.usd).toBeCloseTo(0.116, 6);
    expect(conversation.spend?.savedUsd).toBeCloseTo(0.304, 6);
    expect((await usage.month()).usd).toBeCloseTo(0.116, 6);
  });

  it('on a plan, says the plan and its window, and counts no money', async () => {
    const { manager, usage } = await setup({ plan: true });
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'hello',
      options: { engine: 'claude-code' },
    });
    await idle(manager, convo.id);
    const [done] = of(await log(manager, convo.id), 'turn.completed');
    expect(done?.cost).toMatchObject({
      billing: 'plan',
      plan: { source: 'Claude Max', window: { label: 'Current session', usedPercent: 42 } },
    });
    const { conversation } = await manager.detail(convo.id);
    expect(conversation.spend).toMatchObject({ usd: 0, planTurns: 1 });
    expect((await usage.month()).usd).toBe(0);
  });

  it('on this computer, says it was free', async () => {
    const { manager } = await setup({ local: true });
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'hello',
      options: { engine: 'ollama' },
    });
    await idle(manager, convo.id);
    const [done] = of(await log(manager, convo.id), 'turn.completed');
    expect(done?.cost).toEqual({ billing: 'free' });
  });
});

describe('a chat’s own limit (ADR 0079)', () => {
  it('holds the next message at the limit, and one tap raises it and sends it', async () => {
    const { manager, api } = await setup();
    const id = await say(manager, 'first');
    await manager.setSpendLimit(id, 0.01);
    await say(manager, 'second', id);
    const events = await log(manager, id);
    const [capped] = of(events, 'turn.capped');
    expect(capped).toMatchObject({ limit: 'chat', spentUsd: 0.01, limitUsd: 0.01, raiseTo: 0.5 });
    expect(api.turns).toHaveLength(1);
    expect(await manager.settleCapped(id, 'raise')).toBe(true);
    await idle(manager, id);
    expect(api.turns).toHaveLength(2);
    expect(api.turns[1]?.prompt).toContain('second');
    expect((await manager.detail(id)).conversation.spend?.capUsd).toBe(0.5);
    expect(of(await log(manager, id), 'turn.capped.settled')).toMatchObject([
      { outcome: 'raised' },
    ]);
  });

  it('stops a reply that goes past it part way, and carries on from there once raised', async () => {
    const { manager, api } = await setup();
    const id = await say(manager, 'first');
    await manager.setSpendLimit(id, 1);
    // A tool loop: each request costs 40¢ more than the last.
    api.steps = Array.from({ length: 10 }, (_, i) => ({
      inputTokens: 72_000 * (i + 1),
      outputTokens: 400 * (i + 1),
      costUsd: 0.4 * (i + 1),
    }));
    await say(manager, 'keep digging', id);
    const events = await log(manager, id);
    const done = of(events, 'turn.completed').at(-1);
    expect(done?.outcome).toBe('interrupted');
    // Stopped within a step of the limit, not after the whole loop.
    expect(done?.usage?.costUsd).toBeLessThanOrEqual(1.2 + 1e-9);
    expect(of(events, 'turn.capped').at(-1)).toMatchObject({ limit: 'chat', during: true });
    api.steps = [{ inputTokens: 1000, outputTokens: 100, costUsd: 0.01 }];
    await manager.settleCapped(id, 'raise');
    await idle(manager, id);
    expect(api.turns.at(-1)?.prompt).toBe(CARRY_ON);
  });

  it('offers a model on this computer, and switching sends the message with it', async () => {
    const { manager, engines } = await setup({ local: true });
    const id = await say(manager, 'first');
    await manager.setSpendLimit(id, 0.01);
    await say(manager, 'second', id);
    const [capped] = of(await log(manager, id), 'turn.capped');
    expect(capped?.switchTo).toMatchObject({ engine: 'ollama', model: 'gemma3', why: 'local' });
    await manager.settleCapped(id, 'switch');
    await idle(manager, id);
    expect(engines.get('ollama')?.turns[0]?.prompt).toContain('second');
    expect((await manager.detail(id)).conversation.options).toMatchObject({
      engine: 'ollama',
      model: 'gemma3',
    });
  });

  it('offers a cheaper model on the same key, with a little more room', async () => {
    const { manager, api } = await setup();
    const id = await say(manager, 'first');
    await manager.setSpendLimit(id, 0.01);
    await say(manager, 'second', id);
    const [capped] = of(await log(manager, id), 'turn.capped');
    expect(capped?.switchTo).toMatchObject({
      model: 'claude-haiku-4-5',
      why: 'cheaper',
      allowUsd: 0.5,
    });
    await manager.settleCapped(id, 'switch');
    await idle(manager, id);
    expect(api.turns.at(-1)?.options.model).toBe('claude-haiku-4-5');
    expect((await manager.detail(id)).conversation.spend?.capUsd).toBeCloseTo(0.51, 2);
  });

  it('stops when asked: the message stays unanswered, and nothing goes by itself', async () => {
    const { manager, api } = await setup();
    const id = await say(manager, 'first');
    await manager.setSpendLimit(id, 0.01);
    await say(manager, 'second', id);
    await manager.settleCapped(id, 'stop');
    expect(await manager.release(id)).toBe(false);
    expect(await manager.settleCapped(id, 'raise')).toBe(false);
    expect(api.turns).toHaveLength(1);
  });

  it('a new limit that leaves room sends what was waiting', async () => {
    const { manager, api } = await setup();
    const id = await say(manager, 'first');
    await manager.setSpendLimit(id, 0.01);
    await say(manager, 'second', id);
    await manager.setSpendLimit(id, null);
    await idle(manager, id);
    expect(api.turns).toHaveLength(2);
    expect((await manager.detail(id)).conversation.spend?.capUsd).toBeUndefined();
  });

  it('a message waiting at a limit is still there after a restart', async () => {
    const { manager, make, api } = await setup();
    const id = await say(manager, 'first');
    await manager.setSpendLimit(id, 0.01);
    await say(manager, 'second', id);
    const again = make();
    // Back online, it still waits for the person rather than going.
    expect(await again.releaseHeld()).toBe(0);
    expect(await again.release(id)).toBe(false);
    expect(await again.settleCapped(id, 'raise')).toBe(true);
    await idle(again, id);
    expect(api.turns.at(-1)?.prompt).toContain('second');
  });

  it('counts a task’s spending in the chat it came from, and holds it to that chat’s limit', async () => {
    const tasks: Record<string, string> = {};
    const { manager, api } = await setup({ tasks });
    const parent = await say(manager, 'first');
    tasks.t1 = parent;
    api.steps = [{ inputTokens: 1000, outputTokens: 100, costUsd: 0.25 }];
    const started = await manager.start({
      title: 'Task',
      text: 'do it',
      origin: { kind: 'task', taskId: 't1' },
      extras: {},
    });
    await started.result;
    const { conversation } = await manager.detail(parent);
    expect(conversation.spend?.usd).toBeCloseTo(0.26, 6);
    expect(conversation.spend?.tasksUsd).toBeCloseTo(0.25, 6);
    // At the parent's limit, the task stops part way and says why.
    await manager.setSpendLimit(parent, 0.5);
    api.steps = Array.from({ length: 10 }, (_, i) => ({
      inputTokens: 1000,
      outputTokens: 100,
      costUsd: 0.2 * (i + 1),
    }));
    const second = await manager.start({
      title: 'Task',
      text: 'more',
      origin: { kind: 'task', taskId: 't1' },
      extras: {},
    });
    const result = await second.result;
    expect(result.outcome).toBe('interrupted');
    expect(of(await log(manager, second.conversationId), 'spend.notice')).toMatchObject([
      { kind: 'stopped' },
    ]);
    expect(result.error).toBe('Stopped at the spending limit of the chat this came from.');
    // Another one, with the chat already past its limit, doesn't start at all.
    const third = await manager.start({
      title: 'Task',
      text: 'again',
      origin: { kind: 'task', taskId: 't1' },
      extras: {},
    });
    const none = await third.result;
    expect(none.outcome).toBe('interrupted');
    expect(none.usage?.costUsd ?? 0).toBe(0);
    expect(none.error).toBe('Stopped at the spending limit of the chat this came from.');
  });
});

describe('the monthly budget holds chats too (ADR 0079)', () => {
  it('says so once near it, and holds a message at it — but not one on a plan', async () => {
    const { manager, api } = await setup({ budget: 1, plan: true });
    api.steps = [{ inputTokens: 1000, outputTokens: 100, costUsd: 0.5 }];
    const id = await say(manager, 'one');
    api.steps = [{ inputTokens: 1000, outputTokens: 100, costUsd: 0.35 }];
    await say(manager, 'two', id);
    const notices = of(await log(manager, id), 'spend.notice');
    expect(notices).toMatchObject([{ kind: 'budget-near' }]);
    expect(notices[0]?.message).toBe(
      'This month you’ve spent $0.85 of your $1 budget. When it’s used up, a chat asks before spending more.',
    );
    await say(manager, 'three', id);
    // Only once a month.
    expect(of(await log(manager, id), 'spend.notice')).toHaveLength(1);
    await say(manager, 'four', id);
    const capped = of(await log(manager, id), 'turn.capped');
    expect(capped).toMatchObject([{ limit: 'month', limitUsd: 1 }]);
    // A cheaper key would still spend money: only a plan or this computer is offered.
    expect(capped[0]?.switchTo).toMatchObject({ engine: 'claude-code', why: 'plan' });
    // A chat on the plan goes regardless.
    const onPlan = await manager.send({
      clientMessageId: 'p1',
      text: 'plan',
      options: { engine: 'claude-code' },
    });
    await idle(manager, onPlan.id);
    expect(of(await log(manager, onPlan.id), 'turn.capped')).toHaveLength(0);
  });

  it('raising it from the message raises the budget and sends', async () => {
    const { manager, api, usage } = await setup({ budget: 1 });
    api.steps = [{ inputTokens: 1000, outputTokens: 100, costUsd: 1 }];
    const id = await say(manager, 'one');
    await say(manager, 'two', id);
    expect(of(await log(manager, id), 'turn.capped')).toMatchObject([{ raiseTo: 2 }]);
    await manager.settleCapped(id, 'raise');
    await idle(manager, id);
    expect((await usage.month()).budgetUsd).toBe(2);
    expect(api.turns).toHaveLength(2);
  });
});

describe('a pricier model on a long chat (ADR 0079)', () => {
  it('says what a reply will cost, once, when it really matters', async () => {
    const { manager, api } = await setup();
    api.steps = [{ inputTokens: 200_000, outputTokens: 2_000 }];
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'long one',
      options: { model: 'claude-haiku-4-5' },
    });
    await idle(manager, convo.id);
    await manager.configure(convo.id, { model: 'claude-opus-5-5' });
    const notices = of(await log(manager, convo.id), 'spend.notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.message).toBe(
      'With a chat this long, each reply from Opus 5.5 costs about $0.84. The last one cost $0.21.',
    );
    // Back to the cheaper one: nothing to say.
    await manager.configure(convo.id, { model: 'claude-haiku-4-5' });
    expect(of(await log(manager, convo.id), 'spend.notice')).toHaveLength(1);
  });

  it('says nothing on a short chat', async () => {
    const { manager } = await setup();
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'hi',
      options: { model: 'claude-haiku-4-5' },
    });
    await idle(manager, convo.id);
    await manager.configure(convo.id, { model: 'claude-opus-5-5' });
    expect(of(await log(manager, convo.id), 'spend.notice')).toHaveLength(0);
  });
});

describe('the arithmetic of limits', () => {
  it('rounds limits to amounts a person would pick', () => {
    expect([0.1, 0.6, 1, 1.2, 2.2, 3, 7, 12, 30, 260].map(niceUp)).toEqual([
      0.5, 1, 1, 2, 2.5, 5, 10, 20, 50, 500,
    ]);
    expect(raiseTo({ limit: 'chat', spentUsd: 2.1, limitUsd: 2 })).toBe(5);
    expect(raiseTo({ limit: 'month', spentUsd: 50, limitUsd: 50 })).toBe(100);
    expect(allowance(1)).toBe(0.5);
    expect(allowance(10)).toBe(2.5);
  });

  it('meets a limit at it for a new message, and only past it for a reply on its way', () => {
    const spent = { chat: { usd: 1, capUsd: 1 }, month: { usd: 0 } };
    expect(overLimit(spent, 0, false)?.limit).toBe('chat');
    expect(overLimit(spent, 0, true)).toBeUndefined();
    expect(overLimit({ chat: undefined, month: { usd: 9, budgetUsd: 10 } }, 1.5, true)).toEqual({
      limit: 'month',
      spentUsd: 10.5,
      limitUsd: 10,
    });
  });

  it('adds up money, not a plan’s list-price figure', () => {
    let spend = addTurn(undefined, { billing: 'metered', usd: 0.1, savedUsd: 0.02 });
    spend = addTurn(spend, { billing: 'plan', usd: 3 });
    spend = addTurn(spend, { billing: 'metered', usd: 0.05 }, { task: true });
    spend = addTurn(spend, { billing: 'free' });
    expect(spend).toEqual({ usd: 0.15, savedUsd: 0.02, planTurns: 1, tasksUsd: 0.05 });
  });

  it('prices a turn the way its provider charges', () => {
    const usage = { inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 0 };
    expect(cacheSaving(usage, 'claude-sonnet-5')).toBeCloseTo(0.9, 6);
    expect(cacheSaving(usage, 'mystery-model')).toBeUndefined();
    expect(turnCost(usage, {}, 'claude-sonnet-5')).toBeUndefined();
    expect(turnCost({ ...usage, costUsd: 0.7 }, { billing: 'metered' }, 'x')).toMatchObject({
      usd: 0.7,
      priced: 'provider',
    });
    expect(turnCost(usage, { billing: 'metered' }, 'mystery-model')).toEqual({
      billing: 'metered',
    });
  });
});

describe('asking how a provider charges, before every turn', () => {
  it('never waits on a plan’s usage read when the sign-in says it’s a subscription', async () => {
    let reads = 0;
    const engine = {
      id: 'claude-code',
      label: 'Claude Code',
      detect: async () => ({
        state: 'ready',
        auth: { method: 'subscription', description: 'Claude Max · ana@example.com' },
      }),
      usage: async () => {
        reads++;
        return { kind: 'plan', source: 'Claude Max', windows: [] };
      },
    } as unknown as Engine;
    expect(await new Billings().quick(engine)).toEqual({ billing: 'plan', source: 'Claude Max' });
    expect(reads).toBe(0);
  });
});
