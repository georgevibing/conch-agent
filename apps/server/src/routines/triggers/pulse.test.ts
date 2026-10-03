import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Judge } from './onlyif';
import {
  Pulse,
  RUNS_PER_HOUR,
  type FiredBatch,
  type FireResult,
  type PulseRoutine,
  type Sources,
} from './pulse';
import { WhenStore } from './store';
import { SourceError, type Arrive, type Happening, type TriggerSource } from './types';

const happening = (id: string, detail = `about ${id}`): Happening => ({
  id,
  at: 1,
  label: `email ${id}`,
  detail,
});

/** A polled source that reports what the test puts in its queue, or fails as told. */
function fakePolled() {
  const queue: Happening[][] = [];
  let failure: SourceError | undefined;
  let looks = 0;
  const source: TriggerSource<'mail'> = {
    kind: 'mail',
    describe: () => 'When an email arrives',
    taint: () => ({ kind: 'app', label: 'an email' }),
    every: () => 60_000,
    async check(ctx) {
      looks++;
      if (failure) throw failure;
      return { happenings: queue.shift() ?? [], state: { ...ctx.state, looks } };
    },
  };
  return {
    source,
    push: (...h: Happening[]) => queue.push(h),
    fail: (e?: SourceError) => (failure = e),
    looks: () => looks,
  };
}

/** A pushed source: the test calls `arrive` itself. */
function fakePushed() {
  let arrive: Arrive | undefined;
  let report: ((e?: SourceError) => void) | undefined;
  let stopped = 0;
  const source: TriggerSource<'task'> = {
    kind: 'task',
    describe: () => 'When a background task finishes',
    taint: () => ({ kind: 'app', label: 'a finished task' }),
    watch(_ctx, a, p) {
      arrive = a;
      report = p;
      return { stop: () => void stopped++ };
    },
  };
  return {
    source,
    arrive: (...h: Happening[]) => arrive?.(h),
    problem: (e?: SourceError) => report?.(e),
    stopped: () => stopped,
  };
}

async function setup(options: {
  routines: PulseRoutine[];
  sources: Sources;
  fire?: (id: string, batch: FiredBatch) => Promise<FireResult>;
  judge?: Judge;
  dir?: string;
  now?: () => number;
}) {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), 'conch-pulse-')));
  const fired: { id: string; batch: FiredBatch }[] = [];
  const healed: string[] = [];
  const store = new WhenStore(dir);
  const pulse = new Pulse({
    store,
    sources: options.sources,
    routines: async () => options.routines,
    fire:
      options.fire ??
      (async (id, batch) => {
        fired.push({ id, batch });
        return 'started';
      }),
    ...(options.judge && { judge: options.judge }),
    ...(options.now && { now: options.now }),
    onHeal: (m) => healed.push(m),
    beatMs: 60_000_000,
  });
  await pulse.start();
  return { pulse, store, fired, healed, dir };
}

const mailRoutine: PulseRoutine = {
  id: 'r_mail',
  title: 'Anna replies',
  status: 'active',
  when: { kind: 'mail', from: [{ name: 'Anna' }], words: [] },
};
const taskRoutine: PulseRoutine = {
  id: 'r_task',
  title: 'After tasks',
  status: 'active',
  when: { kind: 'task' },
};

