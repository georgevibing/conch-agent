import { describe, expect, it } from 'vitest';
import { darwinAvailableMemory, resourcePolicy, treeUsage } from './resources';

const baseline = {
  at: 0,
  totalBytes: 16 * 1024 ** 3,
  availableBytes: 8 * 1024 ** 3,
  cpuCount: 8,
  loadPerCpu: 0.5,
  memoryPressure: null,
};

describe('resource admission', () => {
  it('caps unknown workloads and leaves a CPU free when possible', () => {
    expect(resourcePolicy(baseline)).toMatchObject({ level: 'healthy', concurrency: 4 });
    expect(resourcePolicy({ ...baseline, cpuCount: 2 }).concurrency).toBe(1);
    expect(resourcePolicy({ ...baseline, cpuCount: 1 }).concurrency).toBe(1);
  });
  it('reserves memory before admitting work and scales to small machines', () => {
    expect(resourcePolicy({ ...baseline, availableBytes: 1400 * 1024 ** 2 }).concurrency).toBe(1);
    expect(resourcePolicy({ ...baseline, availableBytes: 800 * 1024 ** 2 })).toMatchObject({
      concurrency: 0,
      level: 'busy',
    });
    expect(resourcePolicy({ ...baseline, availableBytes: 200 * 1024 ** 2 })).toMatchObject({
      concurrency: 0,
      level: 'critical',
    });
    expect(
      resourcePolicy({ ...baseline, totalBytes: 1024 ** 3, availableBytes: 600 * 1024 ** 2 })
        .concurrency,
    ).toBe(1);
  });
  it('distinguishes CPU congestion from dangerous memory thrashing', () => {
    expect(resourcePolicy({ ...baseline, loadPerCpu: 3 })).toMatchObject({
      concurrency: 0,
      level: 'busy',
    });
    expect(resourcePolicy({ ...baseline, memoryPressure: 6 })).toMatchObject({
      concurrency: 0,
      level: 'busy',
    });
    expect(resourcePolicy({ ...baseline, memoryPressure: 25 })).toMatchObject({
      concurrency: 0,
      level: 'critical',
    });
  });
});

describe('macOS reclaimable memory', () => {
  it('counts inactive and purgeable pages rather than treating cache as memory exhaustion', () => {
    expect(
      darwinAvailableMemory(`Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                1000.
Pages inactive:                          200000.
Pages purgeable:                          10000.
Pages wired down:                        500000.
`),
    ).toBe(211000 * 16384);
  });
  it('rejects truncated or unfamiliar output instead of inventing headroom', () => {
    expect(darwinAvailableMemory('Pages free: 1000.')).toBeUndefined();
    expect(
      darwinAvailableMemory('page size of 16384 bytes\nPages free: 1.\nPages inactive: 2.'),
    ).toBeUndefined();
  });
});

describe('process tree usage', () => {
  it('sums each managed root with all its descendants and nothing else', () => {
    const ps = [
      '    1     0  9000  50.0',
      '  100     1  1000   1.0',
      '  101   100  2000  20.5',
      '  102   101  3000   3.5',
      '  200     1   500   0.0',
      '  201   200 99999  99.0',
      '  300     1  7000  70.0',
      'garbage line',
      '',
    ].join('\n');
    const usage = treeUsage(ps, [100, 200, 404]);
    expect(usage.get(100)).toEqual({ rssBytes: 6000 * 1024, cpuPercent: 25 });
    expect(usage.get(200)).toEqual({ rssBytes: 100_499 * 1024, cpuPercent: 99 });
    // A root that is gone isn't measured, and other host processes are never counted.
    expect(usage.has(404)).toBe(false);
    expect(usage.size).toBe(2);
  });
  it('survives a parent loop without counting a process twice', () => {
    const usage = treeUsage('10 11 100 1\n11 10 200 2', [10]);
    expect(usage.get(10)).toEqual({ rssBytes: 300 * 1024, cpuPercent: 3 });
  });
});
