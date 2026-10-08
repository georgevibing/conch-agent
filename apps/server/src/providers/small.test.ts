import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationEvent, UsageWindow } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoryExplainer } from '../conversations/stories/explain';
import { CodexEngine } from '../engines/codex/app-engine';
import type { Engine, EngineUsage } from '../engines/types';
import { LearningSpend } from '../learning/spend';
import { deviceSealer, registerSealer, unregisterSealer } from '../lib/sealed';
import { cheapModel } from '../memory/learning';
import { SettingsStore } from '../settings/store';
import { fakeCodexApp } from '../test/fakeCodexApp';
import { ProviderKeys } from './keys';
import {
  NOT_ASKED_WORDS,
  notAskedWords,
  pickSmallModel,
  smallAllow,
  smallModelOrder,
  type Allowed,
} from './small';

const windowAt = (usedPercent: number): UsageWindow => ({
  id: 'session',
  label: 'Current session',
  usedPercent,
  severity: usedPercent >= 80 ? 'warning' : 'normal',
});

/** A provider on a plan (`usedPercent` of it gone), or one that costs money, or one on this computer. */
function engine(
  id: string,
  options: {
    label?: string;
    plan?: number;
    local?: boolean;
    complete?: boolean;
    models?: string[];
  } = {},
): Engine {
  const plan = options.plan;
  return {
    id,
    label: options.label ?? id,
    integrations: { mode: 'bridge' },
    ...(options.local && { local: true }),
    detect: async () => ({
      engine: id,
      label: id,
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: 0,
      auth: {
        method: plan === undefined ? 'api-key' : 'subscription',
        description: plan === undefined ? 'Key' : `${options.label ?? id} plan`,
      },
    }),
    capabilities: async () => ({
      models: (options.models ?? []).map((m) => ({ id: m, label: m })),
      slashCommands: [],
      permissionModes: [],
    }),
    runTurn: async function* () {},
    ...(plan !== undefined && {
      usage: async (): Promise<EngineUsage> => ({
        kind: 'plan',
        source: options.label ?? id,
        windows: [windowAt(plan)],
      }),
    }),
    ...(options.complete !== false && {
      complete: vi.fn(async () => ({ text: `${id} says so.` })),
    }),
  } as unknown as Engine;
}

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) unregisterSealer(home);
});

async function spend() {
  return new LearningSpend({ home: await mkdtemp(join(tmpdir(), 'conch-small-')) });
}

const allowAll = async (): Promise<Allowed> => ({ ok: true });

