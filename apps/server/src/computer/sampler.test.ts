import { ComputerStatus, type ComputerSample } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComputerSampler, helpersOf, type ComputerReaders } from './sampler';

const GiB = 1024 ** 3;

/** A pretend computer: every reading moves on by a known amount each look. */
function computer() {
  let looks = 0;
  const calls = { processes: 0, battery: 0 };
  const readers: ComputerReaders = {
    cpuTimes: () => [
      { busy: looks * 50, total: looks * 100 },
      { busy: 0, total: looks * 100 },
    ],
    resources: async () => ({ totalBytes: 16 * GiB, availableBytes: 4 * GiB, level: 'healthy' }),
    disk: async () => ({ totalBytes: 500 * GiB, usedBytes: 200 * GiB }),
    network: async () => ({ in: looks * 2000, out: looks * 500 }),
    graphics: async () => ({ name: 'Apple M3 Pro', percent: 9 }),
    temperature: async () => undefined,
    battery: async () => {
      calls.battery += 1;
      return { percent: 80, state: 'battery' as const };
    },
    processes: async () => {
      calls.processes += 1;
      return {
        rows: [{ pid: 10, ppid: 1, rssBytes: 1000, cpuSeconds: looks * 0.5, command: 'claude' }],
        family: new Map([[10, 'claude-code']]),
      };
    },
    conch: () => ({ cpuMicros: looks * 100_000, rssBytes: 2000 }),
    load: () => 1.234,
    info: async (gpu) => ({
      os: 'mac',
      system: 'macOS 26.1',
      processor: 'Apple M3 Pro',
      cores: 2,
      memoryBytes: 16 * GiB,
      ...(gpu?.name && { graphics: gpu.name }),
    }),
    uptime: () => 3600.4,
    conchUptime: () => 60,
  };
  return {
    readers,
    calls,
    advance: () => {
      looks += 1;
    },
  };
}

let sampler: ComputerSampler | undefined;
afterEach(() => {
  sampler?.stop();
  sampler = undefined;
  vi.useRealTimers();
});

describe('ComputerSampler', () => {
  it('looks only once someone asks, and stops soon after they leave', async () => {
    vi.useFakeTimers();
    const { readers, calls, advance } = computer();
    sampler = new ComputerSampler({
      home: '/tmp',
      intervalMs: 1000,
      idleMs: 5000,
      readers,
      now: () => Date.now(),
    });
    expect(sampler.running).toBe(false);
    expect(calls.processes).toBe(0);

    const first = sampler.status();
    // The baseline, then a first look soon after.
    await vi.advanceTimersByTimeAsync(0);
    advance();
    await vi.advanceTimersByTimeAsync(400);
    const status = await first;
    expect(sampler.running).toBe(true);
    expect(ComputerStatus.parse(status)).toBeTruthy();
    expect(status.samples).toHaveLength(1);
    expect(status.info).toMatchObject({ graphics: 'Apple M3 Pro', cores: 2 });
    expect(status.uptimeSeconds).toBe(3600);

    // Nobody asks again: after the idle time it stops and lets the history go.
    for (let i = 0; i < 7; i++) {
      advance();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(sampler.running).toBe(false);
    const looked = calls.processes;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.processes).toBe(looked);
  });

  it('turns readings into rates and shares between looks', async () => {
    const { readers, advance } = computer();
    let now = 1_000_000;
    sampler = new ComputerSampler({ home: '/tmp', intervalMs: 60_000, readers, now: () => now });
    const asking = sampler.status();
    advance();
    now += 2000;
    const { samples } = await asking;
    expect(samples).toHaveLength(1);
    const sample = samples[0] as ComputerSample;
    // Core 0 busy half the time, core 1 idle.
    expect(sample.cpu).toBe(25);
    expect(sample.cores).toEqual([50, 0]);
    expect(sample.memory).toEqual({ totalBytes: 16 * GiB, usedBytes: 12 * GiB });
    // 2000 bytes in and 500 out over two seconds.
    expect(sample.network).toEqual({ inPerSecond: 1000, outPerSecond: 250 });
    // 0.1 s of Conch's time over two seconds on two cores: 2.5% of the computer.
    expect(sample.conch).toEqual({ cpu: 2.5, memoryBytes: 2000 });
    expect(sample.helpers).toEqual([
      { id: 'claude-code', label: 'Claude Code', processes: 1, cpu: 12.5, memoryBytes: 1000 },
    ]);
    expect(sample.load).toBe(1.23);
    expect(sample.graphics).toEqual({ percent: 9 });
    expect(sample.battery).toEqual({ percent: 80, state: 'battery' });
    expect(sample.room).toBe('healthy');
  });

  it('keeps only the last few minutes, and the battery is read now and then', async () => {
    const { readers, calls, advance } = computer();
    let now = 0;
    sampler = new ComputerSampler({
      home: '/tmp',
      intervalMs: 60_000,
      keepMs: 10_000,
      readers,
      now: () => now,
    });
    await sampler.status();
    for (let i = 0; i < 20; i++) {
      advance();
      now += 1000;
      await sampler.tick();
    }
    const { samples } = await sampler.status();
    expect(samples.length).toBeLessThanOrEqual(11);
    expect((samples.at(-1)?.at ?? 0) - (samples[0]?.at ?? 0)).toBeLessThanOrEqual(10_000);
    expect(calls.battery).toBeLessThanOrEqual(2);
  });

  it('leaves out what this computer can’t tell, and carries on when a reader fails', async () => {
    const { readers } = computer();
    sampler = new ComputerSampler({
      home: '/tmp',
      intervalMs: 60_000,
      readers: {
        ...readers,
        network: async () => undefined,
        graphics: async () => {
          throw new Error('no GPU here');
        },
        battery: async () => undefined,
        processes: async () => undefined,
        load: () => undefined,
      },
    });
    const { samples, info } = await sampler.status();
    const sample = samples[0] as ComputerSample;
    expect(sample).not.toHaveProperty('network');
    expect(sample).not.toHaveProperty('graphics');
    expect(sample).not.toHaveProperty('battery');
    expect(sample).not.toHaveProperty('helpers');
    expect(sample).not.toHaveProperty('load');
    expect(info).not.toHaveProperty('graphics');
  });

  it('shares one start between people asking at once', async () => {
    const { readers, calls } = computer();
    sampler = new ComputerSampler({ home: '/tmp', intervalMs: 60_000, readers });
    await Promise.all([sampler.status(), sampler.status(), sampler.status()]);
    // One baseline and one first look.
    expect(calls.processes).toBe(2);
  });
});

describe('helpersOf', () => {
  it('keeps a fixed order and counts a new process’s time since it started', () => {
    const rows = [
      { pid: 1, ppid: 0, rssBytes: 10, cpuSeconds: 4, command: 'sh' },
      { pid: 2, ppid: 0, rssBytes: 20, cpuSeconds: 3, command: 'chrome' },
      { pid: 3, ppid: 0, rssBytes: 30, cpuSeconds: 1, command: 'codex' },
    ];
    const family = new Map([
      [1, 'other'],
      [2, 'browser'],
      [3, 'codex-cli'],
    ]);
    const before = new Map([
      [1, 3],
      [2, 3],
    ]);
    const helpers = helpersOf({ rows, family }, before, (s) => s * 10);
    expect(helpers.map((h) => [h.id, h.cpu])).toEqual([
      ['codex-cli', 10],
      ['browser', 0],
      ['other', 10],
    ]);
  });
});
