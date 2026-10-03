import { MapPin, Video } from 'lucide-react';
import type { CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import { useNow } from '../Usage/useNow';
import {
  count,
  outside,
  ShowAll,
  useShowAll,
  ViewFrame,
  webLink,
  type ViewFrameProps,
} from './shared';
import {
  addDays,
  dayDate,
  dayKey,
  dayName,
  dayOf,
  daysBetween,
  fullWhen,
  isDateOnly,
  timeOf,
  usesTwelveHours,
  type WhenOptions,
} from './time';
import styles from './ToolViews.module.css';

/** One event, as a calendar tool read it. Mirrors `AgendaItem` in `@conch/protocol`. */
export interface AgendaEvent {
  title: string;
  /** ISO date (`2026-10-03`, all day) or date-time with its offset. */
  start: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  calendar?: string;
  /** The calendar's colour, for the slim rail beside the event. */
  color?: string;
  /** Has a video call. */
  call?: boolean;
  url?: string;
}

export interface AgendaViewProps extends Omit<ViewFrameProps, 'label' | 'heading'>, WhenOptions {
  events: AgendaEvent[];
  /** The window asked about (end exclusive), so an empty day still shows as free. */
  from?: string;
  to?: string;
  /** "Calendar": what it's called for screen readers. */
  label?: string;
}

/** Past this many days, a window shows only the days with something on. */
const FREE_DAYS_UP_TO = 14;

interface Day {
  key: string;
  allDay: AgendaEvent[];
  timed: AgendaEvent[];
}

const startOf = (e: AgendaEvent) => Date.parse(e.start);

/** The days to draw: every day asked about (when short enough) and every day with an event. */
function daysOf(
  events: AgendaEvent[],
  from: string | undefined,
  to: string | undefined,
  zone?: string,
) {
  const days = new Map<string, Day>();
  const day = (key: string) => {
    let found = days.get(key);
    if (!found) days.set(key, (found = { key, allDay: [], timed: [] }));
    return found;
  };
  const first = from ? dayOf(from, zone) : undefined;
  const last = to ? dayOf(to, zone, true) : undefined;
  const span = first && last ? daysBetween(first, last) : -1;
  if (first && last && span >= 0 && span < FREE_DAYS_UP_TO)
    for (let i = 0; i <= span; i++) day(addDays(first, i));

  for (const event of events) {
    const allDay = Boolean(event.allDay) || isDateOnly(event.start);
    const start = dayOf(event.start, zone);
    if (!start) continue;
    if (!allDay) {
      day(start).timed.push(event);
      continue;
    }
    // An all-day event is on every day it covers, within the window when there is one.
    const end = (event.end && dayOf(event.end, zone, true)) || start;
    const covered = Math.min(Math.max(0, daysBetween(start, end)), 62);
    let placed = false;
    for (let i = 0; i <= covered; i++) {
      const key = addDays(start, i);
      if ((first && key < first) || (last && key > last)) continue;
      day(key).allDay.push(event);
      placed = true;
    }
    if (!placed) day(first && start < first ? first : start).allDay.push(event);
  }
  for (const d of days.values()) d.timed.sort((a, b) => startOf(a) - startOf(b));
  return [...days.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

function Rail({ color }: { color?: string }) {
  return (
    <span
      className={styles.rail}
      style={color ? ({ '--rail': color } as CSSProperties) : undefined}
      aria-hidden
    />
  );
}

function AllDay({ event }: { event: AgendaEvent }) {
  const url = webLink(event.url);
  const inner = (
    <>
      <Rail color={event.color} />
      <span className={styles.bandTitle}>{event.title}</span>
      <span className="nc-visually-hidden">, all day</span>
    </>
  );
  return (
    <li
      className={styles.bandItem}
      style={event.color ? ({ '--rail': event.color } as CSSProperties) : undefined}
    >
      {url ? (
        <a className={styles.bandLink} href={url} {...outside} data-lustre="">
          {inner}
        </a>
      ) : (
        <span className={styles.bandLink}>{inner}</span>
      )}
    </li>
  );
}

function Event({
  event,
  options,
  past,
}: {
  event: AgendaEvent;
  options: WhenOptions;
  past: boolean;
}) {
  const url = webLink(event.url);
  const start = startOf(event);
  const end = event.end ? Date.parse(event.end) : NaN;
  const endText = Number.isNaN(end) ? undefined : timeOf(end, options);
  // Said in one go to a screen reader: what, when, and how.
  const spoken = [
    event.title,
    endText ? `${timeOf(start, options)} to ${endText}` : timeOf(start, options),
    event.call && 'video call',
    event.location,
  ]
    .filter(Boolean)
    .join(', ');
  const inner = (
    <>
      <span className={styles.when}>
        <time dateTime={event.start} title={fullWhen(event.start, options)}>
          {timeOf(start, options)}
        </time>
        {endText && (
          <span className={styles.until}>
            <span className="nc-visually-hidden"> until </span>
            {endText}
          </span>
        )}
      </span>
      <Rail color={event.color} />
      <span className={styles.what}>
        <span className={styles.title}>
          <span className={styles.titleText}>{event.title}</span>
          {event.call && <Video className={styles.callGlyph} role="img" aria-label="Video call" />}
        </span>
        {event.location && (
          <span className={styles.meta}>
            <MapPin aria-hidden className={styles.metaGlyph} />
            <span className={styles.metaText}>{event.location}</span>
          </span>
        )}
      </span>
    </>
  );
  return (
    <li className={styles.event} data-past={past || undefined}>
      {url ? (
        <a className={styles.eventRow} href={url} {...outside} aria-label={spoken} data-lustre="">
          {inner}
        </a>
      ) : (
        <span className={styles.eventRow}>{inner}</span>
      )}
    </li>
  );
}

/**
 * A calendar window, drawn as days (ADR 0060): Today, Tomorrow, then the
 * weekday. All-day events lie in a band at the top of their day; timed ones
 * have a time column and a slim rail in their calendar's colour. A day with
 * nothing on says Free. Today shows where now is. Everything is plain text.
 */
export function AgendaView({
  events,
  from,
  to,
  label = 'Calendar',
  now: nowProp,
  locale,
  timeZone,
  className,
  ...props
}: AgendaViewProps) {
  // Now moves on while the chat is open: the marker and what’s past follow it.
  const now = useNow(60_000, nowProp);
  const options: WhenOptions = { now, locale, timeZone };
  const days = daysOf(events, from, to, timeZone);
  const today = dayKey(now, timeZone);
  // A row is an event, a free day, or a day's all-day band.
  const rows = days.reduce(
    (n, d) =>
      n + d.timed.length + (d.allDay.length ? 1 : 0) + (d.allDay.length + d.timed.length ? 0 : 1),
    0,
  );
  const { folded, showAll, limit } = useShowAll(rows);

  let budget = folded ? limit : Infinity;
  const shown: Day[] = [];
  for (const d of days) {
    if (budget <= 0) break;
    const band = d.allDay.length ? 1 : 0;
    const free = d.allDay.length + d.timed.length ? 0 : 1;
    const timed = d.timed.slice(0, Math.max(0, budget - band - free));
    budget -= band + free + timed.length;
    shown.push({ ...d, timed });
  }

  return (
    <ViewFrame
      label={`${label}, ${count(events.length, 'event')}`}
      className={cx(styles.agenda, className)}
      data-clock={usesTwelveHours(locale) ? '12' : '24'}
      {...props}
    >
      {days.length === 0 && <p className={styles.empty}>Nothing on the calendar.</p>}
      {shown.map((d) => {
        const isToday = d.key === today;
        const name = dayName(d.key, options);
        // "Today Sat 3 Oct", but "Friday 9 Oct": the weekday is said once.
        const date = dayDate(d.key, options, {
          weekday: Math.abs(daysBetween(today, d.key)) <= 1,
        });
        // Where now falls among today's events: before the first one still to start.
        const nowAt = isToday && d.timed.length ? d.timed.findIndex((e) => startOf(e) > now) : -2;
        return (
          <section
            key={d.key}
            className={styles.day}
            aria-label={`${name}, ${date}`}
            data-today={isToday || undefined}
          >
            <div className={styles.dayHead}>
              <span className={styles.dayName}>{name}</span>
              <span className={styles.dayDate}>{date}</span>
            </div>
            {d.allDay.length > 0 && (
              <ul className={styles.band} aria-label="All day">
                {d.allDay.map((e, i) => (
                  <AllDay key={`${e.title}${i}`} event={e} />
                ))}
              </ul>
            )}
            {d.timed.length > 0 && (
              <ul className={styles.events}>
                {d.timed.map((e, i) => {
                  const end = e.end ? Date.parse(e.end) : startOf(e);
                  return [
                    nowAt === i && <li key="now" className={styles.now} aria-hidden />,
                    <Event
                      key={`${e.start}${e.title}${i}`}
                      event={e}
                      options={options}
                      past={isToday && end <= now}
                    />,
                  ];
                })}
                {nowAt === -1 && <li className={styles.now} aria-hidden />}
              </ul>
            )}
            {d.allDay.length + d.timed.length === 0 && <p className={styles.free}>Free</p>}
          </section>
        );
      })}
      {folded && <ShowAll onClick={showAll}>Show all {count(events.length, 'event')}</ShowAll>}
    </ViewFrame>
  );
}
