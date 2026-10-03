import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import type { ToolContext } from '../conversations/manager';
import { QuestionDesk } from './desk';
import { registerQuestionRoutes } from './routes';

async function setup() {
  const desk = new QuestionDesk();
  const app = Fastify();
  registerQuestionRoutes(app, desk);
  const appended: { type: string }[] = [];
  const ctx = {
    conversationId: 'c1',
    append: (e: { type: string }) => appended.push(e),
    signal: new AbortController().signal,
  } as unknown as ToolContext;
  const told = desk.ask(ctx, {
    fields: [
      {
        id: 'how',
        label: 'How?',
        kind: 'choice',
        optional: false,
        multiple: false,
        other: false,
        options: [
          { id: 'video', label: 'Video call' },
          { id: 'phone', label: 'Phone call' },
        ],
      },
    ],
  });
  const questionId = desk.waiting('c1')?.questionId ?? '';
  const post = (body: Record<string, unknown>, id = questionId) =>
    app.inject({
      method: 'POST',
      url: `/api/conversations/c1/questions/${id}/answer`,
      payload: body,
    });
  return { post, told, appended };
}

describe('POST /api/conversations/:id/questions/:questionId/answer', () => {
  it('takes an answer that fits, and says plainly when one doesn’t', async () => {
    const { post, told } = await setup();
    expect((await post({ nope: true })).statusCode).toBe(400);
    const wrong = await post({ answer: { values: { how: 'pigeon' }, text: 'x' } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toMatchObject({ error: 'invalid' });
    expect((await post({ answer: null }, 'q_other')).statusCode).toBe(404);
    const ok = await post({ answer: { values: { how: 'phone' }, text: 'x' } });
    expect(ok.json()).toEqual({ ok: true });
    await expect(told).resolves.toContain('They answered: Phone call');
    // Pressed again from another device.
    const late = await post({ answer: null });
    expect(late.statusCode).toBe(409);
    expect(late.json()).toMatchObject({ error: 'answered' });
  });
});
