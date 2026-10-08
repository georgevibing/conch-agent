import { describe, expect, it } from 'vitest';
import { cgroupFolders, cgroupMemory } from './cgroup';
import { resourcePolicy } from './resources';

const mounts = '29 23 0:26 / /sys/fs/cgroup rw - cgroup2 cgroup rw';
const root = '/sys/fs/cgroup';
const GiB = 1024 ** 3;
const baseline = {
  at: 0,
  totalBytes: 16 * GiB,
  availableBytes: 4 * GiB,
  cpuCount: 4,
  loadPerCpu: 0.1,
  memoryPressure: 0,
};
function fixture(files: Record<string, string>) {
  return async (path: string) => {
    if (path === '/proc/self/cgroup') return '0::/app.slice/conch.service\n';
    if (path === '/proc/self/mountinfo') return mounts;
    const value = files[path.replace(root, '')];
    if (value === undefined) throw new Error('ENOENT');
    return value;
  };
}

describe('hierarchical Linux memory budgets', () => {
  it('reproduces the incident: a parent throttle is full while host and leaf look free', async () => {
    const reading = await cgroupMemory(
      fixture({
        '/app.slice/conch.service/memory.current': String(0.5 * GiB),
        '/app.slice/conch.service/memory.high': 'max',
        '/app.slice/conch.service/memory.max': 'max',
        '/app.slice/memory.current': String(Math.floor(7.1 * GiB)),
        '/app.slice/memory.high': String(7 * GiB),
        '/app.slice/memory.max': String(7.5 * GiB),
      }),
    );
    expect(reading.limitBytes).toBe(7 * GiB);
    expect(reading).toMatchObject({ limitBytes: 7 * GiB, availableBytes: 0 });
    expect(
      resourcePolicy({
        ...baseline,
        totalBytes: reading.limitBytes ?? baseline.totalBytes,
        availableBytes: reading.availableBytes ?? baseline.availableBytes,
      }),
    ).toMatchObject({ level: 'critical', concurrency: 0 });
  });

  it('uses the tightest remaining budget including siblings at each ancestor', async () => {
    expect(
      await cgroupMemory(
        fixture({
          '/app.slice/conch.service/memory.current': String(GiB),
          '/app.slice/conch.service/memory.max': String(4 * GiB),
          '/app.slice/memory.current': String(7.25 * GiB),
          '/app.slice/memory.high': String(7.5 * GiB),
          '/memory.current': String(10 * GiB),
          '/memory.max': String(12 * GiB),
          '/app.slice/memory.pressure': 'some avg10=60.00 avg60=0\nfull avg10=42.00 avg60=0',
        }),
      ),
    ).toEqual({ limitBytes: 4 * GiB, availableBytes: GiB / 4, pressure: 42 });
  });

  it('recovers admission when pressure and usage fall without changing OS limits', async () => {
    const files = {
      '/app.slice/memory.current': String(7 * GiB),
      '/app.slice/memory.high': String(7 * GiB),
    };
    expect((await cgroupMemory(fixture(files))).availableBytes).toBe(0);
    files['/app.slice/memory.current'] = String(4 * GiB);
    expect((await cgroupMemory(fixture(files))).availableBytes).toBe(3 * GiB);
  });

  it('fails closed for unreadable usage under a known limit and handles absent controllers', async () => {
    expect(await cgroupMemory(fixture({ '/app.slice/memory.high': '1024' }))).toEqual({
      limitBytes: 1024,
      availableBytes: 0,
    });
    expect(await cgroupMemory(fixture({}))).toEqual({});
    expect(
      await cgroupMemory(async () => {
        throw new Error('unsupported');
      }),
    ).toEqual({});
  });

  it('finds relocated and namespaced mounts without escaping them', () => {
    expect(cgroupFolders('0::/app.slice/conch.service', mounts)).toEqual([
      root + '/app.slice/conch.service',
      root + '/app.slice',
      root,
    ]);
    expect(
      cgroupFolders(
        '0::/container/a',
        '1 2 0:3 /container /custom\\040group rw - cgroup2 cgroup rw',
      ),
    ).toEqual(['/custom group/a', '/custom group']);
    expect(
      cgroupFolders('0::/', '1 2 0:3 /container /sys/fs/cgroup rw - cgroup2 cgroup rw'),
    ).toEqual([root]);
    expect(cgroupFolders('0::/../../etc', mounts)).toEqual([]);
    expect(cgroupFolders('5:memory:/old', mounts)).toEqual([]);
  });
});
