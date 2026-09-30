/**
 * Which model to suggest, for which computer.
 *
 * A short list Conch stands behind, checked against Ollama's library in
 * September 2026 (sizes are the registry's own manifests, ADR 0022). Each one
 * calls tools — that's what lets a local model use your apps, memory and the
 * browser — and the pick depends on how much memory this computer has: a model
 * that doesn't fit in memory doesn't answer slowly, it doesn't answer.
 *
 * Only names on this list can be downloaded from Conch. It's the same rule as
 * installs (ADR 0016): what gets fetched is a constant in code, never a string
 * a web page or the agent could choose.
 */
import type { LocalOffer, LocalModel } from '@conch/protocol';

const GB = 1_000_000_000;
const GiB = 1024 ** 3;

export interface CatalogModel {
  /** Exactly as Ollama's library names it. */
  name: string;
  label: string;
  /** The download, in bytes, from the registry manifest. */
  sizeBytes: number;
  blurb: string;
  tools: boolean;
  /** The oldest Ollama that runs it. */
  minVersion?: string;
}

/** Smallest first. */
export const LOCAL_CATALOG: readonly CatalogModel[] = [
  {
    name: 'qwen3:1.7b',
    label: 'Qwen3 1.7B',
    sizeBytes: 1_359_293_444,
    blurb: 'The smallest that still uses your apps. For a computer with little memory.',
    tools: true,
  },
  {
    name: 'qwen3.5:2b-q4_K_M',
    label: 'Qwen3.5 2B',
    sizeBytes: 1_945_323_638,
    blurb: 'Small and quick. It uses your apps and looks at pictures.',
    tools: true,
    minVersion: '0.17.1',
  },
  {
    name: 'llama3.2:3b',
    label: 'Llama 3.2',
    sizeBytes: 2_019_393_189,
    blurb: 'Meta’s small all-rounder: quick, and it uses your apps.',
    tools: true,
  },
  {
    name: 'qwen3:4b-instruct',
    label: 'Qwen3 4B',
    sizeBytes: 2_497_293_803,
    blurb: 'Quick, and good at using your apps.',
    tools: true,
  },
  {
    name: 'qwen3.5:4b',
    label: 'Qwen3.5 4B',
    sizeBytes: 3_389_983_735,
    blurb: 'A little bigger and smarter, and it looks at pictures.',
    tools: true,
    minVersion: '0.17.1',
  },
  {
    name: 'qwen3:8b',
    label: 'Qwen3 8B',
    sizeBytes: 5_225_388_164,
    blurb: 'A strong all-rounder that uses your apps well.',
    tools: true,
  },
  {
    name: 'qwen3.5:9b',
    label: 'Qwen3.5 9B',
    sizeBytes: 6_594_474_711,
    blurb: 'The best small model at using tools today, and it looks at pictures.',
    tools: true,
    minVersion: '0.17.1',
  },
  {
    name: 'gpt-oss:20b',
    label: 'gpt-oss 20B',
    sizeBytes: 13_793_441_244,
    blurb: 'OpenAI’s open model. It thinks before it answers.',
    tools: true,
    minVersion: '0.11.0',
  },
  {
    name: 'qwen3.6:35b-a3b',
    label: 'Qwen3.6 35B',
    sizeBytes: 22_621_314_381,
    blurb: 'Closest to the cloud models on everyday work. Needs a lot of memory.',
    tools: true,
    minVersion: '0.30.0',
  },
];

const byName = new Map(LOCAL_CATALOG.map((m) => [m.name, m]));

export function catalogModel(name: string): CatalogModel | undefined {
  return byName.get(name);
}

/**
 * The pick for a computer with this much memory, best first; the first one this
 * Ollama can run is it. Memory as the OS reports it: an "8 GB" laptop says
 * about 7.5 GiB, a "16 GB" one about 15.5.
 */
function tier(memoryBytes: number): string[] {
  const gib = memoryBytes / GiB;
  if (gib < 7) return ['qwen3.5:2b-q4_K_M', 'qwen3:1.7b'];
  if (gib < 14) return ['qwen3:4b-instruct', 'llama3.2:3b'];
  if (gib < 40) return ['qwen3.5:9b', 'qwen3:8b'];
  return ['qwen3.6:35b-a3b', 'qwen3.5:9b', 'qwen3:8b'];
}

