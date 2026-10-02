import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerTaskRoutes } from './routes';
import type { TaskService } from './service';

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
