import { describe, expect, it } from 'vitest';

import {
  AGED_MS,
  CALM_MS,
  ceilingFor,
  costOf,
  ProviderPace,
  PROVIDER_START,
  schedule,
  STEP_MS,
  type Machine,
  type ProviderRoom,
  type ScheduleInput,
  type Slot,
} from './scheduler';

const GiB = 1024 ** 3;
const NOW = 10_000_000;

/** A roomy, quiet computer: 8 processors, 16 GB with 12 free. */
const roomy = (over: Partial<Machine> = {}): Machine => ({
  allowed: true,
  planned: true,
  cpuCount: 8,
  snapshot: { totalBytes: 16 * GiB, availableBytes: 12 * GiB, loadPerCpu: 0.1 },
  ...over,
});

let n = 0;
const slot = (over: Partial<Slot> = {}): Slot => {
  n += 1;
  return {
    id: `t${String(n).padStart(3, '0')}`,
    title: `Task ${n}`,
    kind: 'helper',
    chat: 'chat-a',
    engine: 'mock',
    provider: 'Claude Code',
    footprint: 'process',
    estimate: { weight: 'medium', uses: ['model'], minutes: 4 },
    touches: [],
    after: [],
    createdAt: NOW - 1_000 + n,
    ...over,
  };
};

const plenty = (): ProviderRoom => ({ limit: 100 });
const run = (input: Partial<ScheduleInput> & Pick<ScheduleInput, 'queued'>) =>
  schedule({ now: NOW, machine: roomy(), running: [], provider: plenty, ...input });

