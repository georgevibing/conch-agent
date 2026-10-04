import {
  HookSecret,
  MailPeople,
  Routine,
  RoutineDetail,
  RoutineRun,
  RoutineSpending,
  SchedulePreview,
  WhenPreview,
  type CreateRoutineBody,
  type Schedule,
  type Trigger,
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
  /** How full a plan gets before routines wait for it (`null`: never). A person's choice. */
  setPlanRoom: (planRoomPercent: number | null) =>
    request(RoutineSpending, '/api/routines/spending', {
      method: 'PUT',
      body: { planRoomPercent },
    }),
  keepPaused: () =>
    request(RoutineSpending, '/api/routines/spending/keep-paused', { method: 'POST', body: {} }),
  preview: (schedule: Schedule, timezone: string) =>
    request(SchedulePreview, '/api/routines/preview', {
      method: 'POST',
      body: { schedule, timezone },
    }),
  // When… (ADR 0056)
  previewWhen: (when: Trigger, onlyIf?: string) =>
    request(WhenPreview, '/api/routines/when/preview', {
      method: 'POST',
      body: { when, ...(onlyIf?.trim() && { onlyIf: onlyIf.trim() }) },
    }),
  people: () => request(MailPeople, '/api/routines/people'),
  /** A new secret for another app's address, shown once. */
  newSecret: (id: string) =>
    request(HookSecret, `/api/routines/${id}/secret`, { method: 'POST', body: {} }),
};

/** The browser's timezone — routines created here run on this clock. */
export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
