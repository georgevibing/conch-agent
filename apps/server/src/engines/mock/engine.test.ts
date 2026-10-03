import { describe, expect, it } from 'vitest';

import type { EngineEvent, TurnInput } from '../types';
import { MockEngine } from './engine';

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