/** `0.17.1` ≥ `0.9.0`, numerically. An unknown version is taken as new enough. */
export function atLeast(version: string | undefined, min: string | undefined): boolean {
  if (!version || !min) return true;
  const parts = (v: string) =>
    v
      .replace(/^v/, '')
      .split(/[.-]/)
      .slice(0, 3)
      .map((p) => Number.parseInt(p, 10) || 0);
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

/**
 * Memory a model needs to run: its weights, plus room for the conversation
 * (the context Conch asks for) and Ollama itself. Conservative on purpose.
 */
export function memoryNeeded(sizeBytes: number): number {
  return sizeBytes * 1.2 + 1.5 * GiB;
}

/** Whether it runs here: needs no more than three quarters of this computer's memory. */
export function fitsMemory(sizeBytes: number, memoryBytes: number): boolean {
  return memoryNeeded(sizeBytes) <= memoryBytes * 0.75;
}

/** Room to spare on disk after the download, so the computer isn't left full. */
export const DISK_SPARE = 2 * GB;

/**
 * Rough download time. Until Conch has seen a real download on this
 * computer, it assumes a typical home connection (about 90 Mbit/s, the world's
 * median fixed broadband in 2026); after one, it uses the speed it saw.
 */
export const TYPICAL_BYTES_PER_SECOND = 11_000_000;

export function minutesFor(sizeBytes: number, bytesPerSecond = TYPICAL_BYTES_PER_SECOND): number {
  return Math.max(1, Math.round(sizeBytes / Math.max(bytesPerSecond, 100_000) / 60));
}

export function gigabytes(bytes: number): string {
  if (bytes < GB) return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
  const gb = bytes / GB;
  return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
}

/** The model Conch suggests for this computer, and what else would run. */
export function offersFor(input: {
  memoryBytes: number;
  freeDiskBytes?: number;
  version?: string;
  installed: readonly string[];
  bytesPerSecond?: number;
}): LocalOffer[] {
  const runnable = (m: CatalogModel) => atLeast(input.version, m.minVersion);
  const pick = tier(input.memoryBytes)
    .map((name) => byName.get(name))
    .find((m): m is CatalogModel => Boolean(m && runnable(m)));
  const offers = LOCAL_CATALOG.filter(runnable).map((model): LocalOffer => {
    const installed = input.installed.includes(model.name);
    let reason: string | undefined;
    if (!fitsMemory(model.sizeBytes, input.memoryBytes)) {
      reason = `${model.label} needs more memory than this computer has.`;
    } else if (
      !installed &&
      input.freeDiskBytes !== undefined &&
      input.freeDiskBytes < model.sizeBytes + DISK_SPARE
    ) {
      reason = `${model.label} needs ${gigabytes(model.sizeBytes + DISK_SPARE)} of free space, and this computer has ${gigabytes(input.freeDiskBytes)}. Free up about ${gigabytes(model.sizeBytes + DISK_SPARE - input.freeDiskBytes)}, then try again.`;
    }
    return {
      name: model.name,
      label: model.label,
      sizeBytes: model.sizeBytes,
      blurb: model.blurb,
      minutes: minutesFor(model.sizeBytes, input.bytesPerSecond),
      fits: !reason,
      ...(reason && { reason }),
      installed,
      recommended: model.name === pick?.name,
      tools: model.tools,
    };
  });
  // The recommended one first, then the rest biggest first (bigger is usually better).
  return offers.sort(
    (a, b) => Number(b.recommended) - Number(a.recommended) || b.sizeBytes - a.sizeBytes,
  );
}

/**
 * What a person calls a model Ollama has. Conch's own names for the ones it
 * suggests; for anything pulled by hand, the name tidied up ("mistral:7b" →
 * "Mistral 7B").
 */
export function labelFor(name: string, parameters?: string): string {
  const known = byName.get(name);
  if (known) return known.label;
  const bare = name.replace(/:latest$/, '');
  const [base = bare, tag] = bare.split(':');
  const last = base.split('/').pop() ?? base;
  const title = last.charAt(0).toUpperCase() + last.slice(1);
  const size = /^\d+(\.\d+)?[bm]$/i.test(tag ?? '') ? (tag ?? '').toUpperCase() : undefined;
  if (size) return `${title} ${size}`;
  if (tag) return `${title} ${tag}`;
  return parameters ? `${title} ${parameters}` : title;
}

/** Local models, the one chosen first, then biggest first (bigger is usually better). */
export function sortModels(models: LocalModel[], chosen?: string): LocalModel[] {
  return [...models].sort(
    (a, b) => Number(b.name === chosen) - Number(a.name === chosen) || b.sizeBytes - a.sizeBytes,
  );
}
