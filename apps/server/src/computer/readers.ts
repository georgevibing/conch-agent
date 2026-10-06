import { execFile } from 'node:child_process';
import { readFile, readdir, statfs } from 'node:fs/promises';
import { cpus, platform, release, totalmem, version } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ComputerInfo, ComputerOs, ComputerSample } from '@conch/protocol';

import { ACP_AGENTS } from '../engines/acp/agents';
import { findExecutable } from '../lib/proc';

/**
 * How Conch reads this computer, cheaply: Node's own `os` where it can, a
 * file under `/proc` or `/sys` on Linux, and on a Mac a few of the system's
 * own small programs (`vm_stat`, `netstat`, `ioreg`, `pmset`, `ps`), each by
 * full path, with a short timeout, a small output limit and a bare
 * environment. Nothing here needs a password, and nothing is ever written.
 * Each reader answers `undefined` when this computer can't tell, so the page
 * leaves that part out instead of showing a wrong number.
 *
 * The parsers are pure and exported for tests.
 */

const execute = promisify(execFile);

export async function tool(file: string, args: string[], maxBuffer = 262_144): Promise<string> {
  const { stdout } = await execute(file, args, {
    timeout: 1500,
    maxBuffer,
    encoding: 'utf8',
    windowsHide: true,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C' },
  });
  return stdout;
}

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 80);

export const osKind = (): ComputerOs =>
  (({ darwin: 'mac', win32: 'windows', linux: 'linux' })[platform() as string] as ComputerOs) ??
  'other';

// ── The processor ───────────────────────────────────────────────────────

export interface CpuTimes {
  busy: number;
  total: number;
}

export const cpuTimes = (): CpuTimes[] =>
  cpus().map(({ times }) => {
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    return { busy: total - times.idle, total };
  });

const share = (busy: number, total: number) =>
  total > 0 ? Math.min(100, Math.max(0, (busy / total) * 100)) : 0;

/** How busy the processor was between two readings, as a whole and per core. */
export function cpuBetween(before: CpuTimes[], after: CpuTimes[]) {
  let busy = 0;
  let total = 0;
  const cores = after.map((now, i) => {
    const then = before[i] ?? { busy: 0, total: 0 };
    const b = Math.max(0, now.busy - then.busy);
    const t = Math.max(0, now.total - then.total);
    busy += b;
    total += t;
    return round(share(b, t));
  });
  return { cpu: round(share(busy, total)), cores };
}

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

// ── The disk ────────────────────────────────────────────────────────────

/** The disk a folder is on. "Used" counts what isn't free for you, as Finder and Explorer do. */
export async function diskOf(path: string): Promise<ComputerSample['disk']> {
  try {
    const s = await statfs(path);
    const totalBytes = s.blocks * s.bsize;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return undefined;
    return { totalBytes, usedBytes: Math.max(0, totalBytes - s.bavail * s.bsize) };
  } catch {
    return undefined;
  }
}

// ── The network ─────────────────────────────────────────────────────────

export interface NetTotals {
  in: number;
  out: number;
}

/** A tunnel or a bridge carries traffic already counted on the real interface. */
const VIRTUAL = /^(lo|docker|veth|br-|virbr|tun|tap|wg|tailscale|zt|utun|awdl|llw|bridge|gif|stf)/;

/** macOS `netstat -ib`: the `<Link#n>` row of each physical interface (`en0`, `en1`…). */
export function parseNetstat(text: string): NetTotals | undefined {
  let found = false;
  const totals = { in: 0, out: 0 };
  for (const line of text.split('\n')) {
    const cells = line.trim().split(/\s+/);
    const name = cells[0]?.replace(/\*$/, '') ?? '';
    if (!cells[2]?.startsWith('<Link#') || !/^en\d/.test(name)) continue;
    // Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll: counted from the end, since
    // the address column is empty for some interfaces.
    const ibytes = Number(cells.at(-5));
    const obytes = Number(cells.at(-2));
    if (!Number.isFinite(ibytes) || !Number.isFinite(obytes)) continue;
    totals.in += ibytes;
    totals.out += obytes;
    found = true;
  }
  return found ? totals : undefined;
}

