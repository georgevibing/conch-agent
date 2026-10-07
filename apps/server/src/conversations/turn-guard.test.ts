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

describe('the turn budget from outside (ADR 0085)', () => {
  it('leaves an engine that keeps its own budget alone', () => {
    const tools: HostTool[] = [];
    const signal = new AbortController().signal;
    const pace = guardTurn({ turnBudget: 'own' }, { budget: roomy, tools, signal });
    expect(pace.tools).toBe(tools);
    expect(pace.signal).toBe(signal);
  });

  it('pauses a program running the very same command for the very same answer, and says so as a pause', async () => {
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
    expect(events.filter((e) => e.type === 'tool-start').length).toBeLessThanOrEqual(11);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'success',
      paused: { reason: 'loop' },
    });
  });

  it('lets a program check on a test run, fail tests and search for nothing on its way', async () => {
    const stop = new AbortController();
    const pace = guardTurn({}, { budget: roomy, tools: [], signal: stop.signal });
    const events = await collect(
      pace.events(
        program(pace.signal, (i) =>
          i % 3 === 0
            ? {
                name: 'shell',
                input: { command: "python3 - <<'PY' check PY" },
                output: `${i} passed`,
              }
            : i % 3 === 1
              ? { name: 'shell', input: { command: `grep -rn thing${i}` }, output: '' }
              : { name: 'shell', input: { command: 'pnpm test' }, output: `FAIL ${i}` },
        ),
      ),
    );
    expect(events.filter((e) => e.type === 'tool-start')).toHaveLength(50);
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'success' });
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
    for (let i = 0; i < 11; i++) {
      const result = await wrapped?.run({ q: 'tea' } as never);
      answers.push(typeof result === 'string' ? result : (result?.text ?? ''));
    }
    expect(answers[1]).toBe('Nothing found.');
    expect(answers[2]).toContain('From Conch');
    expect(answers[5]).toContain('From Conch');
    expect(answers[9]).toMatch(/^Nothing found/);
    expect(answers[10]).toMatch(/^Not run/);
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

describe('failures from Conch’s own tools (ADR 0101)', () => {
  const live = () => new AbortController().signal;
  const only = (tools: HostTool[]) => {
    const [tool] = tools;
    if (!tool) throw new Error('no tool');
    return tool;
  };

  it('count toward the word to step back, carried in the error the model reads', async () => {
    let n = 0;
    const flaky: HostTool = {
      name: 'browser_click',
      description: 'Click',
      input: { ref: z.string() },
      run: async () => {
        throw new Error(`Something is covering that button (${++n}).`);
      },
    };
    const pace = guardTurn({}, { budget: roomy, tools: [flaky], signal: live() });
    const said: string[] = [];
    for (let i = 0; i < 4; i++)
      said.push(
        await only(pace.tools)
          .run({ ref: `e${i}` })
          .then(String, (e: Error) => e.message),
      );
    // The first three are the tool's own words; the fourth also says to step back.
    expect(said.slice(0, 3).every((s) => !s.includes('[From Conch'))).toBe(true);
    expect(said[3]).toMatch(/^Something is covering that button \(4\)\./);
    expect(said[3]).toMatch(/the last 4 tool calls failed\. Step back/);
  });

  it('stay failures: what was thrown is thrown as it was, until there is a word to add', async () => {
    const boom = new Error('No such file.');
    const tool: HostTool = {
      name: 'files_read',
      description: 'Read',
      input: {},
      run: async () => {
        throw boom;
      },
    };
    const pace = guardTurn({}, { budget: roomy, tools: [tool], signal: live() });
    await expect(only(pace.tools).run({})).rejects.toBe(boom);
  });

  it('a success in between starts the count again', async () => {
    let n = 0;
    const tool: HostTool = {
      name: 'files_read',
      description: 'Read',
      input: { path: z.string() },
      run: async () => {
        if (++n === 3) return 'contents';
        throw new Error('No such file.');
      },
    };
    const pace = guardTurn({}, { budget: roomy, tools: [tool], signal: live() });
    const said: string[] = [];
    for (let i = 0; i < 5; i++)
      said.push(
        await only(pace.tools)
          .run({ path: `p${i}` })
          .then(String, (e: Error) => e.message),
      );
    expect(said.some((s) => s.includes('[From Conch'))).toBe(false);
  });
});
