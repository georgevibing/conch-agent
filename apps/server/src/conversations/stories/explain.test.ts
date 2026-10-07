import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ExplainStepResult, type ConversationEvent, type ServerEvent } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../app';
import { loadConfig } from '../../config';
import type { Engine } from '../../engines/types';
import { Services } from '../../services';
import { NOT_HERE, onThisComputer } from '../../test/here';
import { NOT_ASKED_WORDS } from './ask';
import { ExplainError, StoryExplainer, stepContext, type StoryExplainerDeps } from './explain';

let seq = 0;
const ev = (event: Record<string, unknown>) =>
  ({ conversationId: 'c1', seq: seq++, at: seq, ...event }) as ConversationEvent;

const LOG: ConversationEvent[] = [
  ev({ type: 'user.message', messageId: 'u0', text: 'Earlier question' }),
  ev({ type: 'user.message', messageId: 'u1', text: 'Why is the build red?' }),
  ev({ type: 'assistant.delta', messageId: 'm1', kind: 'thinking', delta: 'private' }),
  ev({ type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Let me look ' }),
  ev({ type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'at the CI log.' }),
  ev({ type: 'tool.started', toolUseId: 't1', name: 'Read', input: { file_path: 'ci.log' } }),
  ev({ type: 'tool.finished', toolUseId: 't1', status: 'success', output: 'error TS2322' }),
  ev({ type: 'tool.started', toolUseId: 't2', name: 'Bash', input: { command: 'npm test' } }),
];

function explainer(overrides: Partial<StoryExplainerDeps> = {}) {
  const engine = { id: 'anthropic', label: 'Anthropic' } as unknown as Engine;
  const complete = vi.fn(async () => ({
    text: 'It read the CI log to find the error. It learned a type check fails.',
    usage: { inputTokens: 300, outputTokens: 20 },
  }));
  const spent = vi.fn();
  let now = 0;
  const why = new StoryExplainer({
    events: async () => LOG,
    model: async () => ({ engine, complete, model: 'small' }),
    allow: async () => ({ ok: true }),
    spent,
    now: () => now,
    ...overrides,
  });
  return { why, complete, spent, tick: (ms: number) => (now += ms) };
}

describe('“Why?” on a step (ADR 0103)', () => {
  it('reads the request, what was said just before, the call and what it found', () => {
    const context = stepContext(LOG, 't1');
    expect(context).toMatchObject({
      request: 'Why is the build red?',
      said: 'Let me look at the CI log.',
      name: 'Read',
      input: '{"file_path":"ci.log"}',
      output: 'error TS2322',
      status: 'success',
    });
    expect(context?.label.done).toBeTruthy();
    expect(stepContext(LOG, 'nope')).toBeUndefined();
    expect(stepContext(LOG, 't2')?.status).toBe('still running');
  });

  it('answers from the small model, counts the cost, and remembers the answer', async () => {
    const h = explainer();
    const first = await h.why.explain('c1', 't1');
    expect(first).toEqual({
      answer: 'It read the CI log to find the error. It learned a type check fails.',
    });
    expect(await h.why.explain('c1', 't1')).toEqual(first);
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(h.spent).toHaveBeenCalledTimes(1);
    const prompt = (h.complete.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).toContain('<said>Let me look at the CI log.</said>');
    expect(prompt).not.toContain('private');
  });

  it('asks again about a step that was still running', async () => {
    const h = explainer();
    await h.why.explain('c1', 't2');
    await h.why.explain('c1', 't2');
    expect(h.complete).toHaveBeenCalledTimes(2);
  });

  it('says plainly why there’s no answer', async () => {
    expect(await explainer({ model: async () => undefined }).why.explain('c1', 't1')).toEqual({
      unavailable: NOT_ASKED_WORDS.none,
    });
    expect(
      await explainer({ allow: async () => ({ ok: false, reason: 'cap' }) }).why.explain(
        'c1',
        't1',
      ),
    ).toEqual({ unavailable: NOT_ASKED_WORDS.cap });
    const failing = explainer();
    failing.complete.mockRejectedValueOnce(new Error('overloaded'));
    expect(await failing.why.explain('c1', 't1')).toEqual({ unavailable: NOT_ASKED_WORDS.failed });
    const refusing = explainer();
    refusing.complete.mockResolvedValueOnce({
      text: 'Sorry, I can’t help.',
      usage: undefined,
    } as never);
    expect(await refusing.why.explain('c1', 't1')).toEqual({ unavailable: NOT_ASKED_WORDS.failed });
  });

  it('takes a few questions a minute from a chat, then asks it to wait', async () => {
    const h = explainer({ perMinute: 2 });
    await h.why.explain('c1', 't2');
    await h.why.explain('c1', 't2');
    expect(await h.why.explain('c1', 't2')).toEqual({ unavailable: NOT_ASKED_WORDS.busy });
    h.tick(61_000);
    expect((await h.why.explain('c1', 't2')).answer).toBeTruthy();
  });

  it('says a step that isn’t there isn’t there', async () => {
    await expect(explainer().why.explain('c1', 'gone')).rejects.toBeInstanceOf(ExplainError);
  });
});

describe('POST /api/conversations/:id/explain', () => {
  const open: { close(): Promise<void> }[] = [];
  afterEach(async () => {
    while (open.length) await open.pop()?.close();
  });

  async function setup() {
    process.env.CONCH_MOCK_SPEED = '0.02';
    const services = new Services(
      loadConfig({
        CONCH_HOME: await mkdtemp(join(tmpdir(), 'conch-explain-api-')),
        CONCH_ENGINE: 'mock',
        CONCH_LOG_LEVEL: 'silent',
        CONCH_WEB_DIST: '/nonexistent',
      }),
    );
    const app = onThisComputer(await buildApp(services), services);
    open.push(app);
    services.learning.stop();
    const id = await new Promise<string>((resolve) => {
      const off = services.broadcast.on((event: ServerEvent) => {
        if (event.type === 'conversation.event' && event.event.type === 'turn.completed') {
          off();
          resolve(event.event.conversationId);
        }
      });
      void services.conversations.send({ clientMessageId: 'm1', text: 'Please look around' });
    });
    const { events } = await services.conversations.detail(id);
    const step = events.find((e) => e.type === 'tool.started');
    if (step?.type !== 'tool.started') throw new Error('no step');
    return { app, services, id, toolUseId: step.toolUseId };
  }

  it('answers for a step in the chat, from the chat’s own provider', async () => {
    const { app, id, toolUseId } = await setup();
    const reply = await app.inject({
      method: 'POST',
      url: `/api/conversations/${id}/explain`,
      payload: { toolUseId },
    });
    expect(reply.statusCode).toBe(200);
    const result = ExplainStepResult.parse(reply.json());
    expect(result.answer).toMatch(/^It did this to see what was there/);
  });

  it('refuses a body that isn’t right, and a chat or step that isn’t there', async () => {
    const { app, id } = await setup();
    const post = (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
    expect((await post(`/api/conversations/${id}/explain`, {})).statusCode).toBe(400);
    expect(
      (await post(`/api/conversations/${id}/explain`, { toolUseId: 'x', extra: true })).statusCode,
    ).toBe(400);
    expect((await post(`/api/conversations/${id}/explain`, { toolUseId: 'gone' })).statusCode).toBe(
      404,
    );
    expect(
      (await post('/api/conversations/c_nothere0000/explain', { toolUseId: 'x' })).statusCode,
    ).toBe(404);
    expect(
      (await post('/api/conversations/..%2F..%2Fetc/explain', { toolUseId: 'x' })).statusCode,
    ).toBe(404);
  });

  it('is only for the person signed in', async () => {
    const { app, id, toolUseId } = await setup();
    const reply = await app.inject({
      method: 'POST',
      url: `/api/conversations/${id}/explain`,
      payload: { toolUseId },
      headers: { [NOT_HERE]: '1' },
    });
    expect([401, 403]).toContain(reply.statusCode);
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/conversations/${id}/explain`,
      payload: { toolUseId },
      headers: { origin: 'https://evil.example' },
    });
    expect([401, 403]).toContain(foreign.statusCode);
  });
});
