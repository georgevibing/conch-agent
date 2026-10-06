import { describe, expect, it } from 'vitest';
import { darwinAvailableMemory, resourcePolicy } from './resources';

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