/** Linux `/proc/net/dev`: every interface but loopback, tunnels and bridges. */
export function parseProcNetDev(text: string): NetTotals | undefined {
  let found = false;
  const totals = { in: 0, out: 0 };
  for (const line of text.split('\n')) {
    const match = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!match?.[1] || VIRTUAL.test(match[1])) continue;
    const cells = (match[2] ?? '').trim().split(/\s+/).map(Number);
    const rx = cells[0];
    const tx = cells[8];
    if (rx === undefined || tx === undefined || !Number.isFinite(rx) || !Number.isFinite(tx))
      continue;
    totals.in += rx;
    totals.out += tx;
    found = true;
  }
  return found ? totals : undefined;
}

export async function netTotals(): Promise<NetTotals | undefined> {
  try {
    if (platform() === 'darwin') return parseNetstat(await tool('/usr/sbin/netstat', ['-ib']));
    if (platform() === 'linux') return parseProcNetDev(await readFile('/proc/net/dev', 'utf8'));
  } catch {
    // Not this time: the network line waits for the next look.
  }
  return undefined;
}

// ── The graphics processor ──────────────────────────────────────────────

export interface GraphicsReading {
  name?: string;
  percent?: number;
  memoryUsedBytes?: number;
  memoryTotalBytes?: number;
  temperature?: number;
}

/** macOS `ioreg -c IOAccelerator`: Apple's GPU says how busy it is, no password needed. */
export function parseIoreg(text: string): GraphicsReading | undefined {
  const name = /"model"\s*=\s*"([^"]+)"/.exec(text)?.[1];
  const percent = Number(/"Device Utilization %"\s*=\s*(\d+)/.exec(text)?.[1]);
  const used = Number(/"In use system memory"\s*=\s*(\d+)/.exec(text)?.[1]);
  if (!name && !Number.isFinite(percent)) return undefined;
  return {
    ...(name && { name: tidy(name) }),
    ...(Number.isFinite(percent) && { percent: Math.min(100, percent) }),
    ...(Number.isFinite(used) && used > 0 && { memoryUsedBytes: used }),
  };
}

/** `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu`: the first GPU. */
export function parseNvidiaSmi(text: string): GraphicsReading | undefined {
  const first = text.split('\n').find((line) => line.trim());
  if (!first) return undefined;
  const [name, util, used, total, temp] = first.split(',').map((cell) => cell.trim());
  const n = (cell: string | undefined) => {
    const value = Number(cell);
    return cell && Number.isFinite(value) ? value : undefined;
  };
  const MiB = 1024 * 1024;
  const percent = n(util);
  const usedMiB = n(used);
  const totalMiB = n(total);
  const temperature = n(temp);
  return {
    ...(name && { name: tidy(name) }),
    ...(percent !== undefined && { percent: Math.min(100, percent) }),
    ...(usedMiB !== undefined && { memoryUsedBytes: usedMiB * MiB }),
    ...(totalMiB !== undefined && { memoryTotalBytes: totalMiB * MiB }),
    ...(temperature !== undefined && { temperature }),
  };
}

let nvidia: Promise<string | undefined> | undefined;

export async function graphics(): Promise<GraphicsReading | undefined> {
  try {
    if (platform() === 'darwin')
      return parseIoreg(
        await tool('/usr/sbin/ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']),
      );
    nvidia ??= findExecutable('nvidia-smi');
    const smi = await nvidia;
    if (smi) {
      return parseNvidiaSmi(
        await tool(smi, [
          '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
          '--format=csv,noheader,nounits',
        ]),
      );
    }
    if (platform() === 'linux') return await linuxGpuBusy();
  } catch {
    // No reading this time.
  }
  return undefined;
}

/** AMD and Intel drivers on Linux share how busy the GPU is as a file. */
async function linuxGpuBusy(): Promise<GraphicsReading | undefined> {
  const cards = (await readdir('/sys/class/drm').catch(() => [] as string[])).filter((name) =>
    /^card\d+$/.test(name),
  );
  for (const card of cards) {
    const busy = Number(
      await readFile(join('/sys/class/drm', card, 'device', 'gpu_busy_percent'), 'utf8').catch(
        () => '',
      ),
    );
    if (Number.isFinite(busy) && busy >= 0) return { percent: Math.min(100, busy) };
  }
  return undefined;
}

// ── Temperature and battery ─────────────────────────────────────────────

