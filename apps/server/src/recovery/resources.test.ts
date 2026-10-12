import { describe, expect, it } from 'vitest';
import {
  cpuSeconds,
  darwinAvailableMemory,
  procCpuSeconds,
  processRows,
  resourcePolicy,
  sampleTrees,
  treeUsage,
} from './resources';

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
  it('reads ps CPU time as Linux and macOS print it', () => {
    expect(cpuSeconds('00:01:23')).toBe(83);
    expect(cpuSeconds('1-02:03:04')).toBe(93_784);
    expect(cpuSeconds('0:01.25')).toBe(1.25);
    expect(cpuSeconds('932:09.94')).toBeCloseTo(55_929.94);
    for (const odd of ['', '12', 'a:b', '1:2:3:4', '-1:00'])
      expect(cpuSeconds(odd)).toBeUndefined();
  });
  it('reads a Linux stat line after the name, whatever the name holds', () => {
    const rest = 'R 1 2 3 4 5 6 7 8 9 10 250 50 0 0 20 0 1 0 100 999 42';
    expect(procCpuSeconds(`1234 (a) b (c) ${rest}`)).toBe(3);
    expect(procCpuSeconds('1234 (ok) R 1')).toBeUndefined();
    expect(procCpuSeconds('')).toBeUndefined();
  });
  it('sums each managed root with all its descendants and nothing else', () => {
    const before = processRows(
      ['  100     1  1000   0:00.00', '  101   100  2000   0:01.00'].join('\n'),
    );
    const after = processRows(
      [
        '    1     0  9000   9:00.00',
        '  100     1  1000   0:00.10',
        '  101   100  2000   0:01.20',
        '  102   101  3000   0:00.20',
        '  200     1   500   0:00.00',
        '  201   200 99999   0:00.50',
        '  300     1  7000   0:05.00',
        'garbage line',
        '',
      ].join('\n'),
    );
    const usage = treeUsage(before, after, [100, 200, 404], 1000);
    // 0.1 + 0.2 + 0.2 (102 started in between) seconds of CPU over one second.
    expect(usage.get(100)?.rssBytes).toBe(6000 * 1024);
    expect(usage.get(100)?.cpuPercent).toBeCloseTo(50);
    expect(usage.get(200)).toEqual({ rssBytes: 100_499 * 1024, cpuPercent: 50 });
    // A root that is gone isn't measured, and other host processes are never counted.
    expect(usage.has(404)).toBe(false);
    expect(usage.size).toBe(2);
  });
  it('weighs what a job uses now, not what it once used', () => {
    // An older build that spent an hour of CPU and now waits, and a job spinning now.
    const before = processRows('10 1 1000 60:00.00\n20 1 1000 0:01.00');
    const after = processRows('10 1 1000 60:00.00\n20 1 1000 0:01.50');
    const usage = treeUsage(before, after, [10, 20], 500);
    expect(usage.get(10)?.cpuPercent).toBe(0);
    expect(usage.get(20)?.cpuPercent).toBeCloseTo(100);
  });
  it('counts no CPU for a process it could not read the first time', () => {
    const before = processRows('10 1 100 0:00.00');
    const after = processRows('10 1 100 0:09.00');
    before.set(10, { parent: 1, rssBytes: 100, cpuSeconds: NaN });
    expect(treeUsage(before, after, [10], 1000).get(10)?.cpuPercent).toBe(0);
  });
  it('survives a parent loop without counting a process twice', () => {
    const rows = processRows('10 11 100 0:01.00\n11 10 200 0:02.00');
    const usage = treeUsage(new Map(), rows, [10], 1000);
    expect(usage.get(10)).toEqual({ rssBytes: 300 * 1024, cpuPercent: 300 });
  });
  it.skipIf(process.platform === 'win32')(
    'sees this process using CPU while it spins',
    async () => {
      const spin = setInterval(() => {
        const until = performance.now() + 15;
        while (performance.now() < until);
      }, 20);
      try {
        const usage = await sampleTrees([process.pid], 300);
        expect(usage.get(process.pid)?.rssBytes).toBeGreaterThan(0);
        expect(usage.get(process.pid)?.cpuPercent).toBeGreaterThan(20);
      } finally {
        clearInterval(spin);
      }
    },
  );
});
