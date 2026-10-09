import type { Capabilities, EngineId, EngineStatus, UsageSnapshot } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine } from '../engines/types';
import type { BillingInfo } from './billing';
import {
  fallbackChoices,
  firstWithRoom,
  rankChoices,
  sameAccount,
  type FallbackDeps,
} from './fallback';

const NOW = Date.UTC(2026, 9, 9, 15, 0);

interface Fake {
  id: EngineId;
  label: string;
  shares?: string;
  email?: string;
  billing: 'plan' | 'metered';
  model: string;
  local?: boolean;
  /** Used share of its tightest window, for a plan. */
  used?: number;
  blocked?: number;
  extra?: { used: number; limit: number };
  /** It can't do what the chat needs. */
  cantCarry?: boolean;
}

function engine(f: Fake): Engine {
  const status: EngineStatus = {
    engine: f.id,
    label: f.label,
    state: 'ready',
    install: [],
    canSignIn: false,
    checkedAt: NOW,
    ...(f.email && {
      auth: {
        method: f.billing === 'plan' ? 'subscription' : 'api-key',
        description: `${f.billing === 'plan' ? 'ChatGPT Plus' : 'API key'} · ${f.email}`,
        email: f.email,
      },
    }),
  };
  const caps: Capabilities = {
    engine: f.id,
    label: f.label,
    models: [
      {
        id: f.model,
        label: f.model.toUpperCase(),
        description: '',
        efforts: [],
        supportsFastMode: false,
        supportsAutoMode: false,
      },
    ],
    commands: [],
    permissionModes: ['default'],
  };
  return {
    id: f.id,
    label: f.label,
    ...(f.local && { local: true }),
    ...(f.shares && { sharesAccount: f.shares }),
    integrations: { mode: 'bridge' },
    detect: async () => status,
    capabilities: async () => caps,
    // eslint-disable-next-line require-yield
    runTurn: async function* () {
      return;
    },
  } as Engine;
}

function world(fakes: Fake[], extra: Partial<FallbackDeps> = {}) {
  const engines = fakes.map(engine);
  const by = new Map(fakes.map((f) => [f.id, f]));
  const deps: FallbackDeps = {
    ready: async () => engines,
    snapshot: async (id): Promise<UsageSnapshot | undefined> => {
      const f = by.get(id);
      if (!f) return undefined;
      return {
        engine: id,
        kind: f.billing,
        source: f.label,
        windows:
          f.used !== undefined
            ? [
                {
                  id: 'session',
                  label: 'Current session',
                  usedPercent: f.used,
                  resetsAt: NOW + 3 * 3_600_000,
                  severity: 'normal',
                },
              ]
            : [],
        ...(f.extra && {
          extra: { enabled: true, used: f.extra.used, limit: f.extra.limit, currency: 'USD' },
        }),
        spend: { today: 0, month: 0 },
        ...(f.blocked !== undefined && { blocked: { until: f.blocked } }),
        updatedAt: NOW,
      };
    },
    billing: async (e): Promise<BillingInfo> => ({ billing: by.get(e.id)?.billing ?? 'metered' }),
    month: async () => ({ usd: 3 }),
    refusedUntil: () => undefined,
    carry: async (_from, to) => (by.get(to.id)?.cantCarry ? false : {}),
    now: () => NOW,
    ...extra,
  };
  const of = (id: EngineId) => engines.find((e) => e.id === id) as Engine;
  return { deps, of };
}

const claude: Fake = {
  id: 'claude-code',
  label: 'Claude Code',
  billing: 'plan',
  model: 'claude-opus-5-5',
  email: 'ada@example.com',
  used: 100,
};
const codex: Fake = {
  id: 'codex-cli',
  label: 'Codex',
  shares: 'openai-codex',
  billing: 'plan',
  model: 'gpt-5.5',
  email: 'ada@example.com',
  used: 30,
};
const codexCli: Fake = { ...codex, id: 'codex-agent', label: 'Codex CLI' };
const openrouter: Fake = {
  id: 'openrouter',
  label: 'OpenRouter',
  billing: 'metered',
  model: 'openai/gpt-5-mini',
};
const anthropic: Fake = {
  id: 'anthropic-api',
  label: 'Anthropic API',
  billing: 'metered',
  model: 'claude-sonnet-5',
};
const ollama: Fake = { id: 'ollama', label: 'Ollama', billing: 'plan', model: 'qwen', local: true };

