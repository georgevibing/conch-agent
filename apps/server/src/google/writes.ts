/**
 * The changes Conch can make in a Google account, once the person has given
 * that account write access (Apps → a Google app → Accounts): send an email,
 * add, change or delete a calendar event, make a file in Drive.
 *
 * Every one asks first, every time, with exactly what will happen and from
 * which account (`ctx.ask` with `once`), whatever the app's policy says. The
 * account's access is checked before the question and again after it: a
 * sign-in or a choice that changed while the card was waiting stops it, and
 * nothing is done. Each write has its own way of being found again
 * (`reconcile`), so an answer lost to a network blip or a restart is looked
 * up, never repeated blindly. Missing evidence is "unknown", not "absent",
 * except where Google itself makes a repeat harmless (an event's own id, a
 * change that sets the same fields).
 */
import { createHash, randomBytes } from 'node:crypto';

import type { GoogleAccount, GoogleCapability, GoogleToolName, ToolView } from '@conch/protocol';
import { z } from 'zod';

import { ChannelError } from '../channels/types';
import type { ToolContext } from '../conversations/manager';
import type { HostTool, HostToolResult } from '../engines/types';
import { SendUncertain } from './imap';
import { gmailLink, replyEnvelope, viaImap } from './mail';
import { GoogleError, type GoogleService } from './service';
import { accountRef, composeRaw, pickAccount } from './accounts';
import { agendaView, filesView, mailView } from './views';

type Reconciled =
  { state: 'confirmed'; receipt: Receipt } | { state: 'absent' } | { state: 'unknown' };
interface Receipt {
  provider: 'google';
  id: string;
  label: string;
  url?: string;
}

const email = z.email().max(254);
const resourceId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
/** Google's event ids: base32hex letters, and `_` with a time for one occurrence of a series. */
const eventId = z.string().regex(/^[A-Za-z0-9_]{1,1024}$/);
const calendarId = z.string().trim().min(1).max(300).default('primary');
/** A time with its offset, or a whole day. */
const When = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);
const timeZone = z
  .string()
  .regex(/^[A-Za-z]+(?:[/_+-][A-Za-z0-9_+-]+)*$/)
  .max(64)
  .optional()
  .describe('An IANA time zone such as Europe/Berlin, for the event’s own clock.');
const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !/[\r\n]/.test(s), { error: 'Keep it on one line.' });

const hash = (value: string) => createHash('sha256').update(value).digest();
/** RFC 4648 base32hex in lower case: the letters Google Calendar takes for an event's own id. */
function base32hex(bytes: Buffer): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
/** The event an operation makes: the same operation can only ever make the same event. */
export const eventIdFor = (operationId: string) =>
  `conch${base32hex(hash(`event:${operationId}`)).slice(0, 40)}`;
/** The Message-ID an operation's email carries, on the sender's own domain. */
export const sendMessageId = (operationId: string, from: string) =>
  `<conch.${hash(`send:${operationId}`).toString('hex').slice(0, 40)}@${from.split('@')[1] ?? 'mail.conch.invalid'}>`;
/** The mark a Drive file made by an operation carries (`appProperties`), to find it again. */
export const driveTagFor = (operationId: string) =>
  hash(`drive:${operationId}`).toString('hex').slice(0, 40);

