import { Task, TaskList, type CreateTaskBody } from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

export const tasksApi = {
  list: () => request(TaskList, '/api/tasks'),
  create: (body: z.input<typeof CreateTaskBody>) =>
    request(Task, '/api/tasks', { method: 'POST', body }),
  stop: (id: string) => request(Task, `/api/tasks/${id}/stop`, { method: 'POST', body: {} }),
  continue: (id: string, text: string, requestKey: string) =>
    request(Task, `/api/tasks/${id}/continue`, { method: 'POST', body: { text, requestKey } }),
  retry: (id: string) => request(Task, `/api/tasks/${id}/retry`, { method: 'POST', body: {} }),
  remove: (id: string) => request(Ok, `/api/tasks/${id}`, { method: 'DELETE' }),
};
