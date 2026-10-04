import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { EngineEvent, HostTool } from '../engines/types';
import { guardTurn } from './turn-guard';

const roomy = { steps: 100, tokens: 1e9, ms: 1e9 };

async function collect(events: AsyncIterable<EngineEvent>) {
  const out: EngineEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

/** A program running its own loop (Codex's shell), stopping only when told to. */
async function* program(
  signal: AbortSignal,
  call: (i: number) => { name: string; input: unknown; output: string },
  max = 50,
): AsyncIterable<EngineEvent> {
  for (let i = 0; i < max; i++) {
    if (signal.aborted) {
      yield { type: 'done', outcome: 'interrupted' };
      return;
    }
    const { name, input, output } = call(i);
    yield { type: 'tool-start', toolUseId: `t${i}`, name, input };
    yield { type: 'tool-end', toolUseId: `t${i}`, status: 'success', output };
  }
  yield { type: 'done', outcome: 'success' };
}

describe('the turn budget from outside (ADR 0081)', () => {
  it('leaves an engine that keeps its own budget alone', () => {
    const tools: HostTool[] = [];
    const signal = new AbortController().signal;
    const pace = guardTurn({ turnBudget: 'own' }, { budget: roomy, tools, signal });
    expect(pace.tools).toBe(tools);
    expect(pace.signal).toBe(signal);
  });

  it('pauses a program repeating its own command, and says so as a pause', async () => {
    const stop = new AbortController();
    const pace = guardTurn({}, { budget: roomy, tools: [], signal: stop.signal });
    const events = await collect(
      pace.events(
        program(pace.signal, () => ({
          name: 'shell',
          input: { command: 'npm test' },
          output: 'fail',
        })),
      ),
    );
    expect(events.filter((e) => e.type === 'tool-start').length).toBeLessThanOrEqual(6);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'success',
      paused: { reason: 'loop' },
    });
  });

  it('caps a program by its calls, and lets varied work run', async () => {
    const stop = new AbortController();
    const pace = guardTurn(
      {},
      { budget: { steps: 10, tokens: 1e9, ms: 1e9 }, tools: [], signal: stop.signal },
    );
    const events = await collect(
      pace.events(
        program(pace.signal, (i) => ({
          name: 'shell',
          input: { command: `step ${i}` },
          output: `ok ${i}`,
        })),
      ),
    );
    expect(events.filter((e) => e.type === 'tool-start')).toHaveLength(21);
    expect(events.at(-1)).toMatchObject({ paused: { reason: 'steps' } });
  });

  it('a Stop from the person stays a Stop', async () => {
    const stop = new AbortController();
    const pace = guardTurn({}, { budget: roomy, tools: [], signal: stop.signal });
    stop.abort();
    const events = await collect(
      pace.events(program(pace.signal, () => ({ name: 'shell', input: {}, output: '' }))),
    );
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'interrupted' });
  });

  it('points a loop out in the answer of Conch’s own tools before it pauses', async () => {
    const tool: HostTool<{ q: z.ZodString }> = {
      name: 'recall',
      description: 'Search memory.',
      input: { q: z.string() },
      run: async () => 'Nothing found.',
    };
    const stop = new AbortController();
    const pace = guardTurn({}, { budget: roomy, tools: [tool as HostTool], signal: stop.signal });
    const [wrapped] = pace.tools;
    const answers: string[] = [];
    for (let i = 0; i < 5; i++) {
      const result = await wrapped?.run({ q: 'tea' } as never);
      answers.push(typeof result === 'string' ? result : (result?.text ?? ''));
    }
    expect(answers[1]).toBe('Nothing found.');
    expect(answers[2]).toContain('From Conch');
    expect(answers[4]).toMatch(/^Not run/);
    expect(pace.signal.aborted).toBe(true);
  });

  it('pauses a program that runs past its time, even when it goes quiet', async () => {
    const stop = new AbortController();
    const pace = guardTurn(
      {},
      { budget: { steps: 100, tokens: 1e9, ms: 20 }, tools: [], signal: stop.signal },
    );
    async function* quiet(): AsyncIterable<EngineEvent> {
      await new Promise<void>((resolve) => pace.signal.addEventListener('abort', () => resolve()));
      yield { type: 'done', outcome: 'interrupted' };
    }
    const events = await collect(pace.events(quiet()));
    expect(events.at(-1)).toMatchObject({ outcome: 'success', paused: { reason: 'time' } });
  });
});