describe('the cheap model for a chat’s small jobs', () => {
  const claude = engine('claude-code', { label: 'Claude Code', plan: 96 });
  const openai = engine('openai', { label: 'OpenAI' });
  const ollama = engine('ollama', { local: true });
  const copilot = engine('copilot', { complete: false });

  it('tries the chat’s own provider, then another connected one, then this computer', () => {
    const codex = engine('codex-cli');
    expect(
      smallModelOrder(codex, [claude, ollama, codex, openai], { private: false }).map((e) => e.id),
    ).toEqual(['codex-cli', 'claude-code', 'openai', 'ollama']);
  });

  it('keeps a private chat to its own provider or this computer', () => {
    const codex = engine('codex-cli');
    expect(
      smallModelOrder(codex, [claude, ollama, codex, openai], { private: true }).map((e) => e.id),
    ).toEqual(['codex-cli', 'ollama']);
    expect(smallModelOrder(copilot, [claude, copilot], { private: true })).toEqual([]);
  });

  it('passes over a provider that can’t answer one prompt', () => {
    expect(smallModelOrder(copilot, [copilot, claude], { private: false })).toEqual([claude]);
  });

  it('moves on from a plan that’s nearly used up to one with room, never refusing for it', async () => {
    const codex = engine('codex-cli', {
      label: 'Codex',
      plan: 5,
      models: ['gpt-6.1-sol', 'gpt-6.1-sol-mini'],
    });
    // A chat on Claude Code, whose plan is nearly gone: Codex answers.
    const picked = await pickSmallModel(
      smallModelOrder(claude, [claude, codex], { private: false }),
      {
        cheap: cheapModel,
        allow: smallAllow({ spend: await spend(), month: async () => ({ usd: 0 }) }),
      },
    );
    expect(picked).toMatchObject({ small: { engine: codex, model: 'gpt-6.1-sol-mini' } });
  });

  it('says why only when every one is out, naming the plans', async () => {
    const codex = engine('codex-cli', { label: 'Codex', plan: 99 });
    const picked = await pickSmallModel(
      smallModelOrder(codex, [claude, codex], { private: false }),
      {
        cheap: cheapModel,
        allow: smallAllow({ spend: await spend(), month: async () => ({ usd: 0 }) }),
      },
    );
    expect(picked).toEqual({ not: 'plan-room', plans: ['Codex', 'Claude Code'] });
    expect('not' in picked && notAskedWords(picked.not, picked.plans)).toBe(
      'Your Codex and Claude Code plans are nearly used up, so Conch is saving them for your chats.',
    );
    expect(notAskedWords('plan-room', ['Claude Code'])).toBe(
      'Your Claude Code plan is nearly used up, so Conch is saving it for your chats.',
    );
    expect(await pickSmallModel([], { cheap: cheapModel, allow: allowAll })).toEqual({
      not: 'none',
    });
  });

  it('keeps money within the month’s budget, but a plan or this computer still answers', async () => {
    const allow = smallAllow({
      spend: await spend(),
      month: async () => ({ usd: 12, budgetUsd: 10 }),
    });
    expect(await allow(openai)).toEqual({ ok: false, reason: 'budget' });
    expect(await allow(ollama)).toEqual({ ok: true });
    expect(await allow(engine('codex-cli', { plan: 10 }))).toEqual({ ok: true });
    const picked = await pickSmallModel(
      smallModelOrder(openai, [openai, ollama], { private: false }),
      {
        cheap: cheapModel,
        allow,
      },
    );
    expect(picked).toMatchObject({ small: { engine: ollama } });
  });

  it('keeps a title to plan room and the budget, not learning’s cap', async () => {
    const capped = await spend();
    await capped.setLimit(0.01);
    await capped.record({ inputTokens: 1_000_000, outputTokens: 0 }, openai, 'gpt-4o');
    const month = async () => ({ usd: 0 });
    expect(await smallAllow({ spend: capped, month })(openai)).toEqual({
      ok: false,
      reason: 'cap',
    });
    expect(await smallAllow({ spend: capped, month }, 'plan')(openai)).toEqual({ ok: true });
    expect(await smallAllow({ spend: capped, month }, 'plan')(claude)).toEqual({
      ok: false,
      reason: 'plan-room',
    });
  });
});

describe('“Why?” on a Codex chat while Claude Code’s plan is nearly used up', () => {
  let seq = 0;
  const ev = (event: Record<string, unknown>) =>
    ({ conversationId: 'c1', seq: seq++, at: seq, ...event }) as ConversationEvent;
  const LOG: ConversationEvent[] = [
    ev({ type: 'user.message', messageId: 'u1', text: 'What did I eat today?' }),
    ev({ type: 'tool.started', toolUseId: 't1', name: 'yazio_read_diary', input: {} }),
    ev({ type: 'tool.finished', toolUseId: 't1', status: 'success', output: 'Oats, 320 kcal' }),
  ];

  it('answers with Codex’s cheap model, not “saving your plan”', async () => {
    const fake = await fakeCodexApp({
      signedIn: true,
      usedPercent: 5,
      models: ['gpt-6.1-sol', 'gpt-6.1-sol-mini'],
    });
    const home = await mkdtemp(join(tmpdir(), 'conch-small-codex-'));
    homes.push(home);
    registerSealer(
      home,
      deviceSealer(async () => Buffer.alloc(32, 1)),
    );
    const settings = new SettingsStore(home);
    const codex = new CodexEngine(settings, new ProviderKeys(settings), fake.bin);
    // Conch's default provider, with 4% of its plan left.
    const claude = engine('claude-code', { label: 'Claude Code', plan: 96, models: ['haiku'] });
    const learning = await spend();
    const spent = vi.fn();
    const why = new StoryExplainer({
      events: async () => LOG,
      pick: async () =>
        pickSmallModel(smallModelOrder(codex, [claude, codex], { private: false }), {
          cheap: cheapModel,
          allow: smallAllow({ spend: learning, month: async () => ({ usd: 0 }) }),
        }),
      spent,
    });
    const result = await why.explain('c1', 't1');
    expect(result.unavailable).toBeUndefined();
    expect(result.unavailable).not.toBe(NOT_ASKED_WORDS['plan-room']);
    expect(result.answer).toBeTruthy();
    expect(claude.complete).not.toHaveBeenCalled();
    const calls = await fake.calls();
    expect(calls.find((c) => c.method === 'thread/start')?.params).toMatchObject({
      model: 'gpt-6.1-sol-mini',
      ephemeral: true,
    });
  });
});
