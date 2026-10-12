import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Engine } from '../engines/types';
import { Billings, recordSmallSpend, type BillingInfo } from './billing';
import { UsageService } from './service';

const homes: string[] = [];
afterEach(async () => {
  while (homes.length) await rm(homes.pop() ?? '', { recursive: true, force: true });
});

const engine = { id: 'anthropic', label: 'Anthropic API' } as unknown as Engine;
const billed = (info: BillingInfo) => ({ of: async () => info });

describe('a small model’s spend in the month’s budget (ADR 0103)', () => {
  it('prices a pay-as-you-go call by its model, so the budget counts it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-small-spend-'));
    homes.push(home);
    const usage = new UsageService({ home, engine: () => engine });
    await recordSmallSpend(
      (u, priced) => usage.recordTurn(u, priced),
      billed({ billing: 'metered' }),
      { inputTokens: 1_000_000, outputTokens: 0 },
      engine,
      'claude-haiku-4-5',
    );
    expect((await usage.month()).usd).toBeCloseTo(1, 5);
  });

  it('counts nothing on a plan or this computer', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-small-spend-'));
    homes.push(home);
    const usage = new UsageService({ home, engine: () => engine });
    for (const info of [{ billing: 'plan' as const }, { billing: 'free' as const }])
      await recordSmallSpend(
        (u, priced) => usage.recordTurn(u, priced),
        billed(info),
        { inputTokens: 1_000_000, outputTokens: 0, costUsd: 3 },
        engine,
        'claude-haiku-4-5',
      );
    expect((await usage.month()).usd).toBe(0);
  });
});

describe('how a provider charges', () => {
  it('asks again after a check that failed, rather than keeping “don’t know” for a minute', async () => {
    let ready = false;
    const flaky = {
      id: 'anthropic',
      label: 'Anthropic API',
      detect: async () => {
        if (!ready) throw new Error('timed out');
        return { state: 'ready', auth: { method: 'api-key', description: 'Anthropic API' } };
      },
    } as unknown as Engine;
    const billings = new Billings(() => 1_000);
    expect(await billings.of(flaky)).toEqual({});
    ready = true;
    expect((await billings.of(flaky)).billing).toBe('metered');
    expect((await billings.quick(flaky)).billing).toBe('metered');
  });
});
