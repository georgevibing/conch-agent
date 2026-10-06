import { loadavg, platform, uptime } from 'node:os';

import type { ComputerHelper, ComputerInfo, ComputerSample, ComputerStatus } from '@conch/protocol';

import { sampleResources, type ResourceSnapshot } from '../recovery/resources';
import {
  HELPER_RULES,
  OTHER_HELPERS,
  battery,
  computerInfo,
  cpuBetween,
  cpuTimes,
  diskOf,
  graphics,
  netTotals,
  processes,
  temperature,
  type CpuTimes,
  type GraphicsReading,
  type NetTotals,
  type ProcessRow,
} from './readers';

/** Everything the sampler reads, so a test can be any computer. */
export interface ComputerReaders {
  cpuTimes(): CpuTimes[];
  resources(): Promise<Pick<ResourceSnapshot, 'totalBytes' | 'availableBytes' | 'level'>>;
  disk(): Promise<ComputerSample['disk']>;
  network(): Promise<NetTotals | undefined>;
  graphics(): Promise<GraphicsReading | undefined>;
  temperature(): Promise<number | undefined>;
  battery(): Promise<ComputerSample['battery']>;
  processes(): Promise<{ rows: ProcessRow[]; family: Map<number, string> } | undefined>;
  /** Conch's own processor time (µs, user + system) and memory. */
  conch(): { cpuMicros: number; rssBytes: number };
  load(): number | undefined;
  info(gpu: GraphicsReading | undefined): Promise<ComputerInfo>;
  uptime(): number;
  conchUptime(): number;
}

export interface ComputerSamplerOptions {
  /** The folder whose disk is "the disk": `CONCH_HOME`. */
  home: string;
  intervalMs?: number;
  /** How much history to keep. */
  keepMs?: number;
  /** Stop looking this long after the last person asked. */
  idleMs?: number;
  readers?: Partial<ComputerReaders>;
  now?: () => number;
  /** The gateway's process, whose children are "what Conch started". */
  self?: number;
}

interface Before {
  at: number;
  cpu: CpuTimes[];
  net?: NetTotals;
  conchMicros: number;
  /** Processor seconds per process, at the last look. */
  procs?: Map<number, number>;
}

const BATTERY_EVERY = 30_000;

/**
 * This computer, sampled only while someone is looking (Settings → This
 * computer). The first ask starts a look every `intervalMs`; when nobody has
 * asked for `idleMs` the timer stops and the history is let go, so a closed
 * page costs nothing. Every reader is cheap and bounded (`readers.ts`), and a
 * look that is still running is never overlapped by the next.
 */
export class ComputerSampler {
  readonly intervalMs: number;
  readonly #keepMs: number;
  readonly #idleMs: number;
  readonly #read: ComputerReaders;
  readonly #now: () => number;
  #samples: ComputerSample[] = [];
  #before?: Before;
  #timer?: ReturnType<typeof setInterval>;
  #starting?: Promise<void>;
  #busy = false;
  #asked = 0;
  #info?: Promise<ComputerInfo>;
  #battery?: { at: number; value: ComputerSample['battery'] };