describe('the pulse', () => {
  it('does nothing at all without When-routines, and nothing on a quiet look', async () => {
    const polled = fakePolled();
    const { pulse, fired } = await setup({ routines: [], sources: { mail: polled.source } });
    await pulse.beat();
    expect(polled.looks()).toBe(0);
    const quiet = await setup({ routines: [mailRoutine], sources: { mail: polled.source } });
    await quiet.pulse.beat();
    expect(polled.looks()).toBe(1);
    expect(quiet.fired).toHaveLength(0);
    expect(fired).toHaveLength(0);
    pulse.stop();
    quiet.pulse.stop();
  });

  it('starts one run for something new, and never again for the same thing — even after a restart', async () => {
    const polled = fakePolled();
    const first = await setup({ routines: [mailRoutine], sources: { mail: polled.source } });
    polled.push(happening('m1'));
    await first.pulse.lookNow();
    expect(first.fired).toHaveLength(1);
    expect(first.fired[0]?.batch.happenings.map((h) => h.id)).toEqual(['m1']);
    expect(first.fired[0]?.batch.taint).toEqual({ kind: 'app', label: 'an email' });
    polled.push(happening('m1'));
    await first.pulse.lookNow();
    expect(first.fired).toHaveLength(1);
    first.pulse.stop();
    // A restart: a new pulse over the same files.
    const again = await setup({
      routines: [mailRoutine],
      sources: { mail: polled.source },
      dir: first.dir,
    });
    polled.push(happening('m1'), happening('m2'));
    await again.pulse.lookNow();
    expect(again.fired.map((f) => f.batch.happenings.map((h) => h.id))).toEqual([['m2']]);
    const state = await again.pulse.state(mailRoutine);
    expect(state).toMatchObject({ state: 'watching', noticed: 2, woke: 2, waiting: 0 });
    again.pulse.stop();
  });

  it('keeps the source’s bookkeeping across looks', async () => {
    const polled = fakePolled();
    const { pulse, store } = await setup({
      routines: [mailRoutine],
      sources: { mail: polled.source },
    });
    await pulse.lookNow();
    await pulse.lookNow();
    expect((await store.seen(mailRoutine.id)).source).toEqual({ looks: 3 });
    pulse.stop();
  });

  it('turns a burst into one run, and holds what comes while a run goes', async () => {
    const pushed = fakePushed();
    let busy = true;
    const batches: string[][] = [];
    const { pulse } = await setup({
      routines: [taskRoutine],
      sources: { task: pushed.source },
      fire: async (_id, batch) => {
        if (busy) return 'busy';
        batches.push(batch.happenings.map((h) => h.id));
        return 'started';
      },
    });
    await pulse.sync();
    pushed.arrive(happening('t1'));
    pushed.arrive(happening('t2'), happening('t3'));
    await pulse.beat();
    expect(batches).toEqual([]);
    expect((await pulse.state(taskRoutine)).waiting).toBe(3);
    expect((await pulse.state(taskRoutine)).message).toMatch(/Waiting for a moment/);
    busy = false;
    await pulse.beat();
    expect(batches).toEqual([['t1', 't2', 't3']]);
    pulse.stop();
  });

  it('runs at most four times an hour; the rest waits for the next run', async () => {
    const pushed = fakePushed();
    let now = 1_000_000;
    const { pulse, fired } = await setup({
      routines: [taskRoutine],
      sources: { task: pushed.source },
      now: () => now,
    });
    await pulse.sync();
    for (let i = 0; i < RUNS_PER_HOUR + 2; i++) {
      pushed.arrive(happening(`t${i}`));
      await pulse.beat();
      now += 60_000;
    }
    expect(fired).toHaveLength(RUNS_PER_HOUR);
    const held = await pulse.state(taskRoutine);
    expect(held.waiting).toBe(2);
    expect(held.message).toMatch(/4 times this hour/);
    now += 60 * 60_000;
    await pulse.beat();
    expect(fired).toHaveLength(RUNS_PER_HOUR + 1);
    expect(fired.at(-1)?.batch.happenings.map((h) => h.id)).toEqual(['t4', 't5']);
    pulse.stop();
  });

  it('waits for a provider that isn’t ready, and loses nothing', async () => {
    const pushed = fakePushed();
    let ready = false;
    const runs: string[][] = [];
    const { pulse } = await setup({
      routines: [taskRoutine],
      sources: { task: pushed.source },
      fire: async (_id, batch) => {
        if (!ready) return 'not-ready';
        runs.push(batch.happenings.map((h) => h.id));
        return 'started';
      },
    });
    await pulse.sync();
    pushed.arrive(happening('t1'));
    await pulse.beat();
    expect((await pulse.state(taskRoutine)).message).toMatch(/provider/);
    ready = true;
    await pulse.beat();
    expect(runs).toEqual([['t1']]);
    pulse.stop();
  });

  it('backs off a failing source, says so when only a person can fix it, and notes when it’s back', async () => {
    const polled = fakePolled();
    let now = 5_000_000;
    const { pulse, healed } = await setup({
      routines: [mailRoutine],
      sources: { mail: polled.source },
      now: () => now,
    });
    polled.fail(new SourceError('retry', 'Gmail didn’t answer.'));
    now += 60_000;
    await pulse.beat();
    expect(polled.looks()).toBe(2);
    // A blip isn't news yet.
    expect((await pulse.state(mailRoutine)).state).toBe('watching');
    now += 60_000;
    await pulse.beat();
    expect(polled.looks()).toBe(3);
    // Backing off: a minute later isn't time yet; two minutes is.
    now += 60_000;
    await pulse.beat();
    expect(polled.looks()).toBe(3);
    now += 60_000;
    await pulse.beat();
    expect(polled.looks()).toBe(4);
    // Failing for a long time is trouble on the card.
    now += 40 * 60_000;
    await pulse.lookNow();
    expect(await pulse.state(mailRoutine)).toMatchObject({
      state: 'trouble',
      message: 'Gmail didn’t answer.',
    });
    // Signed out: only a person can fix it, with one place to do it.
    polled.fail(
      new SourceError('needs-you', 'Gmail needs you to sign in again.', {
        label: 'Open Apps',
        place: 'integrations',
        focus: 'gmail',
      }),
    );
    await pulse.lookNow();
    expect(await pulse.state(mailRoutine)).toMatchObject({
      state: 'needs-you',
      fix: { place: 'integrations', focus: 'gmail' },
    });
    polled.fail(undefined);
    await pulse.lookNow();
    expect((await pulse.state(mailRoutine)).state).toBe('watching');
    expect(healed).toEqual(['“Anna replies” can look again, and is watching as before.']);
    pulse.stop();
  });

  it('gives up on a look that hangs, instead of hanging the pulse', async () => {
    const source: TriggerSource<'mail'> = {
      kind: 'mail',
      describe: () => 'x',
      taint: () => ({ kind: 'app', label: 'x' }),
      every: () => 60_000,
      check: (ctx) =>
        new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error()))),
    };
    const original = AbortSignal.timeout;
    AbortSignal.timeout = () => original.call(AbortSignal, 10);
    try {
      const { pulse, store } = await setup({ routines: [mailRoutine], sources: { mail: source } });
      await pulse.lookNow();
      expect((await store.seen(mailRoutine.id)).failing).toMatchObject({
        kind: 'retry',
        message: 'It took too long to answer.',
      });
      pulse.stop();
    } finally {
      AbortSignal.timeout = original;
    }
  });

  it('stops watching a routine that’s turned off, and starts again when it’s on', async () => {
    const pushed = fakePushed();
    const routines = [{ ...taskRoutine }];
    const { pulse } = await setup({ routines, sources: { task: pushed.source } });
    await pulse.sync();
    routines[0] = { ...taskRoutine, status: 'paused' };
    await pulse.sync();
    expect(pushed.stopped()).toBe(1);
    expect((await pulse.state(routines[0])).state).toBe('off');
    pulse.stop();
  });

  it('a source reporting a problem is on the card until it clears', async () => {
    const pushed = fakePushed();
    const { pulse } = await setup({ routines: [taskRoutine], sources: { task: pushed.source } });
    await pulse.sync();
    pushed.problem(new SourceError('needs-you', 'The folder “Inbox” isn’t there any more.'));
    await vi.waitFor(async () => expect((await pulse.state(taskRoutine)).state).toBe('needs-you'));
    pushed.problem(undefined);
    await vi.waitFor(async () => expect((await pulse.state(taskRoutine)).state).toBe('watching'));
    pulse.stop();
  });

  it('stops a chain that comes back round, or runs too long', async () => {
    const pushed = fakePushed();
    const { pulse, fired } = await setup({
      routines: [taskRoutine],
      sources: { task: pushed.source },
    });
    await pulse.sync();
    pushed.arrive({ ...happening('loop'), chain: ['r_a', taskRoutine.id] });
    pushed.arrive({ ...happening('long'), chain: ['a', 'b', 'c', 'd', 'e'] });
    pushed.arrive({ ...happening('fine'), chain: ['a'] });
    await pulse.beat();
    expect(fired.map((f) => f.batch.happenings.map((h) => h.id))).toEqual([['fine']]);
    expect(fired[0]?.batch.chain).toEqual(['a']);
    expect((await pulse.state(taskRoutine)).passed).toBe(2);
    pulse.stop();
  });
});

