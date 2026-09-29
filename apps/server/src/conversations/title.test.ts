import type { Capabilities } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { CompletionInput } from '../engines/types';
import { cheapestModel, cleanTitle, generateTitle, titlePrompt } from './title';

describe('cleanTitle', () => {
  it('keeps a good title and tidies it', () => {
    expect(cleanTitle('Debugging a flaky CI job')).toBe('Debugging a flaky CI job');
    expect(cleanTitle('"Plan a weekend in Lisbon."')).toBe('Plan a weekend in Lisbon');
    expect(cleanTitle('Title: **Refactor the auth flow**')).toBe('Refactor the auth flow');
    expect(cleanTitle('  friendly check-in  \n\nextra line')).toBe('Friendly check-in');
    expect(cleanTitle('“Résumé tips”')).toBe('Résumé tips');
  });

  it('rejects replies that are not good enough', () => {
    expect(cleanTitle('')).toBeUndefined();
    expect(cleanTitle('\n  \n')).toBeUndefined();
    expect(cleanTitle('Hi')).toBeUndefined();
    expect(cleanTitle('Untitled')).toBeUndefined();
    expect(cleanTitle('New conversation')).toBeUndefined();
    expect(cleanTitle("I'm sorry, I can't help with naming that")).toBeUndefined();
    expect(cleanTitle("Here's a title: Lisbon trip")).toBeUndefined();
    expect(cleanTitle('A very long title that goes on and on and never seems to end at all')).toBe(
      undefined,
    );
    expect(cleanTitle('x'.repeat(61))).toBeUndefined();
  });
});

describe('cheapestModel', () => {
  it('prefers Haiku-class models by id or name', () => {
    expect(
      cheapestModel([
        { id: 'default', label: 'Default' },
        { id: 'opus', label: 'Opus' },
        { id: 'haiku', label: 'Haiku' },
      ]),
    ).toBe('haiku');
    expect(
      cheapestModel([{ id: 'us.anthropic.claude-haiku-4-5-v1:0', label: 'Claude 4.5 fast' }]),
    ).toBe('us.anthropic.claude-haiku-4-5-v1:0');
    expect(cheapestModel([{ id: 'x-1', label: 'Small (Haiku)' }])).toBe('x-1');
  });

  it('falls back to the default when nothing cheap is offered', () => {
    expect(cheapestModel([{ id: 'opus', label: 'Opus' }])).toBeUndefined();
    expect(cheapestModel([])).toBeUndefined();
  });
});

function fakeEngine(models: string[], reply: (input: CompletionInput) => Promise<string>) {
  const capabilities = vi.fn(
    async () =>
      ({
        models: models.map((id) => ({ id, label: id })),
      }) as unknown as Capabilities,
  );
  const complete = vi.fn(async (input: CompletionInput) => ({
    text: await reply(input),
    usage: { inputTokens: 100, outputTokens: 6, costUsd: 0.0001 },
  }));
  return { capabilities, complete };
}

describe('generateTitle', () => {
  const signal = new AbortController().signal;

  it('asks the cheapest model with a short, tool-free prompt', async () => {
    const engine = fakeEngine(['default', 'opus', 'haiku'], async () => 'Espresso machine repair');
    const result = await generateTitle(engine, 'my espresso machine leaks, help', signal);
    expect(result).toEqual({
      title: 'Espresso machine repair',
      usage: { inputTokens: 100, outputTokens: 6, costUsd: 0.0001 },
    });
    expect(engine.complete).toHaveBeenCalledOnce();
    expect(engine.complete.mock.calls[0]?.[0]).toMatchObject({ model: 'haiku' });
  });

  it('falls back to the default model when the cheap one fails', async () => {
    const engine = fakeEngine(['haiku'], async ({ model }) => {
      if (model === 'haiku') throw new Error('not on this plan');
      return 'Quarterly report outline';
    });
    const result = await generateTitle(engine, 'outline the Q3 report', signal);
    expect(result.title).toBe('Quarterly report outline');
    expect(engine.complete.mock.calls.map(([i]) => i.model)).toEqual(['haiku', undefined]);
  });

  it('does not pay a bigger model to retry a poor title', async () => {
    const engine = fakeEngine(['haiku'], async () => 'Untitled');
    const result = await generateTitle(engine, 'hmm', signal);
    expect(result.title).toBeUndefined();
    expect(result.usage?.costUsd).toBe(0.0001);
    expect(engine.complete).toHaveBeenCalledOnce();
  });

  it("uses the engine's small-model alias when the list hides it", async () => {
    const engine = {
      ...fakeEngine(['default', 'opus'], async () => 'Weekend plans'),
      smallModel: 'haiku',
    };
    expect((await generateTitle(engine, 'plans?', signal)).title).toBe('Weekend plans');
    expect(engine.complete.mock.calls[0]?.[0].model).toBe('haiku');
  });

  it('uses the default model when capabilities are unavailable', async () => {
    const engine = fakeEngine([], async () => 'Weekend plans');
    engine.capabilities.mockRejectedValueOnce(new Error('offline'));
    expect((await generateTitle(engine, 'plans?', signal)).title).toBe('Weekend plans');
    expect(engine.complete.mock.calls[0]?.[0].model).toBeUndefined();
  });

  it('gives up quietly when every attempt fails or the engine cannot complete', async () => {
    const engine = fakeEngine([], async () => {
      throw new Error('down');
    });
    expect(await generateTitle(engine, 'anything', signal)).toEqual({});
    expect(await generateTitle({ capabilities: engine.capabilities }, 'x', signal)).toEqual({});
  });

  it('trims huge openers before sending them', () => {
    const prompt = titlePrompt(`${'log line\n'.repeat(1000)}`);
    expect(prompt.length).toBeLessThan(2_200);
  });
});
