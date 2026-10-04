import { describe, expect, it } from 'vitest';

import type { Engine } from '../engines/types';
import { canCarryTools, carryTools } from './capabilities';

const engine = (tools: boolean, shell = true): Engine => ({
  id: 'mock',
  label: 'Test',
  integrations: { mode: 'bridge' },
  detect: async () => {
    throw new Error('Not called');
  },
  capabilities: async () => ({
    engine: 'mock',
    label: 'Test',
    models: [
      {
        id: 'm',
        label: 'M',
        description: '',
        efforts: [],
        supportsFastMode: false,
        supportsAutoMode: false,
        tools,
      },
    ],
    commands: [],
    permissionModes: ['default'],
    tools: { host: true, files: true, shell, approvals: true },
  }),
  async *runTurn() {
    yield { type: 'done', outcome: 'success' };
  },
});

describe('capability-aware fallback', () => {
  it('refuses a chat-only fallback for a tool-capable source', async () => {
    expect(await canCarryTools(engine(true), engine(false))).toBe(false);
  });
  it('refuses to drop commands or approvals but allows equivalent configured providers', async () => {
    expect(await canCarryTools(engine(true), engine(true, false))).toBe(false);
    expect(await canCarryTools(engine(true), engine(true))).toBe(true);
  });
});

/** A provider with these models, `tools` per model as its list says. */
const listing = (...models: [id: string, tools?: boolean][]): Engine => ({
  ...engine(true),
  capabilities: async () => ({
    ...(await engine(true).capabilities()),
    models: models.map(([id, tools]) => ({
      id,
      label: id,
      description: '',
      efforts: [],
      supportsFastMode: false,
      supportsAutoMode: false,
      ...(tools !== undefined && { tools }),
    })),
  }),
});

describe('the models that answer (ADR 0050)', () => {
  it('lets anything carry a turn the chat’s own model could only chat in', async () => {
    const from = listing(['lite', false], ['big', true]);
    expect(await carryTools(from, engine(false), { fromModel: 'lite' })).toEqual({});
    expect(await carryTools(from, engine(false), { fromModel: 'big' })).toBe(false);
  });

  it('judges the model the fallback answers with, not its first', async () => {
    const to = listing(['small', false], ['able', true]);
    expect(await carryTools(engine(true), to, { toModel: 'able' })).toEqual({ model: 'able' });
    expect(await carryTools(engine(true), to, { toModel: 'small' })).toBe(false);
    expect(await carryTools(engine(true), to)).toBe(false);
  });

  it('chooses another of its models that can, only when told it may', async () => {
    const to = listing(['default', false], ['tiny', false], ['able', true]);
    expect(await carryTools(engine(true), to, { choose: true })).toEqual({ model: 'able' });
    expect(await carryTools(engine(true), listing(['tiny', false]), { choose: true })).toBe(false);
  });
});

/** A provider with these models, as [id, tools, sees]. */
const seeing = (...models: [id: string, tools: boolean, images?: boolean][]): Engine => ({
  ...engine(true),
  capabilities: async () => ({
    ...(await engine(true).capabilities()),
    models: models.map(([id, tools, images]) => ({
      id,
      label: id,
      description: '',
      efforts: [],
      supportsFastMode: false,
      supportsAutoMode: false,
      tools,
      ...(images !== undefined && { images }),
    })),
  }),
});

describe('a turn that carries pictures (ADR 0069)', () => {
  const local = seeing(
    ['qwen3:4b', true, false],
    ['gemma3:4b', true, true],
    ['moondream', false, true],
  );

  it('chooses a model that sees and keeps the apps, where choosing is allowed', async () => {
    expect(await carryTools(engine(true), local, { choose: true, sight: true })).toEqual({
      model: 'gemma3:4b',
    });
  });

  it('keeps the model as it was without pictures, or where it isn’t its choice to make', async () => {
    expect(await carryTools(engine(true), local, { choose: true })).toEqual({});
    // Your pick at a limit answers with its own model: another would be a spending choice.
    expect(await carryTools(engine(true), local, { sight: true })).toEqual({});
  });

  it('never trades the apps for eyes', async () => {
    const blindOnly = seeing(['qwen3:4b', true, false], ['moondream', false, true]);
    expect(await carryTools(engine(true), blindOnly, { choose: true, sight: true })).toEqual({});
  });
});