  constructor(options: ComputerSamplerOptions) {
    this.intervalMs = options.intervalMs ?? 2000;
    this.#keepMs = options.keepMs ?? 3 * 60_000;
    this.#idleMs = options.idleMs ?? 20_000;
    this.#now = options.now ?? Date.now;
    const self = options.self ?? process.pid;
    this.#read = {
      cpuTimes,
      resources: sampleResources,
      disk: () => diskOf(options.home),
      network: netTotals,
      graphics,
      temperature,
      battery,
      processes: () => processes(self),
      conch: () => {
        const { user, system } = process.cpuUsage();
        return { cpuMicros: user + system, rssBytes: process.memoryUsage.rss() };
      },
      load: () => (platform() === 'win32' ? undefined : loadavg()[0]),
      info: computerInfo,
      uptime,
      conchUptime: () => process.uptime(),
      ...options.readers,
    };
  }

  /** Whether it's looking now. */
  get running() {
    return this.#timer !== undefined;
  }

  /** What's known, starting to look if nobody was. */
  async status(): Promise<ComputerStatus> {
    this.#asked = this.#now();
    if (!this.#timer) {
      this.#starting ??= this.#start().finally(() => (this.#starting = undefined));
      await this.#starting;
    }
    this.#info ??= this.#read
      .graphics()
      .catch(() => undefined)
      .then((gpu) => this.#read.info(gpu));
    return {
      info: await this.#info,
      uptimeSeconds: Math.round(this.#read.uptime()),
      conchUptimeSeconds: Math.round(this.#read.conchUptime()),
      intervalMs: this.intervalMs,
      samples: this.#samples,
    };
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#before = undefined;
    this.#samples = [];
  }

  async #start() {
    this.stop();
    this.#before = await this.#baseline();
    // A first look soon, so the page has a number at once.
    await new Promise((resolve) => setTimeout(resolve, Math.min(400, this.intervalMs)));
    await this.tick();
    this.#timer = setInterval(() => void this.tick(), this.intervalMs);
    this.#timer.unref?.();
  }

  async #baseline(): Promise<Before> {
    const at = this.#now();
    const cpu = this.#read.cpuTimes();
    const conchMicros = this.#read.conch().cpuMicros;
    const [net, procs] = await Promise.all([
      this.#read.network().catch(() => undefined),
      this.#read.processes().catch(() => undefined),
    ]);
    return {
      at,
      cpu,
      ...(net && { net }),
      conchMicros,
      ...(procs && { procs: new Map(procs.rows.map((r) => [r.pid, r.cpuSeconds])) }),
    };
  }

  /** One look. Public for tests; the timer calls it. */
  async tick(): Promise<void> {
    if (this.#timer && this.#now() - this.#asked > this.#idleMs) return this.stop();
    if (this.#busy || !this.#before) return;
    this.#busy = true;
    try {
      const sample = await this.#look(this.#before);
      if (sample) {
        this.#samples.push(sample);
        const oldest = sample.at - this.#keepMs;
        while ((this.#samples[0]?.at ?? Infinity) < oldest) this.#samples.shift();
      }
    } finally {
      this.#busy = false;
    }
  }

  async #look(before: Before): Promise<ComputerSample | undefined> {
    const quiet = <T>(p: Promise<T>) => p.catch(() => undefined);
    const [room, disk, net, gpu, temp, power, procs] = await Promise.all([
      this.#read.resources(),
      quiet(this.#read.disk()),
      quiet(this.#read.network()),
      quiet(this.#read.graphics()),
      quiet(this.#read.temperature()),
      quiet(this.#batteryNow()),
      quiet(this.#read.processes()),
    ]);
    const at = this.#now();
    const cpuNow = this.#read.cpuTimes();
    const conch = this.#read.conch();
    // Stopped while looking: this look belongs to nobody.
    if (this.#before !== before) return undefined;
    const seconds = Math.max(0.001, (at - before.at) / 1000);
    const cores = Math.max(1, cpuNow.length);
    const ofComputer = (cpuSeconds: number) =>
      Math.min(100, Math.max(0, (cpuSeconds / seconds / cores) * 100));
    const { cpu, cores: perCore } = cpuBetween(before.cpu, cpuNow);
    const load = this.#read.load();
    const reading = temp ?? gpu?.temperature;
    const temperatureNow =
      reading !== undefined && reading > 0 && reading < 150 ? reading : undefined;

    const sample: ComputerSample = {
      at,
      cpu,
      cores: perCore,
      ...(load !== undefined && { load: round(load, 2) }),
      memory: {
        totalBytes: room.totalBytes,
        usedBytes: Math.max(0, room.totalBytes - room.availableBytes),
      },
      room: room.level,
      ...(disk && { disk }),
      ...(net &&
        before.net && {
          network: {
            inPerSecond: Math.round(Math.max(0, net.in - before.net.in) / seconds),
            outPerSecond: Math.round(Math.max(0, net.out - before.net.out) / seconds),
          },
        }),
      ...(gpu &&
        (gpu.percent !== undefined || gpu.memoryUsedBytes !== undefined) && {
          graphics: {
            ...(gpu.percent !== undefined && { percent: gpu.percent }),
            ...(gpu.memoryUsedBytes !== undefined && { memoryUsedBytes: gpu.memoryUsedBytes }),
            ...(gpu.memoryTotalBytes !== undefined && {
              memoryTotalBytes: gpu.memoryTotalBytes,
            }),
          },
        }),
      ...(temperatureNow !== undefined && { temperature: temperatureNow }),
      ...(power && { battery: power }),
      conch: {
        cpu: round(ofComputer(Math.max(0, conch.cpuMicros - before.conchMicros) / 1e6)),
        memoryBytes: conch.rssBytes,
      },
      ...(procs && { helpers: helpersOf(procs, before.procs, ofComputer) }),
    };

    this.#before = {
      at,
      cpu: cpuNow,
      ...(net && { net }),
      conchMicros: conch.cpuMicros,
      ...(procs && { procs: new Map(procs.rows.map((r) => [r.pid, r.cpuSeconds])) }),
    };
    return sample;
  }

  async #batteryNow() {
    const now = this.#now();
    if (this.#battery && now - this.#battery.at < BATTERY_EVERY) return this.#battery.value;
    const value = await this.#read.battery();
    this.#battery = { at: now, value };
    return value;
  }
}

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * What Conch started, by who it belongs to, in a fixed order (the providers,
 * Ollama, the browser, then everything else), so rows never swap places as
 * the numbers move.
 */
export function helpersOf(
  { rows, family }: { rows: ProcessRow[]; family: Map<number, string> },
  before: Map<number, number> | undefined,
  ofComputer: (cpuSeconds: number) => number,
): ComputerHelper[] {
  const groups = new Map<string, { processes: number; cpuSeconds: number; memoryBytes: number }>();
  for (const row of rows) {
    const id = family.get(row.pid);
    if (!id) continue;
    // A process that started since the last look used all its time since then.
    const then = before ? (before.get(row.pid) ?? 0) : row.cpuSeconds;
    const group = groups.get(id) ?? { processes: 0, cpuSeconds: 0, memoryBytes: 0 };
    group.processes += 1;
    group.cpuSeconds += Math.max(0, row.cpuSeconds - then);
    group.memoryBytes += row.rssBytes;
    groups.set(id, group);
  }
  return [...HELPER_RULES, OTHER_HELPERS].flatMap(({ id, label }) => {
    const group = groups.get(id);
    return group
      ? [
          {
            id,
            label,
            processes: group.processes,
            cpu: round(ofComputer(group.cpuSeconds)),
            memoryBytes: group.memoryBytes,
          },
        ]
      : [];
  });
}
