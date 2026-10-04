import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UsageSnapshot } from '@conch/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Engine, EngineUsage, LimitSignal } from '../engines/types';
import { dayKey, UsageService } from './service';

const NOW = Date.parse('2026-09-29T13:30:00');
const HOUR = 3_600_000;

function fakeEngine(initial: EngineUsage) {
  let usage = initial;
  const listeners = new Set<(s: LimitSignal) => void>();
  const engine = {
    label: 'Claude Code',
    usage: vi.fn(async () => usage),
    onLimits: (l: (s: LimitSignal) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as Engine & { usage: ReturnType<typeof vi.fn> };
  return {
    engine,
    set: (next: EngineUsage) => (usage = next),
    signal: (s: LimitSignal) => listeners.forEach((l) => l(s)),
  };
}

const plan = (used: number): EngineUsage => ({
  kind: 'plan',
  source: 'Claude Max',
  windows: [
    {
      id: 'session',
      label: 'Current session',
      usedPercent: used,
      resetsAt: NOW + 2 * HOUR,
      severity: 'normal',
    },
  ],
});

describe('UsageService', () => {
  let home: string;
  let now = NOW;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'conch-usage-'));
    now = NOW;
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(home, { recursive: true, force: true });
  });

  const make = (engine: Engine) => new UsageService({ home, engine: () => engine, now: () => now });

  it('reports plan windows and broadcasts every change', async () => {
    const { engine } = fakeEngine(plan(38));
    const service = make(engine);
    const seen: UsageSnapshot[] = [];
    service.changed.on((s) => seen.push(s));
    const snap = await service.snapshot();
    expect(snap).toMatchObject({ kind: 'plan', source: 'Claude Max', updatedAt: NOW });
    expect(snap.windows[0]?.usedPercent).toBe(38);
    expect(snap.blocked).toBeUndefined();
    expect(seen).toHaveLength(1);
    // Cached until forced.
    await service.snapshot();
    expect(engine.usage).toHaveBeenCalledTimes(1);
  });

  it('marks a full window as blocked until it resets', async () => {
    const { engine } = fakeEngine(plan(100));
    const snap = await make(engine).snapshot();
    expect(snap.blocked).toEqual({ until: NOW + 2 * HOUR, windowId: 'session' });
    expect(snap.windows[0]?.severity).toBe('exhausted');
  });

  it('blocks immediately on a rejected rate-limit hint, then re-reads', async () => {
    vi.useFakeTimers({
      now: NOW,
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    const fake = fakeEngine(plan(97));
    const service = make(fake.engine);
    service.start();
    await service.snapshot();
    const seen: UsageSnapshot[] = [];
    service.changed.on((s) => seen.push(s));
    fake.signal({ status: 'rejected', windowId: 'session', resetsAt: NOW + HOUR });
    await vi.waitFor(() => expect(seen.at(-1)?.blocked?.until).toBe(NOW + HOUR));
    fake.set(plan(100));
    now += 20_000;
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(fake.engine.usage).toHaveBeenCalledTimes(2));
    service.stop();
  });

  it('keeps a spend ledger with an optional budget for metered sign-ins', async () => {
    const { engine } = fakeEngine({ kind: 'metered', source: 'Amazon Bedrock', windows: [] });
    const service = make(engine);
    await service.recordTurn({ inputTokens: 1, outputTokens: 1, costUsd: 1.25 });
    await service.recordTurn({ inputTokens: 1, outputTokens: 1, costUsd: 0.5 });
    await service.recordTurn(undefined);
    now += 24 * HOUR;
    await service.recordTurn({ inputTokens: 1, outputTokens: 1, costUsd: 2 });
    const snap = await service.setBudget(50);
    expect(snap.spend).toEqual({ today: 2, month: 3.75, budget: 50 });
    expect(snap.message).toMatch(/list prices/);
    const file = JSON.parse(await readFile(join(home, 'usage.json'), 'utf8')) as {
      days: Record<string, number>;
    };
    expect(file.days[dayKey(NOW)]).toBe(1.75);
    expect((await service.setBudget(null)).spend.budget).toBeUndefined();
    service.stop();
  });

  it('keeps the last good numbers when the provider read fails', async () => {
    const fake = fakeEngine(plan(40));
    const service = make(fake.engine);
    await service.snapshot();
    fake.engine.usage.mockRejectedValueOnce(new Error('Timed out'));
    now += 60_000;
    const snap = await service.refresh({ force: true });
    expect(snap.windows[0]?.usedPercent).toBe(40);
    expect(snap.message).toMatch(/Couldn't refresh usage: Timed out/);
  });
});

describe('UsageService, one meter per provider', () => {
  it('keeps each provider’s limits apart, and a turn re-reads the one that answered', async () => {
    vi.useFakeTimers({
      now: NOW,
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    const home = await mkdtemp(join(tmpdir(), 'conch-usage-'));
    const claude = fakeEngine(plan(30));
    const codex = fakeEngine({ ...plan(85), source: 'ChatGPT Plus' });
    Object.assign(claude.engine, { id: 'claude-code' });
    Object.assign(codex.engine, { id: 'codex-cli', label: 'Codex' });
    const byId = { 'claude-code': claude.engine, 'codex-cli': codex.engine } as Record<
      string,
      Engine
    >;
    let now = NOW;
    const service = new UsageService({
      home,
      engine: (id) => byId[id ?? 'claude-code'] as Engine,
      engines: () => Object.values(byId),
      now: () => now,
    });
    service.start();
    const seen: UsageSnapshot[] = [];
    service.changed.on((s) => seen.push(s));
    expect(await service.snapshot()).toMatchObject({ engine: 'claude-code', source: 'Claude Max' });
    expect(await service.snapshot({ engine: 'codex-cli' })).toMatchObject({
      engine: 'codex-cli',
      source: 'ChatGPT Plus',
    });
    expect(seen.map((s) => s.engine)).toEqual(['claude-code', 'codex-cli']);

    // A Codex turn ends: only Codex is read again.
    codex.set({ ...plan(92), source: 'ChatGPT Plus' });
    now += 20_000;
    await service.recordTurn(undefined, undefined, { engine: 'codex-cli' });
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ engine: 'codex-cli' }));
    expect(seen.at(-1)?.windows[0]?.usedPercent).toBe(92);
    expect(claude.engine.usage).toHaveBeenCalledTimes(1);

    // Codex's own live hint blocks Codex, not Claude.
    codex.signal({ status: 'rejected', windowId: 'session', resetsAt: NOW + HOUR });
    await vi.waitFor(() =>
      expect(seen.at(-1)).toMatchObject({ engine: 'codex-cli', blocked: { until: NOW + HOUR } }),
    );
    expect((await service.snapshot()).blocked).toBeUndefined();
    service.stop();
    await rm(home, { recursive: true, force: true });
  });
});

describe('UsageService ledger seeding', () => {
  it('backfills spend from past turns the first time', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-usage-'));
    const { engine } = fakeEngine({ kind: 'metered', source: 'Anthropic API', windows: [] });
    const history = vi.fn(async () => [
      { at: NOW - 1000, costUsd: 0.4 },
      { at: NOW - 40 * 24 * HOUR, costUsd: 9 },
    ]);
    const first = new UsageService({ home, engine: () => engine, history, now: () => NOW });
    expect((await first.snapshot()).spend).toEqual({ today: 0.4, month: 0.4 });
    const second = new UsageService({ home, engine: () => engine, history, now: () => NOW });
    await second.snapshot();
    expect(history).toHaveBeenCalledTimes(1);
    await rm(home, { recursive: true, force: true });
  });
});
