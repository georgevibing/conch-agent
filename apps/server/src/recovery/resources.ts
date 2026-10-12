import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { availableParallelism, freemem, loadavg, totalmem } from 'node:os';
import { cgroupMemory, type CgroupMemory } from './cgroup';

export interface ResourceSnapshot {
  at: number;
  totalBytes: number;
  availableBytes: number;
  cpuCount: number;
  loadPerCpu: number;
  memoryPressure: number | null;
  cgroupMemoryLimitBytes?: number;
  cgroupMemoryAvailableBytes?: number;
  level: 'healthy' | 'busy' | 'critical';
  concurrency: number;
  reason: string;
}

const execute = promisify(execFile);
const MiB = 1024 * 1024;
export const memoryReserve = (totalBytes: number) =>
  Math.min(1024 * MiB, Math.max(256 * MiB, totalBytes * 0.1));

/** Pure admission policy: reserve memory and a CPU for the gateway, cap unknown jobs. */
export function resourcePolicy(
  input: Omit<ResourceSnapshot, 'level' | 'concurrency' | 'reason'>,
): ResourceSnapshot {
  const reserve = memoryReserve(input.totalBytes);
  const critical = input.availableBytes < reserve / 2 || (input.memoryPressure ?? 0) >= 20;
  const busy =
    critical ||
    input.availableBytes < reserve ||
    input.loadPerCpu >= 1.5 ||
    (input.memoryPressure ?? 0) >= 5;
  const capacity = Math.min(
    4,
    Math.max(1, input.cpuCount - 1),
    Math.max(1, Math.floor((input.availableBytes - reserve) / (512 * MiB))),
  );
  return {
    ...input,
    level: critical ? 'critical' : busy ? 'busy' : 'healthy',
    concurrency: busy ? 0 : capacity,
    reason: critical
      ? 'Waiting for memory to recover so Conch stays responsive.'
      : busy
        ? 'Waiting for this computer to have room for more work.'
        : 'This computer has room for managed work.',
  };
}

/** vm_stat includes reclaimable caches omitted by older Node releases on macOS. */
export function darwinAvailableMemory(text: string): number | undefined {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const counts = ['free', 'inactive', 'purgeable'].map((kind) =>
    Number(new RegExp(`^Pages ${kind}:\\s+(\\d+)\\.`, 'm').exec(text)?.[1]),
  );
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize <= 0 ||
    counts.some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    return;
  const bytes = counts.reduce((sum, value) => sum + value, 0) * pageSize;
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

/** Linux available memory includes reclaimable caches. PSI catches swap thrashing.
 * Unsupported hosts use Node's portable memory/load readings. Never reads job data. */
export async function sampleResources(): Promise<ResourceSnapshot> {
  let availableBytes = freemem();
  let memoryPressure: number | null = null;
  let cgroup: CgroupMemory = {};
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execute('/usr/bin/vm_stat', [], {
        timeout: 1000,
        maxBuffer: 16_384,
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      });
      availableBytes = darwinAvailableMemory(stdout) ?? process.availableMemory();
    } catch {
      availableBytes = process.availableMemory();
    }
  }
  if (process.platform === 'linux') {
    const [memory, pressure, group] = await Promise.allSettled([
      readFile('/proc/meminfo', { encoding: 'utf8', signal: AbortSignal.timeout(1_000) }),
      readFile('/proc/pressure/memory', { encoding: 'utf8', signal: AbortSignal.timeout(1_000) }),
      cgroupMemory(),
    ]);
    if (memory.status === 'fulfilled') {
      const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(memory.value);
      if (match) availableBytes = Number(match[1]) * 1024;
    }
    if (pressure.status === 'fulfilled') {
      const match = /^full avg10=([\d.]+)/m.exec(pressure.value);
      if (match) memoryPressure = Number(match[1]);
    }
    if (group.status === 'fulfilled') cgroup = group.value;
    else availableBytes = 0;
    if (cgroup.availableBytes !== undefined)
      availableBytes = Math.min(availableBytes, cgroup.availableBytes);
    if (cgroup.pressure !== undefined)
      memoryPressure = Math.max(memoryPressure ?? 0, cgroup.pressure);
  }
  // libuv accounts for cgroup limits; host-wide free memory alone over-admits
  // work inside a container. Zero means no discoverable constraint.
  const constrained = process.constrainedMemory();
  const totalBytes = Math.min(
    totalmem(),
    constrained > 0 ? constrained : Infinity,
    cgroup.limitBytes ?? Infinity,
  );
  if (totalBytes < totalmem()) availableBytes = Math.min(availableBytes, process.availableMemory());
  const cpuCount = availableParallelism();
  return resourcePolicy({
    at: Date.now(),
    totalBytes,
    availableBytes,
    cpuCount,
    loadPerCpu: (loadavg()[0] ?? 0) / cpuCount,
    memoryPressure,
    ...(cgroup.limitBytes !== undefined && { cgroupMemoryLimitBytes: cgroup.limitBytes }),
    ...(cgroup.availableBytes !== undefined && {
      cgroupMemoryAvailableBytes: cgroup.availableBytes,
    }),
  });
}

/** What one managed job's whole process tree uses now. */
export interface TreeUsage {
  rssBytes: number;
  cpuPercent: number;
}

/**
 * Sums `ps -o pid=,ppid=,rss=,pcpu=` rows over each root's descendants, by
 * parent links rather than process group, so a sandbox that starts its own
 * session still counts. Roots missing from the listing are left out.
 */
export function treeUsage(text: string, roots: readonly number[]): Map<number, TreeUsage> {
  const children = new Map<number, number[]>();
  const own = new Map<number, TreeUsage>();
  for (const line of text.split('\n')) {
    const [pid = NaN, parent = NaN, rss = NaN, cpu = NaN] = line.trim().split(/\s+/).map(Number);
    if (
      !Number.isSafeInteger(pid) ||
      !Number.isSafeInteger(parent) ||
      !Number.isFinite(rss) ||
      !Number.isFinite(cpu)
    )
      continue;
    own.set(pid, { rssBytes: Math.max(0, rss) * 1024, cpuPercent: Math.max(0, cpu) });
    const siblings = children.get(parent);
    if (siblings) siblings.push(pid);
    else children.set(parent, [pid]);
  }
  const usage = new Map<number, TreeUsage>();
  for (const root of roots) {
    if (!own.has(root)) continue;
    const total = { rssBytes: 0, cpuPercent: 0 };
    const seen = new Set<number>();
    const next = [root];
    for (let pid = next.pop(); pid !== undefined; pid = next.pop()) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const row = own.get(pid);
      if (row) {
        total.rssBytes += row.rssBytes;
        total.cpuPercent += row.cpuPercent;
      }
      next.push(...(children.get(pid) ?? []));
    }
    usage.set(root, total);
  }
  return usage;
}

/** One bounded `ps` of the process table: ids and resource columns only, never commands. */
export async function sampleTrees(roots: readonly number[]): Promise<Map<number, TreeUsage>> {
  if (process.platform === 'win32' || !roots.length) return new Map();
  const { stdout } = await execute('ps', ['-A', '-o', 'pid=,ppid=,rss=,pcpu='], {
    timeout: 1000,
    maxBuffer: 4 * MiB,
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
  });
  return treeUsage(stdout, roots);
}
