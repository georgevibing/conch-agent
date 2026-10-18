import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { availableParallelism, freemem, loadavg, totalmem } from 'node:os';
import { cgroupMemory, type CgroupMemory } from './cgroup';

export interface ResourceSnapshot {
  at: number;
  totalBytes: number;
  availableBytes: number;
  /** Machine RAM before applying process or shared cgroup budgets. */
  hostMemory?: { totalBytes: number; availableBytes: number };
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
  let hostAvailableBytes = availableBytes;
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
    hostAvailableBytes = availableBytes;
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
    hostMemory: { totalBytes: totalmem(), availableBytes: hostAvailableBytes },
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

/** One process in a listing: ids and resource columns, never its command or name. */
export interface ProcessRow {
  parent: number;
  rssBytes: number;
  /** User and system CPU time it has used since it started; NaN when unreadable. */
  cpuSeconds: number;
}

/**
 * `ps`'s cumulative CPU time, `[[dd-]hh:]mm:ss[.cc]`: whole seconds on Linux,
 * hundredths on macOS, where minutes go past 59.
 */
export function cpuSeconds(time: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(time);
  if (!match) return;
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
}

/**
 * The CPU time in a Linux /proc/<pid>/stat line, in seconds at the kernel's fixed
 * 100 ticks a second. Read after the name's last closing parenthesis (the name may
 * hold one itself), and the name is never kept.
 */
export function procCpuSeconds(stat: string): number | undefined {
  const end = stat.lastIndexOf(')');
  if (end < 0) return;
  const fields = stat
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  // utime and stime: the 14th and 15th fields, counting pid and name.
  const ticks = Number(fields[11]) + Number(fields[12]);
  return Number.isSafeInteger(ticks) && ticks >= 0 ? ticks / 100 : undefined;
}

/** `ps -o pid=,ppid=,rss=,time=` rows, by pid. Anything else in the text is skipped. */
export function processRows(text: string): Map<number, ProcessRow> {
  const rows = new Map<number, ProcessRow>();
  for (const line of text.split('\n')) {
    const [pid, parent, rss, time = ''] = line.trim().split(/\s+/);
    const cpu = cpuSeconds(time);
    if (
      !Number.isSafeInteger(Number(pid)) ||
      !Number.isSafeInteger(Number(parent)) ||
      !Number.isFinite(Number(rss)) ||
      cpu === undefined
    )
      continue;
    rows.set(Number(pid), {
      parent: Number(parent),
      rssBytes: Math.max(0, Number(rss)) * 1024,
      cpuSeconds: cpu,
    });
  }
  return rows;
}

/** Each root in `rows`, with itself and all its descendants by parent links. */
function trees(rows: Map<number, ProcessRow>, roots: readonly number[]): Map<number, Set<number>> {
  const children = new Map<number, number[]>();
  for (const [pid, { parent }] of rows) {
    const siblings = children.get(parent);
    if (siblings) siblings.push(pid);
    else children.set(parent, [pid]);
  }
  const result = new Map<number, Set<number>>();
  for (const root of roots) {
    if (!rows.has(root)) continue;
    const seen = new Set<number>();
    const next = [root];
    for (let pid = next.pop(); pid !== undefined; pid = next.pop()) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      next.push(...(children.get(pid) ?? []));
    }
    result.set(root, seen);
  }
  return result;
}

/**
 * What each root's tree uses now: memory from the later listing, and CPU as the
 * time it used between the two over the time between them. Not `ps pcpu`, a
 * lifetime average on Linux, where a job busy an hour ago would outweigh the one
 * busy now. By parent links rather than process group, so a sandbox that starts
 * its own session still counts. Roots missing from the later listing are left out.
 */
export function treeUsage(
  before: Map<number, ProcessRow>,
  after: Map<number, ProcessRow>,
  roots: readonly number[],
  elapsedMs: number,
): Map<number, TreeUsage> {
  const usage = new Map<number, TreeUsage>();
  for (const [root, pids] of trees(after, roots)) {
    let rssBytes = 0;
    let spent = 0;
    for (const pid of pids) {
      const row = after.get(pid);
      if (!row) continue;
      rssBytes += row.rssBytes;
      // One that started in between (or a reused pid) used all its time in between;
      // one unreadable either time counts for none rather than for its whole life.
      const earlier = before.get(pid)?.cpuSeconds ?? 0;
      const since = row.cpuSeconds >= earlier ? row.cpuSeconds - earlier : row.cpuSeconds;
      if (Number.isFinite(since) && !Number.isNaN(earlier)) spent += since;
    }
    usage.set(root, {
      rssBytes,
      cpuPercent: elapsedMs > 0 ? (spent * 100_000) / elapsedMs : 0,
    });
  }
  return usage;
}

/** One bounded look at the process table: ids and resource columns only, never commands. */
async function listProcesses(roots: readonly number[]): Promise<Map<number, ProcessRow>> {
  const { stdout } = await execute('ps', ['-A', '-o', 'pid=,ppid=,rss=,time='], {
    timeout: 1000,
    maxBuffer: 4 * MiB,
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
  });
  const rows = processRows(stdout);
  if (process.platform === 'linux') {
    // ps counts whole seconds there: the kernel's ticks instead, for the trees' own processes.
    const signal = AbortSignal.timeout(1000);
    const pids = [...trees(rows, roots).values()].flatMap((tree) => [...tree]);
    await Promise.all(
      pids.map(async (pid) => {
        const stat = await readFile(`/proc/${pid}/stat`, { encoding: 'utf8', signal }).catch(
          () => '',
        );
        const row = rows.get(pid);
        if (row) row.cpuSeconds = procCpuSeconds(stat) ?? NaN;
      }),
    );
  }
  return rows;
}

/**
 * What each managed root's tree uses: two looks `intervalMs` apart, so its CPU is
 * what it uses now, not what it once used.
 */
export async function sampleTrees(
  roots: readonly number[],
  intervalMs = 500,
): Promise<Map<number, TreeUsage>> {
  if (process.platform === 'win32' || !roots.length) return new Map();
  const before = await listProcesses(roots);
  const first = performance.now();
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  const after = await listProcesses(roots);
  return treeUsage(before, after, roots, performance.now() - first);
}
