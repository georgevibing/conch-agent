import { taskArgumentHash } from './operations';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerTaskRoutes } from './routes';
import { TaskError, type TaskService } from './service';

describe('task continuation API', () => {
  it('validates user instructions and never accepts a caller-supplied scope', async () => {
    const app = Fastify();
    const next = vi.fn(async () => ({ id: 'task_1', status: 'queued' }));
    registerTaskRoutes(app, { continue: next } as unknown as TaskService);
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/tasks/task_1/continue',
      payload: { text: '   ' },
    });
    expect(malformed.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
    const valid = await app.inject({
      method: 'POST',
      url: '/api/tasks/task_1/continue',
      payload: {
        text: 'Make the introduction shorter',
        requestKey: 'revision-1',
        toolScope: { names: ['Bash'] },
      },
    });
    expect(valid.statusCode).toBe(200);
    expect(next).toHaveBeenCalledExactlyOnceWith(
      'task_1',
      'Make the introduction shorter',
      'revision-1',
    );
    await app.close();
  });
});

it('accepts bounded outcome checks without accepting tool authority, hashing exact arguments', async () => {
  const app = Fastify();
  const create = vi.fn(async (_input: unknown) => ({ id: 't', status: 'queued' }));
  registerTaskRoutes(app, { create } as unknown as TaskService);
  const reply = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      text: 'Read the file',
      checks: [{ tool: 'mcp__conch__read_file', arguments: { file_path: 'x' } }],
      toolScope: { names: ['Bash'] },
    },
  });
  expect(reply.statusCode).toBe(200);
  expect(create).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      expectations: [
        { tool: 'read_file', minimum: 1, inputHash: taskArgumentHash({ file_path: 'x' }) },
      ],
    }),
  );
  expect(create.mock.calls[0]?.[0]).not.toHaveProperty('toolScope');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { text: 'Read', checks: [{ tool: 'mcp__conch__' }] },
      })
    ).statusCode,
  ).toBe(400);
  expect(create).toHaveBeenCalledTimes(1);
  await app.close();
});

it('starts a waiting task now, and says why when it can’t (ADR 0128)', async () => {
  const app = Fastify();
  const startNow = vi.fn(async (id: string) => {
    if (id === 'held') throw new TaskError('busy', 'This one waits for something other than room.');
    return { id, status: 'queued', startNow: true };
  });
  registerTaskRoutes(app, { startNow } as unknown as TaskService);
  const ok = await app.inject({ method: 'POST', url: '/api/tasks/t1/start-now', payload: {} });
  expect(ok.statusCode).toBe(200);
  expect(ok.json()).toMatchObject({ startNow: true });
  const held = await app.inject({ method: 'POST', url: '/api/tasks/held/start-now', payload: {} });
  expect(held.statusCode).toBe(409);
  expect(held.json()).toMatchObject({ message: 'This one waits for something other than room.' });
  await app.close();
});
