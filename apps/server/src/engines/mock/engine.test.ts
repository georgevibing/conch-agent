import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EngineEvent, TurnInput } from '../types';
import { prepare } from '../../scripts/wrapper';
import { planWork } from '../../tasks/estimate';
import { MockEngine, TIDY_SCRIPT } from './engine';

function input(signal: AbortSignal): TurnInput {
  return {
    conversationId: 'c1',
    prompt: 'Tell me something long',
    systemAppend: '',
    cwd: '.',
    tools: [],
    requestPermission: async () => 'allow',
    signal,
    options: { effort: 'auto', fastMode: false, permissionMode: 'default' },
  };
}

describe('the mock engine', () => {
  it('stops on a Stop that came between two pauses, not only during one', async () => {
    const engine = new MockEngine({ speed: 0.01 });
    const abort = new AbortController();
    const events: EngineEvent[] = [];
    for await (const event of engine.runTurn(input(abort.signal))) {
      events.push(event);
      // Pressed while the engine is between steps (its abort event has fired by the next pause).
      if (event.type === 'session') abort.abort();
    }
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'interrupted' });
    expect(events.some((e) => e.type === 'done' && e.outcome === 'success')).toBe(false);
  });

  it('plans a batch of tasks the way a small model would, read by the same strict reader (ADR 0129)', async () => {
    const engine = new MockEngine({ speed: 0.001 });
    const parts = [
      { title: 'Read the README', instructions: 'Read README.md and say what’s missing.' },
      { title: 'Check the tests', instructions: 'Run the tests slowly in src/app.ts.' },
      { title: 'Fix the app', instructions: 'Change the greeting in src/app.ts.' },
    ];
    const plan = await planWork(parts, { complete: (i) => engine.complete(i) });
    expect(plan?.map((p) => [p.weight, p.by])).toEqual([
      ['light', 'model'],
      ['heavy', 'model'],
      ['medium', 'model'],
    ]);
    expect(plan?.[1]?.touches).toContain('pair:1-2');
    expect(plan?.[2]?.touches).toContain('pair:1-2');
    const garbled = [{ title: 'x', instructions: 'plan-garbled' }];
    expect(await planWork(garbled, { complete: (i) => engine.complete(i) })).toBeUndefined();
  });
});

describe('the mock engine makes Conch apps (ADR 0061)', () => {
  const run = async (prompt: string) => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const names = [
      'app_guide',
      'app_new',
      'app_write',
      'app_read',
      'app_check',
      'app_try',
      'app_present',
      'app_edit',
      'app_find',
      'app_get',
      'app_share',
    ];
    const tools = names.map((name) => ({
      name,
      description: name,
      input: {},
      run: async (args: Record<string, unknown>) => {
        calls.push({ name, args });
        return name === 'app_present' || name === 'app_get' || name === 'app_share'
          ? 'A card is under your reply.'
          : 'ok';
      },
    }));
    const engine = new MockEngine({ speed: 0.001 });
    const events: EngineEvent[] = [];
    for await (const event of engine.runTurn({
      ...input(new AbortController().signal),
      prompt,
      tools: tools as unknown as TurnInput['tools'],
    }))
      events.push(event);
    const said = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    return { calls, said };
  };

  it('“make me an app”: the guide, a draft, Tally’s files, the check, every tool tried, then the card', async () => {
    const { calls, said } = await run('make me an app that counts things');
    expect(calls.map((c) => c.name)).toEqual([
      'app_guide',
      'app_new',
      'app_write',
      'app_write',
      'app_write',
      'app_write',
      'app_check',
      'app_try',
      'app_try',
      'app_check',
      'app_present',
    ]);
    expect(calls.filter((c) => c.name === 'app_write').map((c) => c.args.path)).toEqual([
      'conch-app.json',
      'tools.mjs',
      'pages/main.html',
      'README.md',
    ]);
    expect(calls.filter((c) => c.name === 'app_try').map((c) => c.args.tool)).toEqual([
      'count',
      'read_count',
    ]);
    expect(said).toMatch(/I made Tally/);
  });

  it('“change the app”, a link, sharing and finding each take their tool', async () => {
    const change = await run('change the app so it counts by two');
    expect(change.calls[1]).toEqual({ name: 'app_edit', args: { app: 'tally' } });
    expect(change.calls.find((c) => c.name === 'app_write')?.args.content).toMatch(
      /"version": "1.1.0"/,
    );
    expect((await run('add the app at https://github.com/bea/weather.')).calls).toEqual([
      { name: 'app_get', args: { link: 'https://github.com/bea/weather' } },
    ]);
    expect((await run('put it on github')).calls).toEqual([
      { name: 'app_share', args: { app: 'tally' } },
    ]);
    expect((await run('is there an app for tracking my plants?')).calls).toEqual([
      { name: 'app_find', args: { query: 'tracking my plants' } },
    ]);
  });
});

describe('the mock engine runs a script that calls tools (ADR 0123)', () => {
  const run = async (prompt: string) => {
    const calls: Record<string, unknown>[] = [];
    const tools = [
      {
        name: 'run_script',
        description: 'run_script',
        input: {},
        run: async (args: Record<string, unknown>) => {
          calls.push(args);
          return 'It returned:\n{ "written": 30, "uploaded": false }';
        },
      },
    ];
    const engine = new MockEngine({ speed: 0.001 });
    const events: EngineEvent[] = [];
    for await (const event of engine.runTurn({
      ...input(new AbortController().signal),
      prompt,
      // Its own folder: "write a note" really writes one.
      cwd: mkdtempSync(join(tmpdir(), 'conch-mock-script-')),
      tools: tools as unknown as TurnInput['tools'],
    }))
      events.push(event);
    const said = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    return { calls, said };
  };

  it('“run a script to tidy my notes” runs one script, which parses, and says what came of it', async () => {
    const { calls, said } = await run('Run a script to tidy my notes');
    expect(calls).toEqual([{ title: 'Tidy my notes, one for each day', script: TIDY_SCRIPT }]);
    expect(() => prepare(TIDY_SCRIPT)).not.toThrow();
    expect(said).toMatch(/a note for each day of the month/);
  });

  it('isn’t set off by the journeys that sound like it', async () => {
    for (const prompt of [
      'write a note about the dentist',
      'tidy my notes',
      'run the tests',
      'run a script',
    ])
      expect((await run(prompt)).calls).toEqual([]);
  });
});