/** Linux thermal zones: the processor's, or the warmest when none says it's the processor's. */
export async function temperature(): Promise<number | undefined> {
  if (platform() !== 'linux') return undefined;
  const base = '/sys/class/thermal';
  const zones = (await readdir(base).catch(() => [] as string[])).filter((name) =>
    name.startsWith('thermal_zone'),
  );
  const readings = await Promise.all(
    zones.map(async (zone) => {
      const [type, temp] = await Promise.all([
        readFile(join(base, zone, 'type'), 'utf8').catch(() => ''),
        readFile(join(base, zone, 'temp'), 'utf8').catch(() => ''),
      ]);
      return { type: type.trim(), celsius: Number(temp) / 1000 };
    }),
  );
  return pickTemperature(readings);
}

export function pickTemperature(readings: { type: string; celsius: number }[]) {
  const valid = readings.filter((r) => Number.isFinite(r.celsius) && r.celsius > 0);
  const cpu = valid.filter((r) => /x86_pkg|cpu|soc|k10temp|coretemp|package/i.test(r.type));
  const pool = cpu.length ? cpu : valid;
  if (!pool.length) return undefined;
  return round(Math.max(...pool.map((r) => r.celsius)), 0);
}

/** macOS `pmset -g batt`. */
export function parsePmset(text: string): ComputerSample['battery'] {
  const match = /(\d+)%;\s*([^;]+);/.exec(text);
  if (!match) return undefined;
  const percent = Math.min(100, Number(match[1]));
  const said = (match[2] ?? '').trim().toLowerCase();
  const state =
    said === 'charged'
      ? 'charged'
      : said === 'charging' || said === 'finishing charge'
        ? 'charging'
        : said.includes('ac attached')
          ? 'charged'
          : 'battery';
  return { percent, state };
}

/** Linux `/sys/class/power_supply/BAT*`. */
export function linuxBattery(capacity: string, status: string): ComputerSample['battery'] {
  const percent = Number(capacity.trim());
  if (!Number.isFinite(percent)) return undefined;
  const said = status.trim().toLowerCase();
  const state = said === 'charging' ? 'charging' : said === 'discharging' ? 'battery' : 'charged';
  return { percent: Math.min(100, Math.max(0, percent)), state };
}

export async function battery(): Promise<ComputerSample['battery']> {
  try {
    if (platform() === 'darwin') return parsePmset(await tool('/usr/bin/pmset', ['-g', 'batt']));
    if (platform() === 'linux') {
      const base = '/sys/class/power_supply';
      const bat = (await readdir(base)).find((name) => /^BAT/.test(name));
      if (!bat) return undefined;
      const [capacity, status] = await Promise.all([
        readFile(join(base, bat, 'capacity'), 'utf8'),
        readFile(join(base, bat, 'status'), 'utf8'),
      ]);
      return linuxBattery(capacity, status);
    }
  } catch {
    // A desktop has none, and that's fine.
  }
  return undefined;
}

// ── What Conch started ──────────────────────────────────────────────────

export interface ProcessRow {
  pid: number;
  ppid: number;
  rssBytes: number;
  /** Processor seconds used so far. */
  cpuSeconds: number;
  /** The program's path or name. Read here to say who it belongs to; never sent anywhere. */
  command: string;
}

/** `[[dd-]hh:]mm:ss[.cc]`, as `ps -o time` prints it on macOS and Linux. */
export function parseCpuTime(text: string): number {
  const [days, rest] = text.includes('-') ? text.split('-') : ['0', text];
  const parts = (rest ?? '').split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  const seconds = parts.reduce((sum, part) => sum * 60 + part, 0);
  return Number(days) * 86_400 + seconds;
}

/** `ps -A -o pid=,ppid=,rss=,time=,comm=`. */
export function parsePs(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssBytes: Number(match[3]) * 1024,
      cpuSeconds: parseCpuTime(match[4] ?? ''),
      command: (match[5] ?? '').trim(),
    });
  }
  return rows;
}

export interface HelperRule {
  id: string;
  label: string;
  /** Matched against the program's name and, for a script, the script's path. */
  match: RegExp;
  /** Counted wherever it runs, not only when Conch started it (Ollama runs on its own). */
  anywhere?: boolean;
}

const named = (name: string) => new RegExp(`(^|[\\\\/@])${name}([\\\\/._-]|$)`, 'i');

