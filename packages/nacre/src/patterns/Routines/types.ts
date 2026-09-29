/**
 * Structural types for Routines (scheduled tasks). They mirror the app's
 * protocol but Nacre stays independent of it.
 */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type ScheduleValue =
  | { type: 'once'; at: string }
  | { type: 'daily'; time: string }
  | { type: 'weekly'; days: Weekday[]; time: string }
  | { type: 'monthly'; day: number | 'last'; time: string }
  | { type: 'interval'; every: number; unit: 'minutes' | 'hours' }
  | { type: 'cron'; expression: string };

export type RunStatusValue =
  | 'running'
  | 'needs-you'
  | 'succeeded'
  | 'nothing-to-do'
  | 'failed'
  | 'skipped'
  | 'missed'
  | 'stopped';

export type RunTrigger = 'schedule' | 'manual' | 'catch-up';

export interface SchedulePreviewValue {
  valid: boolean;
  /** Plain-language description, e.g. "Every weekday at 8:00 AM". */
  text: string;
  /** Upcoming run times (epoch ms). */
  next: number[];
  /** Roughly how many runs per day. */
  perDay?: number;
  error?: string;
}

export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
