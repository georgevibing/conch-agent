import {
  Routine,
  RoutineDetail,
  RoutineRun,
  RoutineSpending,
  SchedulePreview,
  type CreateRoutineBody,
  type Schedule,
  type UpdateRoutineBody,
} from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

export const routinesApi = {
  list: () => request(z.array(Routine), '/api/routines'),
  detail: (id: string) => request(RoutineDetail, `/api/routines/${id}`),
  create: (body: z.input<typeof CreateRoutineBody>) =>
    request(Routine, '/api/routines', { method: 'POST', body }),
  update: (id: string, body: UpdateRoutineBody) =>
    request(Routine, `/api/routines/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request(Ok, `/api/routines/${id}`, { method: 'DELETE' }),
  runNow: (id: string) =>
    request(RoutineRun, `/api/routines/${id}/run`, { method: 'POST', body: {} }),
  /** What routines spent this month, and its limit (ADR 0057). */
  spending: () => request(RoutineSpending, '/api/routines/spending'),
  /** A person sets the monthly limit; `null` turns it off. */
  setSpendingLimit: (limitUsd: number | null) =>
    request(RoutineSpending, '/api/routines/spending', { method: 'PUT', body: { limitUsd } }),
  keepPaused: () =>
    request(RoutineSpending, '/api/routines/spending/keep-paused', { method: 'POST', body: {} }),
  preview: (schedule: Schedule, timezone: string) =>
    request(SchedulePreview, '/api/routines/preview', {
      method: 'POST',
      body: { schedule, timezone },
    }),
};

/** The browser's timezone — routines created here run on this clock. */
export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
