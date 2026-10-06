import { z } from 'zod';

/**
 * This computer: the machine Conch runs on, as Settings → This computer shows
 * it. Numbers only: no hostname, no user names, no command lines, no network
 * interfaces or addresses. A program Conch runs is named by the provider or
 * part of Conch it belongs to, never by what it was asked to do.
 */

const Percent = z.number().min(0).max(100);
const Bytes = z.number().nonnegative();

export const ComputerOs = z.enum(['mac', 'windows', 'linux', 'other']);
export type ComputerOs = z.infer<typeof ComputerOs>;

/** What doesn't change while Conch runs. */
export const ComputerInfo = z.object({
  os: ComputerOs,
  /** `macOS 26.1`, `Ubuntu 24.04 LTS`, `Windows 11 Pro`. */
  system: z.string().max(80),
  /** `Apple M3 Pro`, `AMD Ryzen 7 7840U`. */
  processor: z.string().max(80),
  cores: z.number().int().positive(),
  memoryBytes: Bytes,
  /** The graphics processor's name, when Conch could tell. */
  graphics: z.string().max(80).optional(),
});
export type ComputerInfo = z.infer<typeof ComputerInfo>;

/**
 * Conch's own program, or a group of programs it started, by who they belong
 * to: a provider (`claude-code`, `codex`), the browser, or everything else
 * (commands, helpers). `cpu` is a share of the whole computer, like the
 * processor's line.
 */
export const ComputerHelper = z.object({
  id: z.string().max(40),
  label: z.string().max(60),
  processes: z.number().int().nonnegative(),
  cpu: Percent,
  memoryBytes: Bytes,
});
export type ComputerHelper = z.infer<typeof ComputerHelper>;

/** How roomy the computer is, as Conch's own admission policy reads it (ADR 0094). */
export const ComputerRoom = z.enum(['healthy', 'busy', 'critical']);
export type ComputerRoom = z.infer<typeof ComputerRoom>;

/** One look, every couple of seconds while someone is watching. Absent: Conch can't tell here. */
export const ComputerSample = z.object({
  at: z.number(),
  /** The whole processor, 0–100. */
  cpu: Percent,
  /** Each core, 0–100, in the order the system lists them. */
  cores: z.array(Percent).max(512),
  /** The one-minute load average (not on Windows). */
  load: z.number().nonnegative().optional(),
  memory: z.object({ usedBytes: Bytes, totalBytes: Bytes }),
  room: ComputerRoom,
  /** The disk Conch keeps your things on. */
  disk: z.object({ usedBytes: Bytes, totalBytes: Bytes }).optional(),
  /** Everything but loopback, in bytes per second. */
  network: z.object({ inPerSecond: Bytes, outPerSecond: Bytes }).optional(),
  graphics: z
    .object({
      percent: Percent.optional(),
      memoryUsedBytes: Bytes.optional(),
      memoryTotalBytes: Bytes.optional(),
    })
    .optional(),
  /** The processor's temperature in °C, where the system shares it without a password. */
  temperature: z.number().min(-50).max(200).optional(),
  battery: z
    .object({ percent: Percent, state: z.enum(['charging', 'charged', 'battery']) })
    .optional(),
  /** Conch itself (the gateway). */
  conch: z.object({ cpu: Percent, memoryBytes: Bytes }),
  /** What Conch started, by who it belongs to; absent where Conch can't list processes. */
  helpers: z.array(ComputerHelper).max(20).optional(),
});
export type ComputerSample = z.infer<typeof ComputerSample>;

export const ComputerStatus = z.object({
  info: ComputerInfo,
  /** Since this computer started. */
  uptimeSeconds: z.number().nonnegative(),
  /** Since Conch started. */
  conchUptimeSeconds: z.number().nonnegative(),
  /** How often a sample is taken. */
  intervalMs: z.number().int().positive(),
  /** Oldest first, the last few minutes. */
  samples: z.array(ComputerSample).max(600),
});
export type ComputerStatus = z.infer<typeof ComputerStatus>;