/** A time or a day, as a person reads it on the card. */
function whenText(start: string, end?: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (day.test(start)) {
    if (!end) return `on ${start}`;
    const last = new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return last === start ? `on ${start} (all day)` : `from ${start} to ${last} (all day)`;
  }
  return end ? `from ${start} to ${end}` : `at ${start}`;
}
const calendarTime = (value: string, zone?: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { date: value }
    : { dateTime: value, ...(zone && { timeZone: zone }) };
/** Both a time, or both a day; the end after the start; no longer than a year. */
function checkSpan(start: string, end: string) {
  const days = /^\d{4}-\d{2}-\d{2}$/;
  if (days.test(start) !== days.test(end))
    throw new GoogleError(
      'invalid',
      'Give start and end both as times (with their offset) or both as days (YYYY-MM-DD).',
    );
  const from = Date.parse(days.test(start) ? `${start}T00:00:00Z` : start);
  const to = Date.parse(days.test(end) ? `${end}T00:00:00Z` : end);
  if (!(to > from))
    throw new GoogleError(
      'invalid',
      'The end must come after the start. For a whole day, end is the day after.',
    );
  if (to - from > 366 * 86_400_000)
    throw new GoogleError('invalid', 'An event can last a year at most.');
}

const Event = z.looseObject({
  id: z.string().optional(),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  htmlLink: z.string().optional(),
  start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
  end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
});
type Event = z.infer<typeof Event>;
const eventLink = (event: Event) =>
  event.htmlLink && /^https:\/\/(www\.)?google\.com\/calendar\//.test(event.htmlLink)
    ? event.htmlLink
    : undefined;
const startOf = (event: Event) => event.start?.dateTime ?? event.start?.date ?? '';
const endOf = (event: Event) => event.end?.dateTime ?? event.end?.date ?? '';
const sameTime = (a: string, b: string) =>
  a === b || (Date.parse(a) === Date.parse(b) && Number.isFinite(Date.parse(a)));

/** The event as it now is, drawn like any other day's events (ADR 0060). */
const eventView = (event: Event): ToolView | undefined => {
  const start = startOf(event);
  return start ? agendaView({ items: [event] }, { start, end: endOf(event) || start }) : undefined;
};
/** The email that just went, drawn like the ones a search finds. */
const sentView = (
  args: { to: string[]; subject: string; body: string },
  account: GoogleAccount,
  url?: string,
): ToolView | undefined =>
  mailView([
    {
      from: account.email,
      subject: args.subject || '(no subject)',
      snippet: args.body.replace(/\s+/g, ' ').trim().slice(0, 300),
      date: new Date().toISOString(),
      unread: false,
      attachments: false,
      ...(url && { url }),
    },
  ]);

interface WriteSpec<Shape extends z.ZodRawShape, Prepared> {
  name: GoogleToolName;
  description: string;
  input: Shape;
  capability: GoogleCapability;
  /** What it changes, as a person would name it, for the "nothing was …" lines. */
  noun: string;
  /** The fields that make two calls the same action, never the model's wording. */
  identity: (args: z.infer<z.ZodObject<Shape>> & { accountId: string }) => unknown[];
  /** A look before asking (the event being changed), so the card can name it. */
  prepare?: (
    args: z.infer<z.ZodObject<Shape>> & { accountId: string },
    account: GoogleAccount,
  ) => Promise<Prepared>;
  /** What the card says will happen, after "Allow … to". */
  summary: (
    args: z.infer<z.ZodObject<Shape>> & { accountId: string },
    account: GoogleAccount,
    prepared: Prepared,
  ) => string;
  /** What it did: the receipt, and what the person would rather see than read (ADR 0060). */
  perform: (
    args: z.infer<z.ZodObject<Shape>> & { accountId: string },
    account: GoogleAccount,
    run: { operationId: string; authorization: string; signal: AbortSignal; prepared: Prepared },
  ) => Promise<{ receipt: Receipt; view?: ToolView }>;
  reconcile: (
    args: z.infer<z.ZodObject<Shape>> & { accountId: string },
    account: GoogleAccount,
    operationId: string,
  ) => Promise<Reconciled>;
}

/** Google's write tools: each one asks, checks the account twice, and can be found again. */
export function googleWriteTools(service: GoogleService, ctx: ToolContext): HostTool[] {
  /** Operations started in a chat, not a task: their own id, never reused. */
  const fresh = () => `chat-${randomBytes(18).toString('base64url')}`;

  function write<Shape extends z.ZodRawShape, Prepared = undefined>(
    spec: WriteSpec<Shape, Prepared>,
  ): HostTool {
    const schema = z.object(spec.input);
    const resolve = async (raw: Record<string, unknown>) => {
      const parsed = schema.parse(raw);
      const ref = accountRef.parse((parsed as { accountId?: unknown }).accountId);
      const account = await pickAccount(service, ref, spec.capability);
      return { args: { ...parsed, accountId: account.id }, account };
    };
    const notDone = (why: string): HostToolResult => ({
      text: `${why} Nothing was ${spec.noun}.`,
      effect: 'not-executed',
    });
    return {
      name: spec.name,
      description: spec.description,
      input: spec.input,
      verification: {
        effect: 'write',
        identity: (raw) => {
          const parsed = schema.safeParse(raw);
          return JSON.stringify(
            parsed.success
              ? spec.identity({
                  ...parsed.data,
                  accountId: String(raw.accountId ?? '').toLowerCase(),
                })
              : raw,
          );
        },
        scope: async (raw) => {
          const { account } = await resolve(raw);
          return service.verificationScope(account.id, spec.capability);
        },
        reconcile: async (raw, operationId) => {
          try {
            const { args, account } = await resolve(raw);
            return await spec.reconcile(args, account, operationId);
          } catch {
            return { state: 'unknown' };
          }
        },
      },
      async run(raw, context) {
        const { args, account } = await resolve(raw);
        const operationId = context?.operationId ?? fresh();
        // In a task, what an earlier try already did is found, not done again.
        if (context?.operationId) {
          const earlier = await spec
            .reconcile(args, account, operationId)
            .catch((): Reconciled => ({ state: 'unknown' }));
          if (earlier.state === 'confirmed') return JSON.stringify(earlier);
        }
        const authorized = await service.verificationScope(account.id, spec.capability);
        const prepared = (await spec.prepare?.(args, account)) as Prepared;
        const restricted = await ctx.restricted?.('apps', 'google');
        const warning = [ctx.untrusted?.(), restricted].filter(Boolean).join(' ');
        const decision = await ctx.ask({
          toolName: spec.name,
          input: { ...args, accountEmail: account.email },
          summary: spec.summary(args, account, prepared),
          ...(warning ? { taint: warning } : {}),
          // Exactly this, this time: never "always".
          once: true,
        });
        if (decision === 'deny') return notDone('The person said no.');
        if (ctx.signal.aborted) return notDone('Stopped before it started.');
        let current;
        try {
          current = await service.verificationScope(account.id, spec.capability);
        } catch {
          return notDone('Google access couldn’t be checked after the approval.');
        }
        if (current.authorization !== authorized.authorization)
          return notDone('The account’s access changed while waiting for the approval.');
        try {
          const { receipt, view } = await spec.perform(args, account, {
            operationId,
            authorization: authorized.authorization,
            signal: ctx.signal,
            prepared,
          });
          const text = JSON.stringify({ state: 'confirmed', receipt });
          return view ? { text, view } : text;
        } catch (error) {
          if (error instanceof GoogleError && error.kind === 'not-executed')
            return notDone(error.message.replace(/\s*Nothing was [a-z]+\.?$/i, ''));
          throw error;
        }
      },
    };
  }

  // ── Gmail: send ────────────────────────────────────────────────────────

  const Mail = z.object({ id: resourceId, threadId: resourceId.optional() });
  const MailList = z.object({
    messages: z.array(z.object({ id: resourceId })).optional(),
    nextPageToken: z.string().optional(),
  });
  const send = write({
    name: 'google_mail_send',
    noun: 'sent',
    capability: 'mail-send',
    description:
      'Send an email from a connected Gmail account, as the person, after they approve this exact email. For a reply, pass sourceMessageId from google_mail_read: the recipients and subject must match the original, and it is threaded. Plain text only, no attachments. Prefer google_mail_create_draft when the person may want to edit first. Never retry an uncertain send.',
    input: {
      accountId: accountRef,
      to: z.array(email).min(1).max(20),
      cc: z.array(email).max(20).optional(),
      subject: oneLine(500),
      body: z.string().max(100_000),
      sourceMessageId: resourceId.optional(),
      threadId: resourceId.optional(),
    },
    identity: (a) => [
      a.accountId,
      a.sourceMessageId ?? a.threadId ?? null,
      a.to.map((v) => v.toLowerCase()).sort(),
      (a.cc ?? []).map((v) => v.toLowerCase()).sort(),
      a.subject.trim().toLowerCase(),
    ],
    summary: (a, account) =>
      `send an email from ${account.email} to ${a.to.join(', ')}${a.cc?.length ? `, copying ${a.cc.join(', ')}` : ''}, with subject “${a.subject}”`,
    async perform(a, account, run) {
      const reply = await replyEnvelope(service, a);
      const messageId = sendMessageId(run.operationId, account.email);
      const raw = composeRaw(a, { messageId, from: account.email, reply });
      if (account.via === 'app-password') {
        try {
          await viaImap(
            service,
            account.id,
            (login) =>
              service.imap.send(
                login,
                raw,
                { from: login.address, to: [...a.to, ...(a.cc ?? [])] },
                run.signal,
              ),
            'mail-send',
          );
        } catch (error) {
          if (error instanceof SendUncertain)
            throw new GoogleError(
              'ambiguous',
              'Gmail may have sent this email. Look in Sent before sending it again.',
            );
          if (error instanceof ChannelError && error.code === 'refused')
            throw new GoogleError('not-executed', error.message);
          if (error instanceof GoogleError && error.kind !== 'ambiguous')
            throw new GoogleError('not-executed', error.message);
          throw error;
        }
        // Gmail took it (SMTP said so): that answer is the receipt.
        return {
          receipt: { provider: 'google', id: messageId, label: 'Sent from Gmail' },
          ...(sentView(a, account) && { view: sentView(a, account) }),
        };
      }
      const sent = Mail.parse(
        await service.api(account.id, 'mail-send', '/gmail/v1/users/me/messages/send', {
          method: 'POST',
          signal: run.signal,
          authorization: run.authorization,
          body: {
            raw: Buffer.from(raw).toString('base64url'),
            ...(reply ? { threadId: reply.threadId } : {}),
          },
        }),
      );
      return {
        receipt: {
          provider: 'google',
          id: sent.id,
          label: 'Sent from Gmail',
          url: gmailLink(account.email, sent.id, 'sent'),
        },
        ...(sentView(a, account, gmailLink(account.email, sent.id, 'sent')) && {
          view: sentView(a, account, gmailLink(account.email, sent.id, 'sent')),
        }),
      };
    },
    async reconcile(_a, account, operationId) {
      const messageId = sendMessageId(operationId, account.email);
      if (account.via === 'app-password') {
        const found = await viaImap(
          service,
          account.id,
          (login) => service.imap.sent(login, messageId),
          'mail-send',
        );
        const only = found.length === 1 ? found[0] : undefined;
        return only
          ? {
              state: 'confirmed',
              receipt: {
                provider: 'google',
                id: only.id,
                label: 'Sent from Gmail',
                url: gmailLink(account.email, only.id, 'sent'),
              },
            }
          : { state: 'unknown' };
      }
      const list = MailList.parse(
        await service.api(account.id, 'mail-send', '/gmail/v1/users/me/messages', {
          query: { q: `in:sent rfc822msgid:${messageId.slice(1, -1)}`, maxResults: '5' },
        }),
      );
      const only =
        !list.nextPageToken && list.messages?.length === 1 ? list.messages[0] : undefined;
      return only
        ? {
            state: 'confirmed',
            receipt: {
              provider: 'google',
              id: only.id,
              label: 'Sent from Gmail',
              url: gmailLink(account.email, only.id, 'sent'),
            },
          }
        : { state: 'unknown' };
    },
  });

  // ── Google Calendar: add, change, delete ───────────────────────────────

  const eventPath = (calendar: string, id?: string) =>
    `/calendar/v3/calendars/${encodeURIComponent(calendar)}/events${id ? `/${encodeURIComponent(id)}` : ''}`;
  const guests = (list: string[] | undefined, notify: boolean) =>
    list?.length
      ? `, inviting ${list.join(', ')} (${notify ? 'Google emails them' : 'without emailing them'})`
      : '';
  /** One event, read with the same account: what the card names, and the proof afterwards. */
  const readEvent = async (
    accountId: string,
    calendar: string,
    id: string,
  ): Promise<Event | undefined> => {
    const { status, data } = await service.request(
      accountId,
      'calendar-read',
      eventPath(calendar, id),
      { expect: [404, 410] },
    );
    if (status === 404 || status === 410) return undefined;
    return Event.parse(data);
  };

  const createEvent = write({
    name: 'google_calendar_create_event',
    noun: 'added',
    capability: 'calendar-write',
    description:
      'Add an event to a Google Calendar, after the person approves it. start and end are both RFC3339 times with offsets, or both whole days (YYYY-MM-DD; end is the day after the last day). attendees are invited; Google only emails them when notify is true.',
    input: {
      accountId: accountRef,
      calendarId,
      title: oneLine(300).pipe(z.string().min(1)),
      start: When,
      end: When,
      timeZone,
      description: z.string().max(8000).optional(),
      location: oneLine(1000).optional(),
      attendees: z.array(email).max(50).optional(),
      notify: z.boolean().default(false),
    },
    identity: (a) => [a.accountId, a.calendarId, a.title.toLowerCase(), a.start, a.end],
    summary: (a, account) =>
      `add “${a.title}” to ${account.email}’s calendar ${whenText(a.start, a.end)}${guests(a.attendees, a.notify)}`,
    async perform(a, account, run) {
      checkSpan(a.start, a.end);
      const id = eventIdFor(run.operationId);
      const { status, data } = await service.request(
        account.id,
        'calendar-write',
        eventPath(a.calendarId),
        {
          method: 'POST',
          signal: run.signal,
          authorization: run.authorization,
          query: { sendUpdates: a.notify ? 'all' : 'none' },
          // 409: an event with this operation's id is there already, from an earlier try.
          expect: [409],
          body: {
            id,
            summary: a.title,
            ...(a.description && { description: a.description }),
            ...(a.location && { location: a.location }),
            start: calendarTime(a.start, a.timeZone),
            end: calendarTime(a.end, a.timeZone),
            ...(a.attendees?.length && { attendees: a.attendees.map((e) => ({ email: e })) }),
          },
        },
      );
      const event =
        status === 409 ? await readEvent(account.id, a.calendarId, id) : Event.parse(data);
      if (!event || event.status === 'cancelled')
        throw new GoogleError(
          'ambiguous',
          'Google Calendar didn’t confirm the event. Look in the calendar before adding it again.',
        );
      const url = eventLink(event);
      return {
        receipt: {
          provider: 'google',
          id: event.id ?? id,
          label: 'Added to Google Calendar',
          ...(url && { url }),
        },
        view: eventView(event),
      };
    },
    async reconcile(a, account, operationId) {
      const event = await readEvent(account.id, a.calendarId, eventIdFor(operationId));
      // Not there: adding it again is safe, since the same id can only be added once.
      if (!event) return { state: 'absent' };
      if (event.status === 'cancelled' || event.summary !== a.title) return { state: 'unknown' };
      const url = eventLink(event);
      return {
        state: 'confirmed',
        receipt: {
          provider: 'google',
          id: event.id ?? eventIdFor(operationId),
          label: 'Added to Google Calendar',
          ...(url && { url }),
        },
      };
    },
  });

  const Changes = {
    title: oneLine(300).pipe(z.string().min(1)).optional(),
    start: When.optional(),
    end: When.optional(),
    timeZone,
    description: z.string().max(8000).optional(),
    location: oneLine(1000).optional(),
  };
  const updateEvent = write({
    name: 'google_calendar_update_event',
    noun: 'changed',
    capability: 'calendar-write',
    description:
      'Change an event in Google Calendar, after the person approves it: its title, time, description or place. Pass the eventId from google_calendar_briefing and only the fields that change; moving it needs both start and end. Google only emails guests when notify is true.',
    input: {
      accountId: accountRef,
      calendarId,
      eventId,
      ...Changes,
      notify: z.boolean().default(false),
    },
    identity: (a) => [
      a.accountId,
      a.calendarId,
      a.eventId,
      a.title ?? null,
      a.start ?? null,
      a.end ?? null,
      a.description ?? null,
      a.location ?? null,
    ],
    async prepare(a, account) {
      if (
        a.title === undefined &&
        a.start === undefined &&
        a.end === undefined &&
        a.description === undefined &&
        a.location === undefined
      )
        throw new GoogleError(
          'invalid',
          'Say what to change: title, start and end, description or location.',
        );
      if ((a.start === undefined) !== (a.end === undefined))
        throw new GoogleError('invalid', 'To move an event, give both start and end.');
      if (a.start && a.end) checkSpan(a.start, a.end);
      const event = await readEvent(account.id, a.calendarId, a.eventId);
      if (!event || event.status === 'cancelled')
        throw new GoogleError(
          'invalid',
          'That event isn’t in this calendar. Read the calendar again for its eventId.',
        );
      return event;
    },
    summary: (a, account, event) => {
      const changes = [
        a.title !== undefined && `rename it “${a.title}”`,
        a.start && a.end && `move it to ${whenText(a.start, a.end).replace(/^(from|on|at) /, '')}`,
        a.location !== undefined &&
          (a.location ? `set the place to “${a.location}”` : 'clear the place'),
        a.description !== undefined && 'change its description',
      ].filter(Boolean);
      return `change “${event.summary ?? 'an event'}” (${whenText(startOf(event), endOf(event))}) in ${account.email}’s calendar: ${changes.join(', ')}${a.notify ? ' (Google emails the guests)' : ''}`;
    },
    async perform(a, account, run) {
      const data = await service.api(
        account.id,
        'calendar-write',
        eventPath(a.calendarId, a.eventId),
        {
          method: 'PATCH',
          signal: run.signal,
          authorization: run.authorization,
          query: { sendUpdates: a.notify ? 'all' : 'none' },
          body: {
            ...(a.title !== undefined && { summary: a.title }),
            ...(a.description !== undefined && { description: a.description }),
            ...(a.location !== undefined && { location: a.location }),
            ...(a.start && { start: calendarTime(a.start, a.timeZone) }),
            ...(a.end && { end: calendarTime(a.end, a.timeZone) }),
          },
        },
      );
      const event = Event.parse(data);
      const url = eventLink(event);
      return {
        receipt: {
          provider: 'google',
          id: event.id ?? a.eventId,
          label: 'Changed in Google Calendar',
          ...(url && { url }),
        },
        view: eventView(event),
      };
    },
    async reconcile(a, account) {
      const event = await readEvent(account.id, a.calendarId, a.eventId);
      if (!event || event.status === 'cancelled') return { state: 'unknown' };
      const done =
        (a.title === undefined || event.summary === a.title) &&
        (a.description === undefined || (event.description ?? '') === a.description) &&
        (a.location === undefined || (event.location ?? '') === a.location) &&
        (a.start === undefined || sameTime(startOf(event), a.start)) &&
        (a.end === undefined || sameTime(endOf(event), a.end));
      const url = eventLink(event);
      // Not changed yet: setting the same fields again does no harm.
      return done
        ? {
            state: 'confirmed',
            receipt: {
              provider: 'google',
              id: event.id ?? a.eventId,
              label: 'Changed in Google Calendar',
              ...(url && { url }),
            },
          }
        : { state: 'absent' };
    },
  });

  const deleteEvent = write({
    name: 'google_calendar_delete_event',
    noun: 'deleted',
    capability: 'calendar-write',
    description:
      'Delete an event from Google Calendar, after the person approves it. Pass the eventId from google_calendar_briefing. Google only emails the guests that it was cancelled when notify is true.',
    input: { accountId: accountRef, calendarId, eventId, notify: z.boolean().default(false) },
    identity: (a) => [a.accountId, a.calendarId, a.eventId],
    async prepare(a, account) {
      const event = await readEvent(account.id, a.calendarId, a.eventId);
      if (!event || event.status === 'cancelled')
        throw new GoogleError(
          'invalid',
          'That event isn’t in this calendar any more, so there is nothing to delete.',
        );
      return event;
    },
    summary: (a, account, event) =>
      `delete “${event.summary ?? 'an event'}” (${whenText(startOf(event), endOf(event))}) from ${account.email}’s calendar${a.notify ? ', and Google tells the guests' : ''}`,
    async perform(a, account, run) {
      await service.request(account.id, 'calendar-write', eventPath(a.calendarId, a.eventId), {
        method: 'DELETE',
        signal: run.signal,
        authorization: run.authorization,
        query: { sendUpdates: a.notify ? 'all' : 'none' },
        // Gone already: what was asked for is true.
        expect: [410],
      });
      return {
        receipt: { provider: 'google', id: a.eventId, label: 'Deleted from Google Calendar' },
      };
    },
    async reconcile(a, account) {
      const event = await readEvent(account.id, a.calendarId, a.eventId);
      // Still there: deleting it again does no harm.
      if (event && event.status !== 'cancelled') return { state: 'absent' };
      return {
        state: 'confirmed',
        receipt: { provider: 'google', id: a.eventId, label: 'Deleted from Google Calendar' },
      };
    },
  });

  // ── Google Drive: make a file ──────────────────────────────────────────

  const File = z.object({
    id: resourceId,
    name: z.string().optional(),
    webViewLink: z.string().optional(),
  });
  const fileLink = (file: z.infer<typeof File>) =>
    file.webViewLink && /^https:\/\/(docs|drive)\.google\.com\//.test(file.webViewLink)
      ? file.webViewLink
      : undefined;
  const createFile = write({
    name: 'google_drive_create_file',
    noun: 'made',
    capability: 'drive-write',
    description:
      'Make a new file in Google Drive from text, after the person approves it: a Google Doc (format "document", the default) or a plain text file ("text"). Optionally inside a folder (folderId from google_drive_search). Conch can only change files it made itself; it never edits or deletes anyone’s existing files.',
    input: {
      accountId: accountRef,
      name: oneLine(200).pipe(z.string().min(1)),
      content: z.string().max(1_000_000),
      format: z.enum(['document', 'text']).default('document'),
      folderId: resourceId.optional(),
    },
    identity: (a) => [a.accountId, a.name.toLowerCase(), a.format, a.folderId ?? null],
    summary: (a, account) =>
      `make a ${a.format === 'document' ? 'Google Doc' : 'text file'} called “${a.name}” in ${account.email}’s Drive (${a.content.length.toLocaleString('en')} characters)`,
    async perform(a, account, run) {
      const boundary = `conch-${randomBytes(12).toString('hex')}`;
      const metadata = {
        name: a.name,
        mimeType: a.format === 'document' ? 'application/vnd.google-apps.document' : 'text/plain',
        ...(a.folderId && { parents: [a.folderId] }),
        appProperties: { conchOperation: driveTagFor(run.operationId) },
      };
      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        a.content,
        `--${boundary}--`,
        '',
      ].join('\r\n');
      const file = File.parse(
        await service.api(account.id, 'drive-write', '/upload/drive/v3/files', {
          method: 'POST',
          signal: run.signal,
          authorization: run.authorization,
          query: { uploadType: 'multipart', fields: 'id,name,webViewLink' },
          raw: { contentType: `multipart/related; boundary=${boundary}`, body },
        }),
      );
      const url = fileLink(file);
      return {
        receipt: {
          provider: 'google',
          id: file.id,
          label: 'Made in Google Drive',
          ...(url && { url }),
        },
        view: filesView({ files: [{ ...file, mimeType: metadata.mimeType }] }),
      };
    },
    async reconcile(_a, account, operationId) {
      const list = z.object({ files: z.array(File).optional() }).parse(
        await service.api(account.id, 'drive-write', '/drive/v3/files', {
          query: {
            q: `appProperties has { key='conchOperation' and value='${driveTagFor(operationId)}' } and trashed = false`,
            fields: 'files(id,name,webViewLink)',
            pageSize: '5',
          },
        }),
      );
      const only = list.files?.length === 1 ? list.files[0] : undefined;
      if (!only) return { state: 'unknown' };
      const url = fileLink(only);
      return {
        state: 'confirmed',
        receipt: {
          provider: 'google',
          id: only.id,
          label: 'Made in Google Drive',
          ...(url && { url }),
        },
      };
    },
  });

  return [send, createEvent, updateEvent, deleteEvent, createFile];
}
