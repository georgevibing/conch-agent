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

export type RunTrigger = 'schedule' | 'manual' | 'catch-up' | 'event';

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

/** What starts a When-routine (ADR 0056): mirrors the app's `Trigger`. */
export type TriggerValue =
  | {
      kind: 'mail';
      from: { address?: string; name?: string }[];
      words: string[];
      account?: string;
    }
  | {
      kind: 'calendar';
      minutesBefore: number;
      withOthers: boolean;
      words: string[];
      account?: string;
    }
  | { kind: 'page'; url: string; every: number }
  | { kind: 'folder'; path: string }
  | { kind: 'task' }
  | { kind: 'routine'; routineId: string }
  | { kind: 'hook'; hookId?: string };

export type TriggerKind = TriggerValue['kind'];

/** How a When-routine's trigger reads, from the gateway. */
export interface TriggerPreviewValue {
  valid: boolean;
  /** "When Anna Smith emails you". */
  text: string;
  /** How it looks: "Conch looks every 2 minutes." */
  note?: string;
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
