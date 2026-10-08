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

import {
  MAIL_PREVIEW_MAX,
  MailEdit,
  type GoogleAccount,
  type GoogleCapability,
  type GoogleToolName,
  type MailPerson,
  type ToolView,
} from '@conch/protocol';
import { z } from 'zod';

import { ChannelError } from '../channels/types';
import type { ToolContext } from '../conversations/manager';
import type { HostTool, HostToolResult } from '../engines/types';
import { SendUncertain } from './imap';
import { gmailLink, replyEnvelope, viaImap, type ReplyEnvelope } from './mail';
import { GoogleError, type GoogleService } from './service';
import {
  accountRef,
  composeRaw,
  MAIL_FILES_MAX_BYTES,
  pickAccount,
  pickSender,
  type MailFile,
} from './accounts';
import { agendaView, filesView } from './views';

type Reconciled =
  { state: 'confirmed'; receipt: Receipt } | { state: 'absent' } | { state: 'unknown' };
interface Receipt {
  provider: 'google';
  id: string;
  label: string;
  url?: string;
}

const email = z.email().max(254);
/** The biggest message Gmail's API takes in a JSON body (its 5 MB limit, with room for base64). */
const JSON_SEND_MAX_BYTES = 3_500_000;
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
/** Who an email goes to, named as the thread named them when it did. */
const people = (addresses: string[], names?: Record<string, string>): MailPerson[] =>
  addresses.map((address) => {
    const name = names?.[address.toLowerCase()];
    return { address, ...(name && name.toLowerCase() !== address.toLowerCase() && { name }) };
  });

/**
 * An email Conch sent or saved, as a letter that went (ADR 0060): who it went
 * to, what it said, from which account, and where Gmail keeps it.
 */
export function mailSentView(
  args: { to: string[]; cc?: string[]; subject: string; body: string; sourceMessageId?: string },
  account: Pick<GoogleAccount, 'email'>,
  options: {
    state: 'sent' | 'draft';
    url?: string;
    names?: Record<string, string>;
    edited?: boolean;
    /** The files it carries, as Gmail was given them. */
    files?: readonly Pick<MailFile, 'name' | 'mimeType' | 'bytes'>[];
  },
): ToolView {
  return {
    kind: 'mail-sent',
    state: options.state,
    from: account.email,
    to: people(args.to, options.names),
    ...(args.cc?.length && { cc: people(args.cc, options.names) }),
    subject: args.subject.slice(0, 300),
    body: args.body.slice(0, MAIL_PREVIEW_MAX),
    ...(args.body.length > MAIL_PREVIEW_MAX && { clipped: true }),
    at: new Date().toISOString(),
    ...(options.url && { url: options.url }),
    ...(args.sourceMessageId && { reply: true }),
    ...(options.edited && { edited: true }),
    ...(options.files?.length && {
      files: options.files.slice(0, 10).map((f) => ({
        name: f.name.slice(0, 300),
        mime: f.mimeType.slice(0, 120),
        size: f.bytes.length,
      })),
    }),
  };
}

/** Gmail's own search for one Message-ID, in the account it went from. */
export const findInGmail = (email: string, messageId: string) =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#search/${encodeURIComponent(`rfc822msgid:${messageId.replace(/^<|>$/g, '')}`)}`;

/** What the person may change on an email's card: its words and who it goes to. */
const MAIL_FIELDS = ['to', 'cc', 'subject', 'body', 'attachments'] as const;

interface WriteSpec<Shape extends z.ZodRawShape, Prepared> {
  name: GoogleToolName;
  description: string;
  input: Shape;
  capability: GoogleCapability;
  /**
   * Which account, when it isn't the one account that can (sending: the one
   * named, else the first that can send). `guessed` means Conch chose it, so
   * the person sees it first even when they allowed the tool.
   */
  pick?: (ref: string | undefined) => Promise<{ account: GoogleAccount; guessed: boolean }>;
  /** More for the card to show beside the arguments (the names of the files going). */
  shows?: (prepared: Prepared) => Record<string, unknown>;
  /** What it changes, as a person would name it, for the "nothing was …" lines. */
  noun: string;
  /** Show a row while it runs, so going (and failing) is seen, not only arriving. */
  row?: boolean;
  /**
   * The person may change it on the card before allowing it: takes their
   * change and gives the call as it now is, or throws when it can't be used.
   * Checked with the same rules as the model's call; never the account.
   */
  edit?: (
    args: z.infer<z.ZodObject<Shape>> & { accountId: string },
    proposed: MailEdit,
  ) => z.infer<z.ZodObject<Shape>> & { accountId: string };
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
    run: {
      operationId: string;
      authorization: string;
      signal: AbortSignal;
      prepared: Prepared;
      /** The person changed it on the card before allowing it. */
      edited: boolean;
    },
  ) => Promise<{ receipt: Receipt; view?: ToolView }>;
  reconcile: (
    args: z.infer<z.ZodObject<Shape>> & { accountId: string },
    account: GoogleAccount,
    operationId: string,
  ) => Promise<Reconciled>;
}

