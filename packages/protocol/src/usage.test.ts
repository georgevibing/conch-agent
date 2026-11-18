import { describe, expect, it } from 'vitest';

import {
  atLimitFor,
  isModelScoped,
  severityFor,
  windowAppliesTo,
  windowsFor,
  type UsageWindow,
} from './usage';

const win = (id: string, usedPercent: number, scope?: string): UsageWindow => ({
  id,
  label: 'This week',
  ...(scope !== undefined && { scope }),
  usedPercent,
  severity: severityFor(usedPercent),
});

/** Claude Max: every model has 33% left, Fable alone 1%. */
const windows = [
  win('session', 12),
  win('weekly', 67, 'all models'),
  win('model:fable', 99, 'Fable'),
];

describe('model-scoped windows', () => {
  it('tells a model’s own window from a shared one', () => {
    expect(isModelScoped({})).toBe(false);
    expect(isModelScoped({ scope: 'all models' })).toBe(false);
    expect(isModelScoped({ scope: 'All models' })).toBe(false);
    expect(isModelScoped({ scope: 'Opus' })).toBe(true);
  });

  it('matches a model by id or name, as whole words, whatever the case', () => {
    const opus = { scope: 'Opus' };
    expect(windowAppliesTo(opus, { id: 'opus' })).toBe(true);
    expect(windowAppliesTo(opus, { id: 'claude-opus-4-8' })).toBe(true);
    expect(windowAppliesTo(opus, { id: 'opus[1m]' })).toBe(true);
    expect(windowAppliesTo(opus, { id: 'x', label: 'Opus 5.5' })).toBe(true);
    expect(windowAppliesTo(opus, { id: 'opusplan' })).toBe(false);
    expect(windowAppliesTo(opus, { id: 'sonnet' })).toBe(false);
    expect(windowAppliesTo({ scope: 'Fable' }, { id: 'FABLE' })).toBe(true);
  });

  it('counts a model’s own window for nothing when the model is unknown', () => {
    expect(windowAppliesTo({ scope: 'Fable' }, undefined)).toBe(false);
    expect(windowAppliesTo({ scope: 'Fable' }, { id: 'default' })).toBe(false);
    expect(windowsFor(windows, undefined).map((w) => w.id)).toEqual(['session', 'weekly']);
    expect(windowsFor(windows, { id: 'fable' }).map((w) => w.id)).toEqual([
      'session',
      'weekly',
      'model:fable',
    ]);
  });
});

describe('atLimitFor', () => {
  const used = windows.map((w) => (w.id === 'model:fable' ? { ...w, usedPercent: 100 } : w));

  it('holds a model’s own used-up window against that model only', () => {
    expect(atLimitFor({ windows: used }, { id: 'fable' })).toBe(true);
    expect(atLimitFor({ windows: used }, { id: 'opus' })).toBe(false);
    expect(atLimitFor({ windows: used }, undefined)).toBe(false);
    expect(atLimitFor({ windows }, { id: 'fable' })).toBe(false);
  });

  it('holds a block for the models it names, and every block that names none', () => {
    const fable = { windows: used, blocked: { windowId: 'model:fable' } };
    expect(atLimitFor(fable, { id: 'opus' })).toBe(false);
    expect(atLimitFor(fable, { id: 'fable' })).toBe(true);
    expect(atLimitFor({ windows, blocked: {} }, { id: 'opus' })).toBe(true);
    expect(atLimitFor({ windows, blocked: { windowId: 'session' } }, undefined)).toBe(true);
    expect(atLimitFor(undefined, { id: 'opus' })).toBe(false);
  });
});