/** Who a program belongs to, the nearest match up its family winning. Ids are engine ids where there is one. */
export const HELPER_RULES: HelperRule[] = [
  { id: 'claude-code', label: 'Claude Code', match: named('claude') },
  { id: 'codex-cli', label: 'Codex', match: named('codex') },
  ...Object.entries(ACP_AGENTS).map(([id, agent]) => ({
    id,
    label: agent.label,
    match: named(agent.program),
  })),
  { id: 'ollama', label: 'Ollama', match: /(^|[\\/])ollama[^\\/]*$/i, anywhere: true },
  {
    id: 'browser',
    label: 'Browser',
    match: /(chrome|chromium|msedge|headless_shell|firefox)[^\\/]*$/i,
  },
];

export const OTHER_HELPERS = { id: 'other', label: 'Commands and helpers' };

/** A program that runs a script names the script second: `node …/codex.js`. */
const INTERPRETER = /(^|[\\/])(node|bun|deno|tsx|python\d*(\.\d+)?)(\.exe)?$/i;

export function needsArguments(command: string) {
  return INTERPRETER.test(command);
}

/**
 * Group every process Conch started (and Ollama's, wherever it runs) by who
 * it belongs to. `words` holds a few leading words of a script's command line
 * for the interpreters above, only to tell `node codex.js` from `node gemini`;
 * they stay in this function.
 */
export function familyOf(
  rows: ProcessRow[],
  self: number,
  words = new Map<number, string>(),
): Map<number, string> {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const ruleFor = (row: ProcessRow) => {
    const text = needsArguments(row.command) ? (words.get(row.pid) ?? '') : row.command;
    const tokens = text.split(/\s+/).slice(0, 3);
    return HELPER_RULES.find((rule) => tokens.some((token) => rule.match.test(token)));
  };
  const family = new Map<number, string>();
  for (const row of rows) {
    if (row.pid === self) continue;
    let nearest: string | undefined;
    let ours = false;
    let at: ProcessRow | undefined = row;
    for (let hops = 0; at && hops < 64; hops++) {
      if (at.pid === self) {
        ours = true;
        break;
      }
      const rule = ruleFor(at);
      if (rule?.anywhere) {
        nearest ??= rule.id;
        ours = true;
        break;
      }
      nearest ??= rule?.id;
      if (at.ppid === at.pid || at.ppid <= 1) break;
      at = byPid.get(at.ppid);
    }
    if (ours) family.set(row.pid, nearest ?? OTHER_HELPERS.id);
  }
  return family;
}

export async function processes(
  self: number,
): Promise<{ rows: ProcessRow[]; family: Map<number, string> } | undefined> {
  if (platform() !== 'darwin' && platform() !== 'linux') return undefined;
  try {
    const rows = parsePs(
      await tool('/bin/ps', ['-A', '-o', 'pid=,ppid=,rss=,time=,comm='], 4_194_304),
    );
    // The interpreters among what's ours: their script's name says who they are.
    const first = familyOf(rows, self);
    const ask = rows
      .filter((row) => first.has(row.pid) && needsArguments(row.command))
      .map((row) => row.pid)
      .slice(0, 200);
    const words = new Map<number, string>();
    if (ask.length) {
      const text = await tool('/bin/ps', ['-o', 'pid=,args=', '-p', ask.join(',')], 1_048_576);
      for (const line of text.split('\n')) {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (match) words.set(Number(match[1]), (match[2] ?? '').slice(0, 400));
      }
    }
    return { rows, family: words.size ? familyOf(rows, self, words) : first };
  } catch {
    return undefined;
  }
}

// ── What doesn't change ─────────────────────────────────────────────────

export async function computerInfo(gpu?: GraphicsReading): Promise<ComputerInfo> {
  const os = osKind();
  const list = cpus();
  const processor = tidy(list[0]?.model ?? '') || 'Processor';
  let system = `${version()}`;
  try {
    if (os === 'mac') {
      system = `macOS ${(await tool('/usr/bin/sw_vers', ['-productVersion'])).trim()}`;
    } else if (os === 'linux') {
      const text = await readFile('/etc/os-release', 'utf8');
      system = /^PRETTY_NAME="?([^"\n]+)"?$/m.exec(text)?.[1] ?? `Linux ${release()}`;
    }
  } catch {
    system = os === 'mac' ? 'macOS' : os === 'linux' ? `Linux ${release()}` : system;
  }
  return {
    os,
    system: tidy(system) || 'This computer',
    processor,
    cores: Math.max(1, list.length),
    memoryBytes: totalmem(),
    ...(gpu?.name && { graphics: gpu.name }),
  };
}
