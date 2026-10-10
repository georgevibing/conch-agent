import { describe, expect, it } from 'vitest';
import { admitsPlanned, ResourcePace, paceMessage } from './pace';
import { resourcePolicy, type ResourceSnapshot } from './resources';

const GiB = 1024 ** 3;
const sample = (over: Partial<ResourceSnapshot> = {}) =>
  resourcePolicy({
    at: 0,
    totalBytes: 16 * GiB,
    availableBytes: 8 * GiB,
    cpuCount: 8,
    loadPerCpu: 0,
    memoryPressure: 0,
    ...over,
  });
function setup() {
  let now = 0;
  const pace = new ResourcePace(() => now);
  const observe = (value = sample(), ms = 5000) => {
    now += ms;
    return pace.observe(value);
  };
  return {
    pace,
    observe,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('shared workload pacing', () => {
  it('warns before the hard admission threshold and scales to small machines', () => {
    const { observe } = setup();
    expect(observe()).toMatchObject({ phase: 'normal', concurrency: 4 });
    expect(observe(sample({ availableBytes: 1.8 * GiB }))).toMatchObject({
      phase: 'constrained',
      cause: 'memory',
      concurrency: 1,
    });
    expect(observe(sample({ totalBytes: GiB, availableBytes: 0.45 * GiB }))).toMatchObject({
      phase: 'constrained',
      concurrency: 1,
    });
    expect(observe(sample({ availableBytes: 0.7 * GiB }))).toMatchObject({
      phase: 'held',
      concurrency: 0,
    });
    expect(observe(sample({ availableBytes: 0.1 * GiB }))).toMatchObject({
      phase: 'held',
      critical: true,
    });
  });
  it('uses CPU and memory stalls as independent early signals', () => {
    const { observe } = setup();
    expect(observe(sample({ loadPerCpu: 1.1 }))).toMatchObject({
      phase: 'constrained',
      cause: 'cpu',
      concurrency: 1,
    });
    expect(observe(sample({ memoryPressure: 3 }))).toMatchObject({
      phase: 'constrained',
      cause: 'memory',
    });
  });
  it('requires sustained headroom then adds only one slot every ten seconds', () => {
    const { observe } = setup();
    observe(sample({ availableBytes: 0.1 * GiB }));
    expect(observe()).toMatchObject({ phase: 'recovering', concurrency: 0 });
    for (let i = 0; i < 5; i++) expect(observe().concurrency).toBe(0);
    expect(observe()).toMatchObject({ phase: 'recovering', concurrency: 1 });
    expect(observe().concurrency).toBe(1);
    expect(observe().concurrency).toBe(2);
    expect(observe(sample(), 10_000).concurrency).toBe(3);
    expect(observe(sample(), 10_000)).toMatchObject({ phase: 'normal', concurrency: 4 });
  });
  it('does not oscillate back to full speed when readings hover near a threshold', () => {
    const { observe } = setup();
    for (let i = 0; i < 8; i++) {
      expect(observe(sample({ loadPerCpu: 1.01 })).concurrency).toBe(1);
      expect(observe(sample({ loadPerCpu: 0.99 })).concurrency).toBe(1);
    }
  });
  it('renews pressure immediately while recovering', () => {
    const { observe } = setup();
    observe(sample({ memoryPressure: 6 }));
    for (let i = 0; i < 9; i++) observe();
    expect(observe().concurrency).toBe(2);
    expect(observe(sample({ memoryPressure: 22 }))).toMatchObject({
      phase: 'held',
      concurrency: 0,
      critical: true,
    });
    expect(observe().concurrency).toBe(0);
  });
  it('does not treat sleep, backwards clocks or stale data as proof of recovery', () => {
    const { pace, observe, advance } = setup();
    observe();
    advance(16_000);
    expect(pace.current).toMatchObject({ phase: 'held', cause: 'unknown', concurrency: 0 });
    expect(observe()).toMatchObject({ phase: 'recovering', concurrency: 0 });
    expect(observe(sample(), 60_000).concurrency).toBe(0);
    expect(observe(sample(), -1000).concurrency).toBe(0);
  });
  it('fails closed on invalid readings and never grants more than the measured budget', () => {
    const { pace, observe } = setup();
    expect(pace.current.concurrency).toBe(0);
    expect(observe(sample({ availableBytes: NaN })).concurrency).toBe(0);
    for (let i = 0; i < 20; i++) observe(sample({ cpuCount: 2 }));
    expect(pace.current).toMatchObject({ phase: 'normal', concurrency: 1 });
  });
  it('keeps untrusted sampler words out of agent notices', () => {
    const { pace } = setup();
    const value = pace.observe({
      ...sample({ availableBytes: 0.1 * GiB }),
      reason: 'LEAK PRIVATE DATA',
    });
    expect(paceMessage(value)).not.toContain('PRIVATE');
    expect(paceMessage(value)).toContain('approvals');
  });
});

describe('work the person asked for just now', () => {
  it('goes on when all is normal and while the processor is busy, never short of memory or recovering', () => {
    const { pace, observe } = setup();
    observe();
    // A healthy pace says cause "recovery": it's the phase that counts.
    expect(pace.current).toMatchObject({ phase: 'normal', cause: 'recovery' });
    expect(admitsPlanned(pace.current)).toBe(true);
    observe(sample({ loadPerCpu: 1.2 }));
    expect(pace.current.cause).toBe('cpu');
    expect(admitsPlanned(pace.current)).toBe(true);
    observe(sample({ availableBytes: 1 * GiB }));
    expect(admitsPlanned(pace.current)).toBe(false);
    expect(
      admitsPlanned({ phase: 'held', cause: 'recovery', concurrency: 0, critical: false }),
    ).toBe(false);
    expect(
      admitsPlanned({ phase: 'recovering', cause: 'recovery', concurrency: 1, critical: false }),
    ).toBe(false);
  });
});
