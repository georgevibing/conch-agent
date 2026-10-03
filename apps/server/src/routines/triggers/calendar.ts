/**
 * Before a calendar event (ADR 0056): Google Calendar's next hours, read every
 * five minutes, and decided on every pulse. Each event once, by its id and
 * start: a meeting moved to another time is a new meeting to prepare for; a
 * cancelled or declined one is skipped.
 */
import {
  SourceError,
  type Happening,
  type SourceContext,
  type TriggerOf,
  type TriggerSource,
} from './types';

export interface CalendarAccount {
  id: string;
  email: string;
  ready: boolean;
  problem?: string;
}

export interface CalendarEvent {
  id: string;
  /** `cancelled` events are skipped. */
  status?: string;
  summary: string;
  description?: string;
  location?: string;
  /** Epoch ms; undefined for an all-day event. */
  start?: number;
  end?: number;
  link?: string;
  attendees: { email?: string; name?: string; self?: boolean; response?: string }[];
}

/** What the calendar source needs from Google Calendar, so a test can pretend. */
export interface CalendarAccess {
  accounts(): Promise<CalendarAccount[]>;
  events(accountId: string, from: number, to: number): Promise<CalendarEvent[]>;
}

/** How often the list is read again; the pulse decides on every beat in between. */
const READ_EVERY_MS = 5 * 60_000;
/** An event about to go is read again if the list is older than this. */
const CONFIRM_MS = 2 * 60_000;
const LOOKAHEAD_MS = 60 * 60_000;

interface Cached {
  key: string;
  accountId: string;
  id: string;
  start: number;
  summary: string;
  link?: string;
  detail: string;
}

const quote = (w: string) => `“${w}”`;

export function describeCalendar(trigger: TriggerOf<'calendar'>): string {
  const n = trigger.minutesBefore;
  const lead =
    n % 60 === 0 && n >= 60
      ? `${n / 60} hour${n === 60 ? '' : 's'}`
      : `${n} minute${n === 1 ? '' : 's'}`;
  const what = trigger.withOthers ? 'each meeting with other people' : 'each calendar event';
  const words = trigger.words.length
    ? ` about ${trigger.words.length === 1 ? quote(trigger.words[0] ?? '') : `${trigger.words.slice(0, -1).map(quote).join(', ')} or ${quote(trigger.words.at(-1) ?? '')}`}`
    : '';
  return `${lead.charAt(0).toUpperCase()}${lead.slice(1)} before ${what}${words}`;
}

function matches(trigger: TriggerOf<'calendar'>, event: CalendarEvent): boolean {
  if (event.status === 'cancelled' || event.start === undefined) return false;
  const me = event.attendees.find((a) => a.self);
  if (me?.response === 'declined') return false;
  if (trigger.withOthers && event.attendees.filter((a) => !a.self).length === 0) return false;
  if (trigger.words.length) {
    const text = `${event.summary}\n${event.description ?? ''}`.toLowerCase();
    if (!trigger.words.some((w) => text.includes(w.toLowerCase()))) return false;
  }
  return true;
}

function detailOf(event: CalendarEvent, timeZone?: string): string {
  const when = (t: number) =>
    new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
      ...(timeZone && { timeZone }),
    }).format(t);
  const people = event.attendees
    .filter((a) => !a.self)
    .slice(0, 20)
    .map((a) => (a.name ? `${a.name} <${a.email ?? ''}>` : (a.email ?? '')))
    .filter(Boolean);
  return [
    `Event: ${event.summary || '(no title)'}`,
    ...(event.start ? [`Starts: ${when(event.start)}`] : []),
    ...(event.end ? [`Ends: ${when(event.end)}`] : []),
    ...(event.location ? [`Where: ${event.location.slice(0, 300)}`] : []),
    ...(people.length ? [`With: ${people.join(', ')}`] : []),
    ...(event.description ? ['', event.description.slice(0, 2_000)] : []),
  ].join('\n');
}

export function calendarSource(access: CalendarAccess): TriggerSource<'calendar'> {
  const accountsFor = async (trigger: TriggerOf<'calendar'>) => {
    const fix = { label: 'Open Apps', place: 'integrations', focus: 'google-calendar' };
    const all = await access.accounts();
    if (!all.length)
      throw new SourceError(
        'needs-you',
        'Connect Google Calendar so Conch knows your meetings.',
        fix,
      );
    const chosen = trigger.account ? all.filter((a) => a.id === trigger.account) : all;
    if (!chosen.length)
      throw new SourceError(
        'needs-you',
        'The Google account this routine reads isn’t connected any more.',
        fix,
      );
    const ready = chosen.filter((a) => a.ready);
    if (!ready.length)
      throw new SourceError(
        'needs-you',
        chosen[0]?.problem ?? 'Google Calendar needs you to sign in again.',
        fix,
      );
    return ready;
  };

  const read = async (ctx: SourceContext<TriggerOf<'calendar'>>): Promise<Cached[]> => {
    const accounts = await accountsFor(ctx.trigger);
    const to = ctx.now + ctx.trigger.minutesBefore * 60_000 + LOOKAHEAD_MS;
    const out: Cached[] = [];
    let failed: unknown;
    for (const account of accounts) {
      try {
        for (const event of await access.events(account.id, ctx.now - 60_000, to)) {
          if (!matches(ctx.trigger, event) || event.start === undefined) continue;
          out.push({
            key: `cal:${account.id}:${event.id}:${event.start}`,
            accountId: account.id,
            id: event.id,
            start: event.start,
            summary: event.summary || 'An event',
            ...(event.link && { link: event.link }),
            detail: detailOf(event),
          });
        }
      } catch (error) {
        failed = error;
      }
    }
    if (failed && !out.length)
      throw failed instanceof SourceError
        ? failed
        : new SourceError('retry', 'Google Calendar didn’t answer. Conch will look again shortly.');
    return out;
  };

  return {
    kind: 'calendar',
    describe: describeCalendar,
    note: (t) =>
      `Conch reads your calendar every few minutes, and starts this ${t.minutesBefore} minutes before each event that fits.`,
    taint: () => ({ kind: 'app', label: 'a calendar event' }),
    every: () => 15_000,
    async check(ctx) {
      const lead = ctx.trigger.minutesBefore * 60_000;
      let cache = ctx.state as { at?: number; events?: Cached[] };
      if (!cache.at || ctx.now - cache.at > READ_EVERY_MS || !cache.events)
        cache = { at: ctx.now, events: await read(ctx) };
      const due = (events: Cached[]) =>
        events.filter((e) => e.start - lead <= ctx.now && ctx.now < e.start);
      let ready = due(cache.events ?? []);
      // About to go on a list a few minutes old: make sure it's still on, at that time.
      if (ready.length && ctx.now - (cache.at ?? 0) > CONFIRM_MS) {
        cache = { at: ctx.now, events: await read(ctx) };
        ready = due(cache.events ?? []);
      }
      const happenings: Happening[] = ready.map((e) => ({
        id: e.key,
        at: e.start,
        label: e.summary.slice(0, 120),
        ...(e.link && { link: e.link }),
        detail: e.detail,
      }));
      return { happenings, state: cache as Record<string, unknown> };
    },
    async sample(ctx) {
      const events = await read({ ...ctx, now: ctx.now });
      const next = events.sort((a, b) => a.start - b.start)[0];
      return next && { id: next.key, at: next.start, label: next.summary, detail: next.detail };
    },
  };
}
