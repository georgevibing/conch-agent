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
