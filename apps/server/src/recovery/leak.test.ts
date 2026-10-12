import { describe, expect, it, vi } from 'vitest';

import {
  floors,
  LEAK_DEFAULTS,
  LEAK_NOTE,
  LeakWatch,
  leakVerdict,
  robustSlope,
  type MemorySample,
} from './leak';

const MiB = 1024 * 1024;
const MINUTE = 60_000;
const limits = { heapBytes: 4096 * MiB };

/** A sawtooth like a real heap: climbs between collections, drops back to its floor. */
function heap(minutes: number, floorAt: (minute: number) => number): MemorySample[] {
  return Array.from({ length: minutes + 1 }, (_, minute) => ({
    at: minute * MINUTE,
    heapUsedBytes: floorAt(minute) + ((minute * 7) % 5) * 60 * MiB,
    rssBytes: 300 * MiB,
  }));
}

describe('memory trend', () => {
  it('fits the floor of each slice, not the spikes between collections', () => {
    const points = [0, 1, 2, 3, 4, 5, 6, 7].map((minute) => ({
      at: minute * MINUTE,
      value: minute % 2 ? 900 : 100 + minute,
    }));
    expect(floors(points, 4).map((p) => p.value)).toEqual([100, 102, 104, 106]);
    expect(robustSlope(floors(points, 4))).toBeCloseTo(1 / MINUTE);
  });

  it("isn't tilted by one odd reading", () => {
    const points = [0, 1, 2, 3, 4, 5].map((minute) => ({
      at: minute,
      value: minute === 2 ? 10_000 : 10,
    }));
    expect(robustSlope(points)).toBe(0);
  });

  it('calls steady usage steady, however noisy', () => {
    expect(
      leakVerdict(
        heap(60, () => 1500 * MiB),
        limits,
      ),
    ).toEqual({ leak: false });
  });

  it('calls a climb that reaches 90% within the horizon a leak', () => {
    // 30 MiB a minute from 1.5 GiB: 3.3 GiB after an hour, past 3.6 GiB in the next half hour.
    const verdict = leakVerdict(
      heap(60, (m) => 1500 * MiB + m * 30 * MiB),
      limits,
    );
    expect(verdict).toMatchObject({ leak: true, measure: 'heap', cause: 'growing' });
  });

  it("doesn't call slow growth a leak when the limit is far off", () => {
    expect(
      leakVerdict(
        heap(60, (m) => 1000 * MiB + m * MiB),
        limits,
      ),
    ).toEqual({ leak: false });
  });

  it('calls usage already above 85% a leak even when flat', () => {
    expect(
      leakVerdict(
        heap(30, () => 3600 * MiB),
        limits,
      ),
    ).toMatchObject({
      leak: true,
      cause: 'high',
    });
  });

  it('waits for enough history before judging', () => {
    expect(
      leakVerdict(
        heap(10, (m) => 1500 * MiB + m * 200 * MiB),
        limits,
      ),
    ).toEqual({
      leak: false,
    });
  });

  it('measures resident memory against the cgroup limit when there is one', () => {
    const samples = heap(60, () => 500 * MiB).map((s, minute) => ({
      ...s,
      rssBytes: 600 * MiB + minute * 8 * MiB,
    }));
    expect(leakVerdict(samples, limits)).toEqual({ leak: false });
    expect(leakVerdict(samples, { ...limits, rssBytes: 1300 * MiB })).toMatchObject({
      leak: true,
      measure: 'rss',
    });
  });
});

function watch(over: { busy?: () => boolean; held?: () => boolean; supervised?: boolean } = {}) {
  let now = 0;
  let floor = 1500 * MiB;
  let growth = 0;
  const restart = vi.fn(() => true);
  const note = vi.fn();
  const leak = new LeakWatch({
    busy: over.busy ?? (() => false),
    held: over.held ?? (() => false),
    supervised: () => over.supervised ?? true,
    restart,
    note,
    now: () => now,
    sample: () => ({
      at: now,
      heapUsedBytes: floor + ((now / MINUTE) % 3) * 40 * MiB,
      rssBytes: 0,
    }),
    limits: async () => limits,
  });
  const minutes = async (count: number) => {
    for (let i = 0; i < count; i++) {
      now += MINUTE;
      floor += growth;
      await leak.tick();
    }
  };
  return {
    leak,
    restart,
    note,
    minutes,
    leaking: (perMinute: number) => {
      growth = perMinute;
    },
  };
}

describe('planned restart for a leak', () => {
  it('never restarts for steady usage', async () => {
    const { restart, minutes } = watch();
    await minutes(180);
    expect(restart).not.toHaveBeenCalled();
  });

  it('restarts once, when idle, and says so', async () => {
    const { restart, note, minutes, leaking, leak } = watch();
    leaking(30 * MiB);
    await minutes(LEAK_DEFAULTS.minimumSpanMs / MINUTE + 40);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledWith(LEAK_NOTE);
    expect(leak.requested).toBe(true);
    await minutes(60);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('waits while something is working, then restarts once it stops', async () => {
    let busy = true;
    const { restart, minutes, leaking } = watch({ busy: () => busy });
    leaking(30 * MiB);
    await minutes(50);
    expect(restart).not.toHaveBeenCalled();
    busy = false;
    await minutes(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('waits out recovery mode', async () => {
    let held = true;
    const { restart, minutes, leaking } = watch({ held: () => held });
    leaking(30 * MiB);
    await minutes(50);
    expect(restart).not.toHaveBeenCalled();
    held = false;
    await minutes(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('never restarts without the supervisor', async () => {
    const { restart, minutes, leaking } = watch({ supervised: false });
    leaking(30 * MiB);
    await minutes(60);
    expect(restart).not.toHaveBeenCalled();
  });

  it("backs off while another restart is still in the supervisor's budget", async () => {
    let recent = 1;
    const restart = vi.fn(() => true);
    let now = 0;
    const leak = new LeakWatch({
      busy: () => false,
      held: () => false,
      supervised: () => true,
      recentRestarts: () => recent,
      restart,
      note: () => undefined,
      now: () => now,
      sample: () => ({ at: now, heapUsedBytes: 3800 * MiB, rssBytes: 0 }),
      limits: async () => limits,
    });
    for (let i = 0; i < 30; i++) {
      now += MINUTE;
      await leak.tick();
    }
    expect(restart).not.toHaveBeenCalled();
    recent = 0;
    now += MINUTE;
    await leak.tick();
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('asks only once even when the restart is refused', async () => {
    const { restart, note, minutes, leaking } = watch();
    restart.mockReturnValue(false);
    leaking(30 * MiB);
    await minutes(90);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(note).not.toHaveBeenCalled();
  });
});
