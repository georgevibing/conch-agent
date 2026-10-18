import type * as Os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', async (original) => ({
  ...(await original<typeof Os>()),
  totalmem: () => 16 * 1024 ** 3,
  freemem: () => 2 * 1024 ** 3,
  availableParallelism: () => 8,
  loadavg: () => [0, 0, 0],
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    if (path === '/proc/meminfo') return 'MemAvailable: 6291456 kB\n';
    if (path === '/proc/pressure/memory') return 'full avg10=0.00 avg60=0.00\n';
    throw new Error('Unexpected read');
  }),
}));
vi.mock('./cgroup', () => ({ cgroupMemory: vi.fn() }));

import { cgroupMemory } from './cgroup';
import { sampleResources } from './resources';

const GiB = 1024 ** 3;
afterEach(() => vi.restoreAllMocks());

describe.skipIf(process.platform !== 'linux')('machine memory and admission memory', () => {
  it('keeps reclaimable host RAM while enforcing an exhausted ancestor budget', async () => {
    vi.spyOn(process, 'constrainedMemory').mockReturnValue(0);
    vi.spyOn(process, 'availableMemory').mockReturnValue(6 * GiB);
    vi.mocked(cgroupMemory).mockResolvedValue({ limitBytes: 7 * GiB, availableBytes: 0 });
    expect(await sampleResources()).toMatchObject({
      hostMemory: { totalBytes: 16 * GiB, availableBytes: 6 * GiB },
      totalBytes: 7 * GiB,
      availableBytes: 0,
      level: 'critical',
      concurrency: 0,
    });
  });

  it('uses host RAM for admission too when there is no OS constraint', async () => {
    vi.spyOn(process, 'constrainedMemory').mockReturnValue(0);
    vi.mocked(cgroupMemory).mockResolvedValue({});
    expect(await sampleResources()).toMatchObject({
      hostMemory: { totalBytes: 16 * GiB, availableBytes: 6 * GiB },
      totalBytes: 16 * GiB,
      availableBytes: 6 * GiB,
      level: 'healthy',
      concurrency: 4,
    });
  });

  it('retains the machine reading when a failed cgroup check safely holds admission', async () => {
    vi.spyOn(process, 'constrainedMemory').mockReturnValue(0);
    vi.mocked(cgroupMemory).mockRejectedValue(new Error('unreadable hierarchy'));
    expect(await sampleResources()).toMatchObject({
      hostMemory: { totalBytes: 16 * GiB, availableBytes: 6 * GiB },
      availableBytes: 0,
      level: 'critical',
      concurrency: 0,
    });
  });
});
