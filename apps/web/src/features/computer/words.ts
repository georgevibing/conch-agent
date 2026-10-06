import type { ComputerSample } from '@conch/protocol';

/**
 * How This computer says its numbers. Memory in binary units, as the system
 * itself reports it ("36 GB" for 36 GiB); disks and the network in decimal,
 * as Finder, Explorer and every download do.
 */

/** "18%"; under 10, one decimal ("0.4%"), so a quiet helper isn't "0%". */
export function percent(value: number): string {
  if (value > 0 && value < 10) return `${value.toFixed(1).replace(/\.0$/, '')}%`;
  return `${Math.round(value)}%`;
}

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

/** "36 GB", "20.4 GB", "412 MB". */
export function memory(value: number): string {
  if (value >= 10 * GiB) return `${Math.round(value / GiB)} GB`;
  if (value >= GiB) return `${(value / GiB).toFixed(1).replace(/\.0$/, '')} GB`;
  return `${Math.max(0, Math.round(value / MiB))} MB`;
}

/** "354 GB", "1.2 TB". */
export function disk(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(1).replace(/\.0$/, '')} TB`;
  if (value >= 1e9) return `${Math.round(value / 1e9)} GB`;
  return `${Math.max(0, Math.round(value / 1e6))} MB`;
}

/** "1.2 MB/s", "530 KB/s". */
export function rate(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB/s`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB/s`;
  if (value >= 1e3) return `${Math.round(value / 1e3)} KB/s`;
  return `${Math.max(0, Math.round(value))} B/s`;
}

/** "3 days", "5 hours", "12 minutes", "a moment". */
export function duration(seconds: number): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (seconds >= 2 * 86_400) return plural(Math.floor(seconds / 86_400), 'day');
  if (seconds >= 2 * 3600) return plural(Math.floor(seconds / 3600), 'hour');
  if (seconds >= 3600) return '1 hour';
  if (seconds >= 60) return plural(Math.floor(seconds / 60), 'minute');
  return 'a moment';
}

export type Tone = 'calm' | 'busy' | 'critical';

/** How the computer is doing, in two or three words, from the last few looks. */
export function statusOf(samples: readonly ComputerSample[]): { status: string; tone: Tone } {
  const last = samples.at(-1);
  if (!last) return { status: 'Looking…', tone: 'calm' };
  if (last.room === 'critical') return { status: 'Low on memory', tone: 'critical' };
  if (last.battery?.state === 'battery' && last.battery.percent <= 10)
    return { status: 'Battery low', tone: 'critical' };
  if (last.room === 'busy') return { status: 'Busy right now', tone: 'busy' };
  const recent = samples.slice(-5);
  const cpu = recent.reduce((sum, s) => sum + s.cpu, 0) / recent.length;
  if (cpu >= 85) return { status: 'Working hard', tone: 'busy' };
  return { status: 'Room to spare', tone: 'calm' };
}

/** "Charged", "Charging", "On battery". */
export function batteryWords(battery: NonNullable<ComputerSample['battery']>): string {
  return { charged: 'Charged', charging: 'Charging', battery: 'On battery' }[battery.state];
}