export interface GoogleWriteOptions {
  /**
   * What the person chose in Apps for a tool that speaks for them (sending):
   * `allow` goes without the question while the chat has read nothing from
   * outside; `ask` is their own Ask, which Auto keeps asking. Left out, it asks.
   */
  chosen?: (toolName: string) => 'allow' | 'ask' | undefined;
  /** The chat's own files by id (`att_…`), for an email to carry. Never a path. */
  files?: (ids: readonly string[]) => Promise<MailFile[]>;
}

/**
 * Whether a change may go without the question: only one the person set to
 * Allow, to an account they named, while nothing from outside is in the chat
 * (an email it read, a web page) and no skill limits it. Anything else asks.
 */
function mayGoUnasked(
  ctx: ToolContext,
  chosen: 'allow' | 'ask' | undefined,
  why: { warning: string; guessed: boolean },
): boolean {
  return (
    chosen === 'allow' &&
    !why.warning &&
    !why.guessed &&
    !ctx.untrusted?.() &&
    !(ctx.taints?.() ?? []).length
  );
}

/** Google's write tools: each one asks, checks the account twice, and can be found again. */
export function googleWriteTools(
  service: GoogleService,
  ctx: ToolContext,
  options: GoogleWriteOptions = {},
): HostTool[] {
  /** Operations started in a chat, not a task: their own id, never reused. */
  const fresh = () => `chat-${randomBytes(18).toString('base64url')}`;

  function write<Shape extends z.ZodRawShape, Prepared = undefined>(
    spec: WriteSpec<Shape, Prepared>,
  ): HostTool {
    const schema = z.object(spec.input);
    const resolve = async (raw: Record<string, unknown>) => {
      const parsed = schema.parse(raw);
      const ref = accountRef.parse((parsed as { accountId?: unknown }).accountId);
      const { account, guessed } = spec.pick
        ? await spec.pick(ref)
        : { account: await pickAccount(service, ref, spec.capability), guessed: false };
      return { args: { ...parsed, accountId: account.id }, account, guessed };
    };
    const notDone = (why: string): HostToolResult => ({
      text: `${why} Nothing was ${spec.noun}.`,
      effect: 'not-executed',
    });
    return {
      name: spec.name,
      description: spec.description,
      input: spec.input,
      ...(spec.row && { row: true }),
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
        const { args, account, guessed } = await resolve(raw);
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
        // What the person changed on the card, checked as the model's call is. Not in a
        // task: its ledger holds the call it was given, so there it goes as it was. And
        // nothing to change when it goes unasked (sending allowed in Apps, ADR 0104).
        const { edit } = spec;
        let edited: typeof args | undefined;
        let refused: string | undefined;
        const names = (prepared as { reply?: { names?: Record<string, string> } } | undefined)
          ?.reply?.names;
        const chosen = options.chosen?.(spec.name);
        const decision = mayGoUnasked(ctx, chosen, { warning, guessed })
          ? 'allow'
          : await ctx.ask({
              toolName: spec.name,
              input: {
                ...args,
                accountEmail: account.email,
                ...spec.shows?.(prepared),
                ...(names && Object.keys(names).length && { names }),
              },
              summary: spec.summary(args, account, prepared),
              ...(warning ? { taint: warning } : {}),
              // Exactly this, this time: never "always".
              once: true,
              // The person's own Ask on this tool: Auto keeps asking (Full trust doesn't).
              ...(chosen === 'ask' && { explicit: true }),
              ...(edit &&
                !context?.operationId && {
                  edit: (proposed: MailEdit) => {
                    try {
                      edited = edit(args, MailEdit.parse(proposed));
                    } catch (error) {
                      refused =
                        error instanceof GoogleError
                          ? error.message
                          : 'it wasn’t an email Gmail could send';
                      throw error;
                    }
                  },
                }),
            });
        if (decision === 'deny')
          return notDone(
            refused
              ? `The person changed it on the card, but the change couldn’t be used (${refused}). Ask them what to change.`
              : 'The person said no.',
          );
        if (ctx.signal.aborted) return notDone('Stopped before it started.');
        let current;
        try {
          current = await service.verificationScope(account.id, spec.capability);
        } catch {
          return notDone('Google access couldn’t be checked after the approval.');
        }
        if (current.authorization !== authorized.authorization)
          return notDone('The account’s access changed while waiting for the approval.');
        // Exactly what the person approved: their change, prepared again (a reply's
        // thread is checked against the words that will go), or the call as it was.
        const final = edited ?? args;
        let ready = prepared;
        if (edited)
          try {
            ready = (await spec.prepare?.(edited, account)) as Prepared;
          } catch (error) {
            if (error instanceof GoogleError)
              return notDone(`The person’s change couldn’t be used: ${error.message}`);
            throw error;
          }
        try {
          const { receipt, view } = await spec.perform(final, account, {
            operationId,
            authorization: authorized.authorization,
            signal: ctx.signal,
            prepared: ready,
            edited: Boolean(edited),
          });
          const changed = edited
            ? MAIL_FIELDS.filter(
                (key) =>
                  JSON.stringify((args as Record<string, unknown>)[key] ?? null) !==
                  JSON.stringify((final as Record<string, unknown>)[key] ?? null),
              )
            : [];
          const text = JSON.stringify({
            state: 'confirmed',
            receipt,
            ...(changed.length && {
              changedByPerson: changed,
              note: `The person changed the ${changed.join(', ')} on the card before approving. What went is in "sent"; it is done, so don't send it again.`,
              sent: Object.fromEntries(
                MAIL_FIELDS.flatMap((key) => {
                  const value = (final as Record<string, unknown>)[key];
                  return value === undefined ? [] : [[key, value]];
                }),
              ),
            }),
          });
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
  const SendInput = {
    accountId: accountRef.describe(
      'The account it goes from: its email address or id from google_accounts. The one the person names; left out, the first account that can send.',
    ),
    to: z.array(email).min(1).max(20),
    cc: z.array(email).max(20).optional(),
    subject: oneLine(500),
    body: z.string().max(100_000),
    attachments: z
      .array(z.string().min(1).max(200))
      .max(10)
      .optional()
      .describe('Files from this chat to attach, by their ids (att_…).'),
    sourceMessageId: resourceId.optional(),
    threadId: resourceId.optional(),
  };
  type SendShape = typeof SendInput;
  const MailList = z.object({
    messages: z.array(z.object({ id: resourceId })).optional(),
    nextPageToken: z.string().optional(),
  });
  const send = write<SendShape, { reply?: ReplyEnvelope; files: MailFile[]; ids: string[] }>({
    name: 'google_mail_send',
    noun: 'sent',
    capability: 'mail-send',
    row: true,
    description:
      'Send an email from a connected Gmail account, as the person. Use it whenever the person asks you to send an email (an app-password account sends too). accountId is the account it goes from: the one the person names (an email from google_accounts); left out, the first account that can send is used and shown to them. The person sees this exact email (From, To, subject, text and files) before it goes, unless they allowed sending in Apps. To attach files, put their ids in attachments (the att_… ids file_make, image_generate, publish_file or list_attachments gave), never a path. For a reply, pass sourceMessageId from google_mail_read: the recipients and subject must match the original, and it is threaded. Plain text. Use google_mail_create_draft instead only when the person wants to edit or send it themselves. Never retry an uncertain send.',
    input: SendInput,
    pick: (ref) => pickSender(service, ref),
    identity: (a) => [
      a.accountId,
      a.sourceMessageId ?? a.threadId ?? null,
      a.to.map((v) => v.toLowerCase()).sort(),
      (a.cc ?? []).map((v) => v.toLowerCase()).sort(),
      a.subject.trim().toLowerCase(),
      [...(a.attachments ?? [])].sort(),
    ],
    // A reply's thread is read before asking: a reply that can't go says so before
    // anyone approves it, and the card can name the people in it. The files are found
    // and weighed before asking too, so the card shows what goes.
    async prepare(a) {
      const reply = await replyEnvelope(service, a);
      if (!a.attachments?.length) return { ...(reply && { reply }), files: [], ids: [] };
      if (!options.files)
        throw new GoogleError('invalid', 'Files can only be attached from a chat they belong to.');
      let files: MailFile[];
      try {
        files = await options.files(a.attachments);
      } catch (error) {
        throw new GoogleError(
          'invalid',
          `${error instanceof Error ? error.message : 'Those files couldn’t be found.'} Nothing was sent.`,
        );
      }
      const size = files.reduce((sum, f) => sum + f.bytes.length, 0);
      if (size > MAIL_FILES_MAX_BYTES)
        throw new GoogleError(
          'invalid',
          `Those files come to ${Math.ceil(size / 1024 / 1024)} MB, and Gmail takes about ${MAIL_FILES_MAX_BYTES / 1024 / 1024} MB in one email. Nothing was sent: send fewer, or share a link instead.`,
        );
      return { ...(reply && { reply }), files, ids: [...new Set(a.attachments)] };
    },
    // The names for the card, and the ids beside them, so a file can be taken off there.
    shows: ({ files, ids }) =>
      files.length ? { files: files.map((f) => f.name), fileIds: ids.slice(0, files.length) } : {},
    edit(a, change) {
      const same = (x: string[], y: string[]) =>
        x.map((v) => v.toLowerCase()).join() === y.map((v) => v.toLowerCase()).join();
      // A reply goes to the thread's people with its subject: that's what threads it.
      if (a.sourceMessageId && (change.subject !== a.subject || !same(change.to, a.to)))
        throw new GoogleError(
          'invalid',
          'a reply keeps the thread’s people and subject; write a new email for anyone else',
        );
      // A file may be taken off on the card, never put on: only the ones the call named.
      const kept = change.attachments ?? a.attachments ?? [];
      if (kept.some((id) => !(a.attachments ?? []).includes(id)))
        throw new GoogleError('invalid', 'only the files that were shown can go with it');
      const { cc: _cc, attachments: _files, ...rest } = a;
      return {
        ...rest,
        to: change.to,
        ...(change.cc?.length && { cc: change.cc }),
        subject: change.subject.trim(),
        body: change.body,
        ...(kept.length && { attachments: [...new Set(kept)] }),
      };
    },
    summary: (a, account, { files }) =>
      `send an email from ${account.email} to ${a.to.join(', ')}${a.cc?.length ? `, copying ${a.cc.join(', ')}` : ''}, with subject “${a.subject}”${files.length ? `, with ${files.map((f) => f.name).join(', ')}` : ''}`,
    async perform(a, account, run) {
      const { reply, files } = run.prepared;
      const shown = (url?: string) =>
        mailSentView(a, account, {
          state: 'sent',
          ...(url && { url }),
          ...(reply?.names && { names: reply.names }),
          edited: run.edited,
          files,
        });
      const messageId = sendMessageId(run.operationId, account.email);
      const raw = composeRaw(a, { messageId, from: account.email, reply, files });
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
          view: shown(findInGmail(account.email, messageId)),
        };
      }
      // Gmail's API takes a message in JSON up to 5 MB; a bigger one (files) is uploaded whole.
      const boundary = `conch-${randomBytes(12).toString('hex')}`;
      const sent = Mail.parse(
        Buffer.byteLength(raw) <= JSON_SEND_MAX_BYTES
          ? await service.api(account.id, 'mail-send', '/gmail/v1/users/me/messages/send', {
              method: 'POST',
              signal: run.signal,
              authorization: run.authorization,
              body: {
                raw: Buffer.from(raw).toString('base64url'),
                ...(reply ? { threadId: reply.threadId } : {}),
              },
            })
          : await service.api(account.id, 'mail-send', '/upload/gmail/v1/users/me/messages/send', {
              method: 'POST',
              signal: run.signal,
              authorization: run.authorization,
              query: { uploadType: 'multipart' },
              raw: {
                contentType: `multipart/related; boundary=${boundary}`,
                body: [
                  `--${boundary}`,
                  'Content-Type: application/json; charset=UTF-8',
                  '',
                  JSON.stringify(reply ? { threadId: reply.threadId } : {}),
                  `--${boundary}`,
                  'Content-Type: message/rfc822',
                  '',
                  raw,
                  `--${boundary}--`,
                  '',
                ].join('\r\n'),
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
        view: shown(gmailLink(account.email, sent.id, 'sent')),
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