describe('how many start: room, not a number (ADR 0128)', () => {
  it('starts all five of a batch on a roomy computer, where four used to be the most', () => {
    const queued = Array.from({ length: 5 }, () => slot({ group: 'g1' }));
    const plan = run({ queued });
    expect(plan.start).toHaveLength(5);
    expect(plan.waiting.size).toBe(0);
    expect(plan.capacity).toMatchObject({ working: 5, waiting: 0 });
    expect(plan.capacity.atOnce).toBeGreaterThanOrEqual(5);
  });

  it('starts fewer on a small computer, and says what the rest wait for', () => {
    const machine = roomy({
      cpuCount: 2,
      snapshot: { totalBytes: 4 * GiB, availableBytes: 3 * GiB, loadPerCpu: 0.1 },
    });
    const queued = Array.from({ length: 4 }, () => slot());
    const plan = run({ machine, queued });
    expect(plan.start.length).toBeGreaterThanOrEqual(1);
    expect(plan.start.length).toBeLessThan(4);
    const [why] = plan.waiting.values();
    expect(why?.reason).toMatch(/room|memory|cpu/);
    expect(plan.capacity.atOnce).toBe(plan.start.length);
    expect(plan.capacity.words).toMatch(/at once/);
  });

  it('a heavy task waits while memory is short, with how many heavy ones are working, then starts once it frees', () => {
    const working = slot({
      estimate: { weight: 'heavy', uses: ['memory'], minutes: 10 },
      startedAt: NOW - 5 * 60_000,
    });
    const next = slot({ estimate: { weight: 'heavy', uses: ['cpu'], minutes: 10 } });
    const short = roomy({
      snapshot: { totalBytes: 16 * GiB, availableBytes: 2.5 * GiB, loadPerCpu: 0.2 },
    });
    const held = run({ machine: short, running: [working], queued: [next] });
    expect(held.start).toEqual([]);
    expect(held.waiting.get(next.id)).toMatchObject({
      reason: 'memory',
      words: 'Waiting for memory: 1 heavy task working',
      canStartNow: false,
    });
    expect(held.waiting.get(next.id)?.expectedAt).toBe(NOW + 5 * 60_000);
    expect(held.tight.memory).toBe(true);
    // Just enough free isn't enough once it was tight: a quarter more than it needs.
    const need = costOf(next.estimate, 'process').memory;
    const reserve = 1 * GiB;
    const edge = roomy({
      snapshot: { totalBytes: 16 * GiB, availableBytes: 2 * reserve + need * 1.1, loadPerCpu: 0.2 },
    });
    expect(
      run({ machine: edge, running: [working], queued: [next], tight: held.tight }).start,
    ).toEqual([]);
    expect(run({ machine: edge, running: [working], queued: [next] }).start).toEqual([next.id]);
    const freed = run({ running: [working], queued: [next], tight: held.tight });
    expect(freed.start).toEqual([next.id]);
    expect(freed.tight.memory).toBeUndefined();
  });

  it('with nothing working, one always starts, however big', () => {
    const tiny = roomy({
      cpuCount: 1,
      snapshot: { totalBytes: 2 * GiB, availableBytes: 0.4 * GiB, loadPerCpu: 0.5 },
    });
    const huge = slot({ estimate: { weight: 'heavy', uses: ['cpu', 'memory'], minutes: 60 } });
    expect(run({ machine: tiny, queued: [huge, slot()] }).start).toEqual([huge.id]);
  });

  it('never more than the ceiling, however light', () => {
    expect(ceilingFor(1)).toBe(2);
    expect(ceilingFor(2)).toBe(4);
    expect(ceilingFor(64)).toBe(12);
    const light = Array.from({ length: 8 }, () =>
      slot({ footprint: 'remote', estimate: { weight: 'light', uses: ['model'], minutes: 1 } }),
    );
    const plan = run({ machine: roomy({ cpuCount: 2 }), queued: light });
    expect(plan.start).toHaveLength(4);
    expect([...plan.waiting.values()].every((w) => w.reason === 'room')).toBe(true);
    expect([...plan.waiting.values()][0]?.words).toBe('Starts when one of the 4 working finishes');
  });

  it('holds automatic work while the gateway says no, saying why in its words', () => {
    const held = slot();
    const queued = [held];
    const memory = run({
      queued,
      machine: roomy({
        allowed: false,
        planned: false,
        pace: { phase: 'held', cause: 'memory', critical: true },
      }),
    });
    expect(memory.start).toEqual([]);
    expect(memory.waiting.get(held.id)).toMatchObject({
      reason: 'memory',
      words: 'Waiting for memory to free up on this computer',
    });
    const cpu = run({
      queued,
      machine: roomy({
        allowed: false,
        pace: { phase: 'constrained', cause: 'cpu', critical: false },
      }),
    });
    expect(cpu.waiting.get(held.id)).toMatchObject({ reason: 'cpu', canStartNow: true });
    const recovering = run({
      queued,
      machine: roomy({
        allowed: false,
        planned: false,
        pace: { phase: 'held', cause: 'recovery', critical: false },
      }),
    });
    expect(recovering.waiting.get(held.id)).toMatchObject({
      reason: 'recovering',
      words: 'Waiting while Conch recovers',
    });
    expect(recovering.capacity).toMatchObject({ atOnce: 0, words: 'Waiting while Conch recovers' });
    const unknown = run({ queued, machine: roomy({ allowed: false, planned: false }) });
    expect(unknown.waiting.get(held.id)?.words).toBe('Checking this computer has room');
  });

  it('names what keeps the processor busy: its own tasks, or managed commands', () => {
    const busy = roomy({
      cpuCount: 4,
      commands: 2,
      snapshot: { totalBytes: 16 * GiB, availableBytes: 12 * GiB, loadPerCpu: 0.85 },
    });
    const working = slot({
      startedAt: NOW - 5 * 60_000,
      estimate: { weight: 'light', uses: ['model'], minutes: 9 },
    });
    const plan = run({
      machine: busy,
      running: [working],
      queued: [slot({ estimate: { weight: 'medium', uses: ['cpu'], minutes: 3 } })],
    });
    const [why] = plan.waiting.values();
    expect(why).toMatchObject({
      reason: 'cpu',
      words: 'Waiting for the processor: 2 commands running',
    });
  });
});