describe('who carries on at a limit (ADR 0126)', () => {
  it('ranks your plans first, then keys from the cheapest reply up', async () => {
    const { deps, of } = world([claude, anthropic, openrouter, codex, ollama]);
    const choices = (await fallbackChoices(of('claude-code'), deps)).map((c) => c.choice);
    expect(choices.map((c) => c.id)).toEqual(['codex-cli', 'openrouter', 'anthropic-api']);
    expect(choices[0]).toMatchObject({
      billing: 'plan',
      room: 'room',
      leftPercent: 70,
      model: { id: 'gpt-5.5', label: 'GPT-5.5' },
    });
    expect(choices[0]?.perReplyUsd).toBeUndefined();
    // Pay per use, priced at list price: a mini model costs less than a Sonnet.
    expect(choices[1]?.perReplyUsd).toBeGreaterThan(0);
    expect(choices[1]?.perReplyUsd).toBeLessThan(choices[2]?.perReplyUsd ?? 0);
    // The model on this computer isn't among them: it's the last resort, apart.
    expect(choices.some((c) => c.id === 'ollama')).toBe(false);
  });

  it('follows your order, and puts what you haven’t ordered after it, ranked', async () => {
    const { deps, of } = world([claude, codex, anthropic, openrouter]);
    const choices = await fallbackChoices(of('claude-code'), deps, ['anthropic-api']);
    expect(choices.map((c) => c.choice.id)).toEqual(['anthropic-api', 'codex-cli', 'openrouter']);
    // A pure ranking, too: a way into a choice that's in your order counts for it.
    expect(
      rankChoices(
        [
          { engines: ['openrouter'], billing: 'metered', perReplyUsd: 0.01 },
          { engines: ['codex-cli', 'codex-agent'], billing: 'plan' },
        ] as const,
        ['codex-agent', 'openrouter'],
      ).map((c) => c.engines[0]),
    ).toEqual(['codex-cli', 'openrouter']);
  });

  it('shows Codex and Codex CLI on one sign-in as one choice', async () => {
    const { deps, of } = world([claude, codex, codexCli]);
    const choices = await fallbackChoices(of('claude-code'), deps);
    expect(choices).toHaveLength(1);
    expect(choices[0]?.choice).toMatchObject({
      name: 'Codex',
      engines: ['codex-cli', 'codex-agent'],
      account: 'ChatGPT Plus · ada@example.com',
    });
  });

  it('names the accounts when two of the same are signed in as different people', async () => {
    const work = { ...codex, email: 'ada@work.example' };
    const home = { ...codexCli, label: 'Codex', email: 'ada@home.example' };
    const { deps, of } = world([claude, work, home]);
    const choices = (await fallbackChoices(of('claude-code'), deps)).map((c) => c.choice);
    expect(choices.map((c) => c.name)).toEqual([
      'Codex · ada@work.example',
      'Codex · ada@home.example',
    ]);
    // Never the same address twice in one line.
    expect(choices[0]?.account).toBe('ChatGPT Plus');
  });

  it('never offers another way into the account that’s at its limit', async () => {
    const { deps, of } = world([codex, codexCli, openrouter]);
    const choices = await fallbackChoices(of('codex-cli'), deps);
    expect(choices.map((c) => c.choice.id)).toEqual(['openrouter']);
    expect(sameAccount(of('codex-cli'), undefined, of('codex-agent'), undefined)).toBe(true);
    expect(sameAccount(of('codex-cli'), undefined, of('openrouter'), undefined)).toBe(false);
  });

  it('passes over one at its own limit, past its key’s limit, or past the month’s budget', async () => {
    const full = { ...codex, used: 100 };
    const capped = { ...openrouter, extra: { used: 10, limit: 10 } };
    const { deps, of } = world([claude, full, capped, anthropic]);
    const choices = (await fallbackChoices(of('claude-code'), deps)).map((c) => c.choice);
    expect(choices.find((c) => c.id === 'codex-cli')).toMatchObject({
      room: 'none',
      skip: 'At its limit',
      resetsAt: NOW + 3 * 3_600_000,
    });
    expect(choices.find((c) => c.id === 'openrouter')).toMatchObject({
      room: 'none',
      skip: 'At this key’s spending limit',
    });
    expect(firstWithRoom(choices)?.id).toBe('anthropic-api');

    // The month's budget used up: no key carries on, whatever its price.
    const broke = world([claude, full, anthropic], {
      month: async () => ({ usd: 50, budgetUsd: 50 }),
    });
    const left = (await fallbackChoices(broke.of('claude-code'), broke.deps)).map((c) => c.choice);
    expect(left.find((c) => c.id === 'anthropic-api')).toMatchObject({
      room: 'none',
      skip: 'This month’s budget is used up',
    });
    expect(firstWithRoom(left)).toBeUndefined();
  });

  it('a key that refused for a limit is passed over, and so is its twin', async () => {
    const refused = new Map<EngineId, number>([['codex-agent', NOW + 60_000]]);
    const { deps, of } = world([claude, codex, codexCli, openrouter], {
      refusedUntil: (id) => refused.get(id),
    });
    const choices = (await fallbackChoices(of('claude-code'), deps)).map((c) => c.choice);
    expect(choices[0]).toMatchObject({ name: 'Codex', room: 'none', resetsAt: NOW + 60_000 });
    expect(firstWithRoom(choices)?.id).toBe('openrouter');
  });

  it('says when one can’t do what the chat needs, and Automatic skips it', async () => {
    const { deps, of } = world([claude, { ...codex, cantCarry: true }, openrouter]);
    const choices = (await fallbackChoices(of('claude-code'), deps)).map((c) => c.choice);
    expect(choices[0]?.skip).toMatch(/^Can’t do all Claude Code does/);
    expect(firstWithRoom(choices)?.id).toBe('openrouter');
  });
});
