/**
 * What Google's tools found, drawn as it is (ADR 0055 §7): a calendar window
 * as an agenda, a Gmail search as emails, a Drive search as files. The model
 * still reads the tools' own text; these are for the person, and only ever
 * drawn as plain text. Every field is clipped to what `ToolView` allows and
 * every link must be Google's own `https` one, so a view never fails to draw.
 */
import type { AgendaItem, FileItem, MailItem, ToolView } from '@conch/protocol';

import { gmailLink } from './mail';

/** A read's result, with what to show the person, worked out only when it's wanted. */
export class Found {
  constructor(
    readonly result: unknown,
    readonly view?: () => Promise<ToolView | undefined> | ToolView | undefined,
  ) {}
}

/** The result a read handed back, without its view. */
export const resultOf = (out: unknown) => (out instanceof Found ? out.result : out);

/** What a read found to show, if anything; a view that can't be had is never an error. */
export async function viewOf(out: unknown): Promise<ToolView | undefined> {
  if (!(out instanceof Found) || !out.view) return undefined;
  try {
    return await out.view();
  } catch {
    return undefined;
  }
}

const clip = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** Only Google's own web links: anything else is left off. */
const googleLink = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  value.length <= 2000 &&
  /^https:\/\/([a-z0-9-]+\.)*google\.com\//i.test(value)
    ? value
    : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** An ISO date (`2026-10-03`) or date-time with its offset, as Google writes them. */
const when = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  value.length >= 4 &&
  value.length <= 40 &&
  !Number.isNaN(Date.parse(value))
    ? value
    : undefined;

// ── Calendar ────────────────────────────────────────────────────────────────

/** Google Calendar's own event colours (`colorId` 1–11), as its web app draws them. */
const EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb',
  '2': '#33b679',
  '3': '#8e24aa',
  '4': '#e67c73',
  '5': '#f6bf26',
  '6': '#f4511e',
  '7': '#039be5',
  '8': '#616161',
  '9': '#3f51b5',
  '10': '#0b8043',
  '11': '#d50000',
};

/** Video calls Google knows (Meet), and the usual others written into the place. */
const CALL_LINK = /\b(meet\.google\.com|zoom\.us|teams\.microsoft\.com|webex\.com|whereby\.com)\//i;

function hasCall(event: Record<string, unknown>): boolean {
  if (typeof event.hangoutLink === 'string') return true;
  const conference = isRecord(event.conferenceData) ? event.conferenceData : {};
  if (list(conference.entryPoints).some((p) => isRecord(p) && p.entryPointType === 'video'))
    return true;
  return typeof event.location === 'string' && CALL_LINK.test(event.location);
}

/** Whether the person said no to it: it isn't on their day. */
const declined = (event: Record<string, unknown>) =>
  list(event.attendees).some(
    (a) => isRecord(a) && a.self === true && a.responseStatus === 'declined',
  );

/**
 * Google Calendar's events list as an agenda for the window that was asked
 * about, so a day with nothing on still shows as free.
 */
export function agendaView(result: unknown, window: { start: string; end: string }): ToolView {
  const data = isRecord(result) ? result : {};
  const calendar = clip(data.summary, 120);
  const items: AgendaItem[] = [];
  for (const raw of list(data.items)) {
    if (items.length >= 60) break;
    if (!isRecord(raw) || raw.status === 'cancelled' || declined(raw)) continue;
    const start = isRecord(raw.start) ? raw.start : {};
    const end = isRecord(raw.end) ? raw.end : {};
    const allDay = !start.dateTime && Boolean(start.date);
    const startsAt = when(start.dateTime ?? start.date);
    if (!startsAt) continue;
    const endsAt = when(end.dateTime ?? end.date);
    const location = clip(raw.location, 300);
    const color = typeof raw.colorId === 'string' ? EVENT_COLORS[raw.colorId] : undefined;
    const url = googleLink(raw.htmlLink);
    items.push({
      title: clip(raw.summary, 300) ?? 'Busy',
      start: startsAt,
      ...(endsAt && { end: endsAt }),
      allDay,
      // A call link is shown as a call, not as a place.
      ...(location && !CALL_LINK.test(location) && { location }),
      ...(calendar && { calendar }),
      ...(color && { color }),
      call: hasCall(raw),
      ...(url && { url }),
    });
  }
  return {
    kind: 'agenda',
    items,
    ...(when(window.start) && { from: window.start }),
    ...(when(window.end) && { to: window.end }),
  };
}