describe('"Start now"', () => {
  it('goes past what this computer can spare for room, a little past the ceiling, never past memory', () => {
    const machine = roomy({ cpuCount: 2 });
    const running = Array.from({ length: 4 }, () =>
      slot({
        footprint: 'remote',
        startedAt: NOW - 120_000,
        estimate: { weight: 'light', uses: ['model'], minutes: 3 },
      }),
    );
    const waiting = slot({
      footprint: 'remote',
      estimate: { weight: 'light', uses: ['model'], minutes: 3 },
    });
    const before = run({ machine, running, queued: [waiting] });
    expect(before.waiting.get(waiting.id)).toMatchObject({ reason: 'room', canStartNow: true });
    const pressed = { ...waiting, startNow: true };
    expect(run({ machine, running, queued: [pressed] }).start).toEqual([waiting.id]);
    // Two past the ceiling at most.
    const crowded = [...running, slot({ startedAt: NOW }), slot({ startedAt: NOW })];
    const no = run({ machine, running: crowded, queued: [pressed] });
    expect(no.start).toEqual([]);
    expect(no.waiting.get(waiting.id)?.canStartNow).toBe(false);
    // Short of memory: it waits whatever was pressed.
    const short = roomy({
      cpuCount: 2,
      snapshot: { totalBytes: 8 * GiB, availableBytes: 1.2 * GiB, loadPerCpu: 0.1 },
    });
    expect(
      run({ machine: short, running, queued: [pressed] }).waiting.get(waiting.id)?.reason,
    ).toBe('memory');
  });

  it('starts while the processor is merely busy, if the person asked, not while Conch recovers', () => {
    const cpu = roomy({
      allowed: false,
      planned: true,
      pace: { phase: 'constrained', cause: 'cpu', critical: false },
    });
    const pressed = slot({ startNow: true });
    expect(run({ machine: cpu, queued: [pressed] }).start).toEqual([pressed.id]);
    const recovering = roomy({
      allowed: false,
      planned: false,
      pace: { phase: 'held', cause: 'recovery', critical: false },
    });
    expect(run({ machine: recovering, queued: [pressed] }).start).toEqual([]);
  });
});

describe('order: fair, together, and kept for who waited', () => {
  it('one chat’s big batch can’t starve another chat’s one task', () => {
    const machine = roomy({ cpuCount: 2 });
    const big = Array.from({ length: 6 }, () =>
      slot({
        chat: 'big',
        group: 'g-big',
        footprint: 'remote',
        estimate: { weight: 'light', uses: ['model'], minutes: 2 },
      }),
    );
    const other = slot({
      chat: 'other',
      footprint: 'remote',
      estimate: { weight: 'light', uses: ['model'], minutes: 2 },
    });
    const plan = run({ machine, queued: [...big, other] });
    expect(plan.start).toHaveLength(4);
    expect(plan.start).toContain(other.id);
  });

  it('a batch that fits starts together', () => {
    const working = slot({ chat: 'b', startedAt: NOW - 120_000 });
    const batch = Array.from({ length: 3 }, () => slot({ chat: 'a', group: 'g' }));
    const plan = run({ running: [working], queued: batch });
    expect(plan.start).toEqual(batch.map((s) => s.id));
  });

  it('one that has waited long goes first, and what it needs is kept for it', () => {
    const machine = roomy({
      cpuCount: 4,
      snapshot: { totalBytes: 16 * GiB, availableBytes: 12 * GiB, loadPerCpu: 0.05 },
    });
    const running = [
      slot({
        chat: 'x',
        startedAt: NOW - 600_000,
        estimate: { weight: 'medium', uses: ['cpu'], minutes: 20 },
      }),
    ];
    const old = slot({
      chat: 'y',
      createdAt: NOW - AGED_MS - 1,
      estimate: { weight: 'heavy', uses: ['cpu'], minutes: 20 },
    });
    const young = slot({ chat: 'z', estimate: { weight: 'medium', uses: ['model'], minutes: 2 } });
    const plan = run({ machine, running, queued: [old, young] });
    expect(plan.start).toEqual([]);
    expect(plan.waiting.get(old.id)?.reason).toBe('room');
    // Without the long wait, the small one would have slipped in.
    expect(run({ machine, running, queued: [{ ...old, createdAt: NOW }, young] }).start).toEqual([
      young.id,
    ]);
  });
});

