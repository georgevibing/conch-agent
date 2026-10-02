import { z } from 'zod';

import { EngineId } from './common';
import { Task } from './tasks';

/** A first useful result, with the work and its permissions chosen together. */
export const FirstJobKind = z.enum(['document', 'today', 'followups']);
export type FirstJobKind = z.infer<typeof FirstJobKind>;

export const FirstJobRequest = z
  .object({
    requestId: z.string().regex(/^[A-Za-z0-9_-]{16,96}$/),
    kind: FirstJobKind,
    engine: EngineId,
    model: z.string().min(1).max(200),
    accountId: z.string().min(1).max(128).optional(),
    source: z.string().trim().max(12_000).default(''),
    instruction: z.string().trim().max(1_000).default(''),
    timezone: z
      .string()
      .max(100)
      .default('UTC')
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, 'Choose a valid time zone.'),
  })
  .strict();
export type FirstJobRequest = z.infer<typeof FirstJobRequest>;

export const FirstJobState = z.object({ task: Task.nullable() });
export type FirstJobState = z.infer<typeof FirstJobState>;