// ── Gmail ───────────────────────────────────────────────────────────────────

/** "Ada Lovelace" from `"Ada Lovelace" <ada@example.org>`, else the address. */
export function senderName(from: string): string {
  const named = /^\s*"?([^"<]*?)"?\s*<([^>]*)>\s*$/.exec(from);
  const name = named?.[1]?.trim();
  if (name) return name;
  return (named?.[2] ?? from).trim();
}

/** Gmail's snippet is HTML-escaped; it's drawn as text, so it's unescaped here. */
function unescape(text: string): string {
  return text
    .replace(/&#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** One email as Gmail's API describes it with `format=metadata`. */
export function gmailItem(message: unknown, account: string): MailItem | undefined {
  if (!isRecord(message) || typeof message.id !== 'string') return undefined;
  const payload = isRecord(message.payload) ? message.payload : {};
  const header = (name: string) => {
    const found = list(payload.headers).find(
      (h) => isRecord(h) && typeof h.name === 'string' && h.name.toLowerCase() === name,
    );
    return isRecord(found) && typeof found.value === 'string' ? found.value : undefined;
  };
  const internal = Number(message.internalDate);
  const written = Date.parse(header('date') ?? '');
  const at = Number.isFinite(internal) && internal > 0 ? internal : written;
  const date = Number.isFinite(at) ? new Date(at).toISOString() : undefined;
  if (!date) return undefined;
  const labels = list(message.labelIds);
  const snippet =
    typeof message.snippet === 'string' ? clip(unescape(message.snippet), 400) : undefined;
  const parts = list(payload.parts);
  return {
    from: clip(senderName(header('from') ?? ''), 200) ?? 'Unknown sender',
    subject: clip(header('subject'), 300) ?? '(no subject)',
    ...(snippet && { snippet }),
    date,
    unread: labels.includes('UNREAD'),
    attachments:
      payload.mimeType === 'multipart/mixed' ||
      parts.some((p) => isRecord(p) && typeof p.filename === 'string' && p.filename.length > 0),
    url: gmailLink(account, message.id),
  };
}

/** What an IMAP search saw of one email: its envelope, flags and shape. */
export interface MailSummary {
  id: string;
  from?: { name?: string; address?: string };
  subject?: string;
  date?: Date | string;
  seen: boolean;
  attachments: boolean;
}

/** One email as Gmail's IMAP described it. */
export function imapItem(summary: MailSummary, account: string): MailItem | undefined {
  const at = summary.date ? new Date(summary.date).getTime() : NaN;
  const date = Number.isFinite(at) ? new Date(at).toISOString() : undefined;
  if (!date) return undefined;
  return {
    from: clip(summary.from?.name, 200) ?? clip(summary.from?.address, 200) ?? 'Unknown sender',
    subject: clip(summary.subject, 300) ?? '(no subject)',
    date,
    unread: !summary.seen,
    attachments: summary.attachments,
    url: gmailLink(account, summary.id),
  };
}

/** Emails as a view; nothing when none of them could be described. */
export function mailView(items: (MailItem | undefined)[]): ToolView | undefined {
  const kept = items.filter((i): i is MailItem => Boolean(i)).slice(0, 30);
  return kept.length ? { kind: 'mail', items: kept } : undefined;
}

/** Run `work` over `values`, a few at a time, in order. */
export async function inBatches<T, R>(
  values: T[],
  size: number,
  work: (value: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < values.length; i += size)
    out.push(...(await Promise.all(values.slice(i, i + size).map(work))));
  return out;
}

// ── Drive ───────────────────────────────────────────────────────────────────

/** Drive's file list as files, folders included. */
export function filesView(result: unknown): ToolView {
  const data = isRecord(result) ? result : {};
  const items: FileItem[] = [];
  for (const raw of list(data.files)) {
    if (items.length >= 30) break;
    if (!isRecord(raw)) continue;
    const name = clip(raw.name, 300);
    if (!name) continue;
    const mime = clip(raw.mimeType, 120);
    const modified = when(raw.modifiedTime);
    const owner = clip(
      list(raw.owners)
        .map((o) => (isRecord(o) ? (o.displayName ?? o.emailAddress) : undefined))
        .find((o) => typeof o === 'string'),
      200,
    );
    const url = googleLink(raw.webViewLink);
    items.push({
      name,
      ...(mime && { mime }),
      ...(modified && { modified }),
      ...(owner && { owner }),
      ...(url && { url }),
    });
  }
  return { kind: 'files', items };
}