describe('what mustn’t run together', () => {
  it('two that change the same file take turns, and the card says which and why', () => {
    const scope = '/work\u0000';
    const first = slot({ title: 'Fix the login', touches: [`${scope}src/auth.ts`] });
    const second = slot({
      title: 'Tidy auth',
      touches: [`${scope}src/auth.ts`, `${scope}src/b.ts`],
    });
    const queuedBoth = run({ queued: [first, second] });
    expect(queuedBoth.start).toEqual([first.id]);
    expect(queuedBoth.waiting.get(second.id)).toMatchObject({
      reason: 'conflict',
      words: 'Starts when “Fix the login” finishes: both change auth.ts',
      on: [first.id],
      canStartNow: false,
    });
    // Ahead in line but not started: it waits behind that one too.
    const held = run({
      machine: roomy({ allowed: false, planned: false }),
      queued: [first, second],
    });
    expect(held.waiting.get(second.id)?.words).toBe(
      'Starts after “Fix the login”: both change auth.ts',
    );
    // A pair the planner set says so plainly.
    const pair = 'g\u0000pair:0-1';
    const a = slot({ title: 'A', touches: [pair], startedAt: NOW });
    const b = slot({ title: 'B', touches: [pair] });
    expect(run({ running: [a], queued: [b] }).waiting.get(b.id)?.words).toBe(
      'Starts when “A” finishes: both change the same files',
    );
  });

  it('one set after another waits for it, then starts', () => {
    const first = slot({ title: 'Web fetch', startedAt: NOW - 60_000 });
    const second = slot({ after: [first.id] });
    const plan = run({ running: [first], queued: [second] });
    expect(plan.waiting.get(second.id)).toMatchObject({
      reason: 'after',
      words: 'Starts after “Web fetch”',
      on: [first.id],
      expectedAt: NOW - 60_000 + 4 * 60_000,
    });
    expect(run({ queued: [second] }).start).toEqual([second.id]);
  });
});

describe('a provider that asks to slow down', () => {
  it('its tasks wait until it said, then look again', () => {
    const held = slot({ provider: 'Codex', engine: 'codex-cli' });
    const other = slot();
    const queued = [held, other];
    const plan = run({
      queued,
      provider: (s) => (s.engine === 'codex-cli' ? { limit: 1, retryAt: NOW + 20_000 } : plenty()),
    });
    expect(plan.start).toEqual([other.id]);
    expect(plan.waiting.get(held.id)).toMatchObject({
      reason: 'provider',
      words: 'Codex asked Conch to slow down',
      retryAt: NOW + 20_000,
      canStartNow: false,
    });
    expect(plan.wakeAt).toBe(NOW + 20_000);
  });

  it('no more at once than its pace', () => {
    const queued = Array.from({ length: 3 }, () =>
      slot({ provider: 'Codex', engine: 'codex-cli' }),
    );
    const plan = run({ queued, provider: () => ({ limit: 2 }) });
    expect(plan.start).toHaveLength(2);
    expect([...plan.waiting.values()][0]).toMatchObject({
      reason: 'provider-busy',
      words: 'Codex is already doing 2 at once',
    });
  });

  it('halves, waits longer each time, and comes back one at a time after a calm spell', () => {
    let now = NOW;
    const pace = new ProviderPace(() => now);
    expect(pace.room('codex', 'process')).toEqual({ limit: PROVIDER_START.process });
    expect(pace.slowDown('codex', 'process')).toEqual({ limit: 3, retryAt: now + 20_000 });
    expect(pace.slowDown('codex', 'process')).toEqual({ limit: 1, retryAt: now + 40_000 });
    // Never below one; never paused past two minutes, even if asked.
    expect(pace.slowDown('codex', 'process', 3_600_000)).toEqual({
      limit: 1,
      retryAt: now + 120_000,
    });
    now += 121_000;
    expect(pace.room('codex', 'process')).toEqual({ limit: 2 });
    now += 10_000;
    expect(pace.room('codex', 'process').limit).toBe(2);
    now += STEP_MS;
    expect(pace.room('codex', 'process').limit).toBe(3);
    for (let i = 0; i < 10; i++) {
      now += STEP_MS;
      pace.room('codex', 'process');
    }
    expect(pace.room('codex', 'process').limit).toBe(PROVIDER_START.process);
    expect(CALM_MS).toBeGreaterThan(STEP_MS);
    // A model on this computer takes one at a time to begin with; another provider is untouched.
    expect(pace.room('ollama', 'local-model').limit).toBe(1);
  });

  it('its own retry time, when it said one', () => {
    const pace = new ProviderPace(() => NOW);
    expect(pace.slowDown('openai', 'remote', 7_000).retryAt).toBe(NOW + 7_000);
  });
});

describe('what a task costs', () => {
  it('heavier for heavy work, for its own program, and lighter when it mostly waits for a model', () => {
    const remote = costOf({ weight: 'light', uses: ['network'] }, 'remote');
    const local = costOf({ weight: 'light', uses: ['network'] }, 'process');
    const heavy = costOf({ weight: 'heavy', uses: ['cpu', 'memory'] }, 'process');
    expect(remote.cpu).toBeLessThan(local.cpu);
    expect(heavy.cpu).toBeGreaterThan(2);
    expect(heavy.memory).toBeGreaterThan(2 * GiB);
  });
});