describe('only if…', () => {
  const withCondition = { ...taskRoutine, onlyIf: 'it’s about the invoice' };

  it('wakes the routine only for what matches, and counts what it passed over', async () => {
    const pushed = fakePushed();
    const asked: string[] = [];
    const { pulse, fired } = await setup({
      routines: [withCondition],
      sources: { task: pushed.source },
      judge: async (condition, h) => {
        asked.push(condition);
        return { verdict: h.detail.includes('invoice') ? 'yes' : 'no' };
      },
    });
    await pulse.sync();
    pushed.arrive(happening('a', 'lunch on friday?'));
    pushed.arrive(happening('b', 'the invoice for october'));
    await pulse.beat();
    expect(asked).toEqual(['it’s about the invoice', 'it’s about the invoice']);
    expect(fired.map((f) => f.batch.happenings.map((h) => h.id))).toEqual([['b']]);
    expect(fired[0]?.batch).toMatchObject({ matched: true, unchecked: false });
    expect(await pulse.state(withCondition)).toMatchObject({ noticed: 2, passed: 1, woke: 1 });
    pulse.stop();
  });

  it('wakes it anyway — and says so — when the check can’t answer', async () => {
    for (const judge of [
      undefined,
      (async () => ({ verdict: 'unsure' })) as Judge,
      (async () => {
        throw new Error('down');
      }) as Judge,
    ]) {
      const pushed = fakePushed();
      const { pulse, fired } = await setup({
        routines: [withCondition],
        sources: { task: pushed.source },
        ...(judge && { judge }),
      });
      await pulse.sync();
      pushed.arrive(happening('x'));
      await pulse.beat();
      expect(fired).toHaveLength(1);
      expect(fired[0]?.batch).toMatchObject({ unchecked: true, matched: false });
      pulse.stop();
    }
  });

  it('checks at most ten times an hour, and asks the spending seam first', async () => {
    const pushed = fakePushed();
    let checks = 0;
    const recorded: unknown[] = [];
    let allow = true;
    const dir = await mkdtemp(join(tmpdir(), 'conch-pulse-'));
    const pulse = new Pulse({
      store: new WhenStore(dir),
      sources: { task: pushed.source },
      routines: async () => [withCondition],
      fire: async () => 'busy',
      judge: async () => {
        checks++;
        return { verdict: 'yes', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.0001 } };
      },
      spend: { allow: async () => allow, record: (_id, usage) => recorded.push(usage) },
      beatMs: 60_000_000,
    });
    await pulse.start();
    for (let i = 0; i < 12; i++) pushed.arrive(happening(`h${i}`));
    await pulse.beat();
    expect(checks).toBe(10);
    expect(recorded).toHaveLength(10);
    expect((await pulse.state(withCondition)).waiting).toBe(12);
    pulse.stop();

    // Over the spending limit: no check, no run, and the card says why.
    const held = fakePushed();
    const quiet = new Pulse({
      store: new WhenStore(await mkdtemp(join(tmpdir(), 'conch-pulse-'))),
      sources: { task: held.source },
      routines: async () => [withCondition],
      // The run itself is guarded where every run is (RoutineService.fire): it says why.
      fire: async () =>
        allow ? 'started' : { held: 'Paused: your routines have used this month’s $20.' },
      judge: async () => {
        checks++;
        return { verdict: 'yes' };
      },
      spend: { allow: async () => allow, record: () => undefined },
      beatMs: 60_000_000,
    });
    allow = false;
    await quiet.start();
    held.arrive(happening('later'));
    await quiet.beat();
    expect(checks).toBe(10);
    expect(await quiet.state(withCondition)).toMatchObject({ woke: 0, waiting: 1 });
    expect((await quiet.state(withCondition)).message).toMatch(/this month’s \$20/);
    quiet.stop();
  });
});
