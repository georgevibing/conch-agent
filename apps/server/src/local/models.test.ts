import { describe, expect, it } from 'vitest';

import { LocalModelName } from '@conch/protocol';

import {
  atLeast,
  fitsMemory,
  labelFor,
  LOCAL_CATALOG,
  minutesFor,
  offersFor,
  sortModels,
} from './models';

const GiB = 1024 ** 3;
const recommended = (memoryGiB: number, version?: string) =>
  offersFor({
    memoryBytes: memoryGiB * GiB,
    installed: [],
    ...(version && { version }),
  }).find((o) => o.recommended)?.name;

describe('which model to suggest', () => {
  it('suggests by memory, as the OS reports it', () => {
    expect(recommended(3.8)).toBe('qwen3.5:2b-q4_K_M');
    // An "8 GB" laptop.
    expect(recommended(7.6)).toBe('qwen3:4b-instruct');
    // A "16 GB" one.
    expect(recommended(15.4)).toBe('qwen3.5:9b');
    expect(recommended(31.1)).toBe('qwen3.5:9b');
    expect(recommended(63.7)).toBe('qwen3.6:35b-a3b');
  });

  it('only suggests what this Ollama can run', () => {
    expect(recommended(3.8, '0.16.0')).toBe('qwen3:1.7b');
    expect(recommended(15.4, '0.12.3')).toBe('qwen3:8b');
    expect(recommended(63.7, '0.20.0')).toBe('qwen3.5:9b');
    expect(recommended(15.4, '0.35.0')).toBe('qwen3.5:9b');
  });

  it('never offers what won’t fit, and says why', () => {
    const offers = offersFor({ memoryBytes: 7.6 * GiB, freeDiskBytes: 3e9, installed: [] });
    const big = offers.find((o) => o.name === 'qwen3.6:35b-a3b');
    expect(big).toMatchObject({
      fits: false,
      reason: 'Qwen3.6 35B needs more memory than this computer has.',
    });
    const pick = offers.find((o) => o.recommended);
    expect(pick).toMatchObject({ name: 'qwen3:4b-instruct', fits: false });
    expect(pick?.reason).toBe(
      'Qwen3 4B needs 4.5 GB of free space, and this computer has 3.0 GB. Free up about 1.5 GB, then try again.',
    );
    // The recommended one comes first.
    expect(offers[0]?.recommended).toBe(true);
  });

  it('doesn’t count disk against a model that’s already here', () => {
    const [pick] = offersFor({
      memoryBytes: 7.6 * GiB,
      freeDiskBytes: 1e9,
      installed: ['qwen3:4b-instruct'],
    });
    expect(pick).toMatchObject({ installed: true, fits: true });
  });

  it('estimates the download from a typical connection, or the one it saw', () => {
    expect(minutesFor(2_019_393_189)).toBe(3);
    expect(minutesFor(2_019_393_189, 2_000_000)).toBe(17);
    expect(minutesFor(10)).toBe(1);
  });

  it('keeps memory honest', () => {
    expect(fitsMemory(6.6e9, 15.4 * GiB)).toBe(true);
    expect(fitsMemory(22.6e9, 15.4 * GiB)).toBe(false);
  });

  it('compares versions numerically', () => {
    expect(atLeast('0.17.1', '0.9.0')).toBe(true);
    expect(atLeast('0.9.0', '0.17.1')).toBe(false);
    expect(atLeast('v0.30.0-rc1', '0.30.0')).toBe(true);
    expect(atLeast(undefined, '0.30.0')).toBe(true);
  });

  it('only lists names that are safe to send', () => {
    for (const model of LOCAL_CATALOG) {
      expect(LocalModelName.safeParse(model.name).success).toBe(true);
      expect(model.name).not.toContain('/');
    }
  });

  it('names models the way a person would', () => {
    expect(labelFor('qwen3:4b-instruct')).toBe('Qwen3 4B');
    expect(labelFor('mistral:7b')).toBe('Mistral 7B');
    expect(labelFor('phi4-mini:latest', '3.8B')).toBe('Phi4-mini 3.8B');
    expect(labelFor('hf.co/bartowski/Llama-3.2-3B-GGUF:Q4_K_M')).toBe('Llama-3.2-3B-GGUF Q4_K_M');
  });

  it('puts the chosen model first, then the biggest', () => {
    const m = (name: string, sizeBytes: number) => ({
      name,
      label: name,
      sizeBytes,
      tools: true,
      vision: false,
      thinking: false,
    });
    expect(sortModels([m('a', 1), m('b', 3), m('c', 2)], 'a').map((x) => x.name)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
