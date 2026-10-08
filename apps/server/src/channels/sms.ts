/**
 * SMS through Twilio (ADR 0076): a phone number of the assistant's own that
 * you text from any phone. Twilio only delivers texts to a web address, so
 * they come in through the public door (ADR 0045); answers go out through
 * Twilio's REST API.
 *
 * - **Every delivery is signed.** `X-Twilio-Signature` is an HMAC-SHA1 of the
 *   address and the sorted form fields with the account's Auth Token, checked
 *   in constant time before anything is read. A repeated `MessageSid` is one
 *   message.
 * - **Conch points the number at the door itself** (its `SmsUrl`), and again
 *   whenever the door's address changes, so there's nothing to paste in Twilio.
 * - **Plain text.** SMS has no formatting or buttons: Markdown is written as
 *   plain words, long answers are cut at three texts (each costs), and
 *   approvals are answered with a number (`TextChoices`).
 * - **Delivery problems come back later** (a status callback): the ones only
 *   a person can fix (an unregistered US number, a trial account) become the
 *   channel's state, in plain words.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ChannelBot, ChannelSecrets } from '@conch/protocol';
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } from '@conch/protocol';

import type { ChannelEndpoints } from './adapters';
import type { HookReply, HookRequest } from './door';
import { fit, plain } from './format';
import { TextChoices } from './linked';
import {
  Backoff,
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type SendOptions,
  type SentRef,
  appId,
  pause,
  personId,
  redact,
} from './types';

export const TWILIO_API = 'https://api.twilio.com';

type SmsSecrets = Extract<ChannelSecrets, { kind: 'sms' }>;

/** One text is 160 characters (70 with emoji); Twilio joins up to 1600. Parts this long stay under. */
const PART = 1500;
/** Texts per answer at most: each one costs. The rest is in Conch. */
const MAX_PARTS = 3;
/** Pictures sent by MMS, at most this big. */
const FILE_LIMIT = 5 * 1024 * 1024;
/** MessageSids remembered, so a repeated delivery is one message. */
const SEEN = 500;
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** "+4915112345678" → "+49 151 123 45678"-ish, for names; the number itself stays as it is. */
export function readableNumber(number: string): string {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 8) return number;
  const country = digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
  const rest = digits.slice(country.length);
  return `+${country}${country ? ' ' : ''}${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`.trim();
}

/** A number as Twilio writes it (E.164), from however it was typed. */
export function e164(raw: string): string | undefined {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 6 || digits.length > 15) return undefined;
  return `+${trimmed.startsWith('00') ? digits.slice(2) : digits}`;
}

/** Find the Account SID and Auth Token in whatever was pasted (the whole Account Info box is fine). */
export function normalizeSms(secrets: SmsSecrets, kept?: SmsSecrets): SmsSecrets {
  const both = `${secrets.accountSid} ${secrets.authToken}`;
  const number = secrets.number ? e164(secrets.number) : undefined;
  return {
    kind: 'sms',
    provider: 'twilio',
    accountSid: TWILIO_ACCOUNT_SID.exec(both)?.[1] ?? secrets.accountSid.trim(),
    authToken: TWILIO_AUTH_TOKEN.exec(secrets.authToken)?.[1] ?? secrets.authToken.trim(),
    ...((number ?? kept?.number) && { number: number ?? kept?.number }),
    hookId: kept?.hookId ?? secrets.hookId ?? randomBytes(18).toString('base64url'),
  };
}

/**
 * Twilio's signature of a delivery (its `RequestValidator`): the address it
 * called, then each field's name and value, sorted by name (and by value for
 * a name given twice, each pair once), HMAC-SHA1 with the Auth Token, base64.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Iterable<[string, string]>,
): string {
  const pairs = [...new Set([...params].map(([k, v]) => JSON.stringify([k, v])))]
    .map((p) => JSON.parse(p) as [string, string])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
  const data = url + pairs.map(([k, v]) => k + v).join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

/** Whether `signature` is Twilio's for this delivery, with or without the port in the address. */
export function signedByTwilio(
  authToken: string,
  url: string,
  params: [string, string][],
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const given = Buffer.from(signature);
  const variants = new Set([url]);
  try {
    const parsed = new URL(url);
    const port = parsed.protocol === 'https:' ? '443' : '80';
    if (parsed.port) variants.add(url.replace(`:${parsed.port}`, ''));
    else variants.add(url.replace(parsed.host, `${parsed.host}:${port}`));
  } catch {
    return false;
  }
  return [...variants].some((variant) => {
    const expected = Buffer.from(twilioSignature(authToken, variant, params));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

interface TwilioNumber {
  sid: string;
  phone_number: string;
  friendly_name?: string;
  sms_url?: string;
  capabilities?: { sms?: boolean; SMS?: boolean };
}

/** Twilio's own error codes, as the setting to change. */
function plainError(code: number | undefined, status: number, message: string): ChannelError {
  if (status === 401 || code === 20003)
    return new ChannelError(
      'auth',
      'Twilio doesn’t accept that Auth Token. Copy it again from Account Info on the Twilio Console’s first page.',
      { field: 'authToken' },
    );
  if (status === 404 && code === 20404)
    return new ChannelError('auth', 'Twilio doesn’t know that Account SID.', {
      field: 'accountSid',
    });
  if (status === 429 || code === 20429)
    return new ChannelError('rate-limit', 'Twilio asked Conch to slow down.', {
      retryAfterMs: 5_000,
    });
  if (status >= 500) return new ChannelError('network', `Twilio had a problem (${status}).`);
  if (code === 21608)
    return new ChannelError(
      'setup',
      'A Twilio trial account only texts numbers you verified. Add your phone under Phone Numbers → Verified Caller IDs in Twilio, or upgrade the account.',
    );
  if (code === 21610)
    return new ChannelError(
      'refused',
      'That phone replied STOP, so Twilio won’t text it. Text START from it to allow it again.',
    );
  if (code === 21211 || code === 21614)
    return new ChannelError('refused', 'That isn’t a number Twilio can text.');
  if (code === 21606 || code === 21659 || code === 21612)
    return new ChannelError(
      'setup',
      'This Twilio number can’t send texts there. Use a number that can send SMS (Phone Numbers → Buy a number, with SMS ticked).',
    );
  return new ChannelError(
    'refused',
    `Twilio said no (${code ?? status}${message ? `: ${message}` : ''}).`,
  );
}

/** Delivery problems Twilio reports later that only a person can fix, in their words. */
const UNDELIVERED: Record<string, string> = {
  '30034':
    'US carriers block texts from numbers that aren’t registered. In Twilio, register the number for A2P 10DLC (Messaging → Regulatory Compliance), or use a verified toll-free number.',
  '30032':
    'This toll-free number isn’t verified yet, so carriers block its texts. Finish its verification in Twilio (Phone Numbers → Toll-free verification).',
  '30007': 'The carrier filtered the text as spam. Twilio’s Console says why under Monitor → Logs.',
  '21610':
    'Your phone replied STOP, so Twilio won’t text it. Text START to the number to allow it again.',
  '30044':
    'A Twilio trial account only texts numbers you verified. Add your phone under Phone Numbers → Verified Caller IDs in Twilio, or upgrade the account.',
};

/**
 * SMS through a Twilio number (ADR 0076). The number is a bot of its own:
 * nobody gets in unless you let them, and strangers who text it get one
 * polite reply.
 */
export class TwilioSmsAdapter implements ChannelAdapter {
  readonly kind = 'sms' as const;
  #number?: TwilioNumber;

  constructor(
    private readonly secrets: SmsSecrets,
    private readonly endpoints: ChannelEndpoints = {},
  ) {}

  get #api() {
    return this.endpoints.twilio ?? TWILIO_API;
  }

  get #account() {
    return `/2010-04-01/Accounts/${encodeURIComponent(this.secrets.accountSid)}`;
  }

  async call<T>(
    method: 'GET' | 'POST',
    path: string,
    form?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    // The SID goes into the address, so it must be only a SID; the token only goes in a header.
    if (!TWILIO_ACCOUNT_SID.test(this.secrets.accountSid))
      throw new ChannelError(
        'auth',
        'That doesn’t look like an Account SID. It starts with AC, and it’s under Account Info on the Twilio Console’s first page.',
        { field: 'accountSid' },
      );
    if (!/^[\x21-\x7e]{16,128}$/.test(this.secrets.authToken))
      throw new ChannelError('auth', 'That doesn’t look like an Auth Token.', {
        field: 'authToken',
      });
    let response: Response;
    try {
      response = await fetch(`${this.#api}${this.#account}${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${this.secrets.accountSid}:${this.secrets.authToken}`).toString('base64')}`,
          ...(form && { 'content-type': 'application/x-www-form-urlencoded' }),
        },
        ...(form && { body: new URLSearchParams(form).toString() }),
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(`Couldn’t reach Twilio (${(error as Error).message}).`, this.secrets.authToken),
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
    };
    if (response.ok) return body as T;
    throw plainError(
      body.code,
      response.status,
      redact(body.message ?? '', this.secrets.authToken),
    );
  }

  /** The account's number to text from: the one chosen, else the first that can send SMS. */
  async #pick(signal?: AbortSignal): Promise<TwilioNumber> {
    const listed = await this.call<{ incoming_phone_numbers?: TwilioNumber[] }>(
      'GET',
      '/IncomingPhoneNumbers.json?PageSize=100',
      undefined,
      signal,
    );
    const numbers = listed.incoming_phone_numbers ?? [];
    const canText = (n: TwilioNumber) => n.capabilities?.sms ?? n.capabilities?.SMS ?? true;
    const chosen = this.secrets.number
      ? numbers.find((n) => n.phone_number === this.secrets.number)
      : numbers.find(canText);
    if (!chosen)
      throw new ChannelError(
        'setup',
        this.secrets.number
          ? `${readableNumber(this.secrets.number)} isn’t one of this Twilio account’s numbers.`
          : 'This Twilio account has no number that can text yet. In Twilio, open Phone Numbers → Buy a number, tick SMS, and buy one. Then come back.',
        { field: 'number' },
      );
    this.#number = chosen;
    return chosen;
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    const account = await this.call<{ status?: string; friendly_name?: string }>(
      'GET',
      '.json',
      undefined,
      signal,
    );
    if (account.status && account.status !== 'active')
      throw new ChannelError(
        'auth',
        `This Twilio account is ${account.status}. Open the Twilio Console to set it right.`,
        { field: 'accountSid' },
      );
    const number = await this.#pick(signal);
    return {
      id: number.phone_number,
      name: number.friendly_name || readableNumber(number.phone_number),
      phone: number.phone_number,
      chatUrl: `sms:${number.phone_number}`,
    };
  }

  hook() {
    const url = this.endpoints.door?.hookUrl(this.secrets.hookId ?? '');
    return url ? { url } : {};
  }

  /** Point the number's incoming texts at the door's address (an old address is replaced). */
  async #point(url: string, events: ChannelEvents, signal: AbortSignal) {
    const number = this.#number ?? (await this.#pick(signal));
    if (number.sms_url === url) return;
    await this.call(
      'POST',
      `/IncomingPhoneNumbers/${encodeURIComponent(number.sid)}.json`,
      { SmsUrl: url, SmsMethod: 'POST' },
      signal,
    );
    if (number.sms_url && !number.sms_url.includes('/hooks/'))
      events.healed(`Pointed ${readableNumber(number.phone_number)}’s texts back to Conch`);
    this.#number = { ...number, sms_url: url };
  }

  connect(events: ChannelEvents): ChannelConnection {
    const stop = new AbortController();
    const choices = new TextChoices();
    const seen = new Set<string>();
    const door = this.endpoints.door;
    /**
     * Set while a delivery problem only you can fix stands. A text sent after it
     * that's delivered clears it (callbacks come in any order, so an older one
     * being delivered says nothing).
     */
    let undelivered: string | undefined;
    let problemAt = -1;
    /** The order Conch sent its texts in, by MessageSid (the last few hundred). */
    const order = new Map<string, number>();
    let sentCount = 0;

    const health = async () => {
      const url = this.hook().url;
      if (!url) {
        events.state('error', {
          message:
            door?.status().state === 'starting'
              ? 'Turning on the public address Twilio delivers to…'
              : 'Twilio can’t reach Conch yet: turn on its public address on this channel’s page.',
        });
        return;
      }
      const backoff = new Backoff();
      while (!stop.signal.aborted) {
        try {
          await this.#point(url, events, stop.signal);
          if (undelivered) events.state('error', { message: undelivered });
          else events.state('online');
          return;
        } catch (error) {
          if (stop.signal.aborted) return;
          const failure =
            error instanceof ChannelError ? error : new ChannelError('network', String(error));
          if (failure.code === 'auth')
            return events.state('needs-token', { message: failure.message });
          if (failure.code === 'setup') return events.state('error', { message: failure.message });
          const wait = failure.detail?.retryAfterMs ?? backoff.next();
          events.state('reconnecting', { message: failure.message, retryAt: Date.now() + wait });
          await pause(wait, stop.signal);
        }
      }
    };

    const deliver = async (request: HookRequest): Promise<HookReply> => {
      if (request.method !== 'POST') return { status: 405 };
      const url = this.hook().url;
      const params = [...new URLSearchParams(request.body)];
      // Nothing is read before Twilio's signature checks out.
      if (
        !url ||
        !signedByTwilio(this.secrets.authToken, url, params, request.headers['x-twilio-signature'])
      )
        return { status: 403 };
      const field = (name: string) => params.find(([k]) => k === name)?.[1];
      if (field('AccountSid') !== this.secrets.accountSid) return { status: 403 };
      events.heard?.();
      const status = field('MessageStatus');
      if (status && field('Body') === undefined) {
        // How a text Conch sent went.
        const problem = UNDELIVERED[field('ErrorCode') ?? ''];
        const at = order.get(field('MessageSid') ?? '') ?? -1;
        if ((status === 'undelivered' || status === 'failed') && problem) {
          undelivered = problem;
          problemAt = Math.max(problemAt, at);
          events.state('error', { message: problem });
        } else if (status === 'delivered' && undelivered && at > problemAt) {
          undelivered = undefined;
          events.state('online');
        }
        return { status: 204 };
      }
      const sid = field('MessageSid') ?? field('SmsSid');
      const from = field('From');
      const to = field('To');
      if (!sid || !from || (this.#number && to !== this.#number.phone_number))
        return { status: 200, body: EMPTY_TWIML, type: 'text/xml' };
      if (seen.has(sid)) return { status: 200, body: EMPTY_TWIML, type: 'text/xml' };
      seen.add(sid);
      if (seen.size > SEEN) seen.delete(seen.values().next().value ?? '');
      const sender = e164(from);
      if (!sender) return { status: 200, body: EMPTY_TWIML, type: 'text/xml' };
      const text = field('Body') ?? '';
      const files: ChannelFile[] = [];
      const count = Math.min(Number(field('NumMedia') ?? 0) || 0, 10);
      for (let i = 0; i < count; i++) {
        const ref = field(`MediaUrl${i}`);
        const type = field(`MediaContentType${i}`);
        if (ref)
          files.push({
            name: mmsName(i, type),
            ref,
            ...(type && { mimeType: type }),
          });
      }
      const user = { id: personId(sender), name: readableNumber(sender), anonymous: true };
      const answer = files.length ? undefined : choices.match(sender, text);
      if (answer)
        events.press({
          chatId: sender,
          user,
          data: answer.data,
          message: answer.ref,
          ack: () => Promise.resolve(),
        });
      else events.message({ chatId: sender, messageId: sid, user, text, files, direct: true });
      return { status: 200, body: EMPTY_TWIML, type: 'text/xml' };
    };

    const unmount = door?.mount(this.secrets.hookId ?? '', 'sms', deliver);
    const offDoor = door?.onChange(() => {
      events.changed?.();
      void health();
    });
    events.state('connecting');
    void health();

    const send = async (chatId: string, markdown: string, options?: SendOptions) => {
      const number = this.#number ?? (await this.#pick());
      const words = options?.buttons?.length
        ? TextChoices.render(markdown, options.buttons)
        : markdown;
      let parts = fit(words, PART, (part) => plain(part).length).map((part) => plain(part));
      if (parts.length > MAX_PARTS)
        parts = [
          ...parts.slice(0, MAX_PARTS - 1),
          `${(parts[MAX_PARTS - 1] ?? '').slice(0, PART - 60)}… (the rest is in Conch)`,
        ];
      const refs: SentRef[] = [];
      const callback = this.hook().url;
      for (const part of parts) {
        const sent = await this.call<{ sid: string }>('POST', '/Messages.json', {
          From: number.phone_number,
          To: chatId,
          Body: part || '…',
          ...(callback && { StatusCallback: callback }),
        });
        refs.push({ chatId, messageId: sent.sid });
        order.set(sent.sid, sentCount++);
        if (order.size > SEEN) order.delete(order.keys().next().value ?? '');
      }
      const last = refs.at(-1);
      if (last && options?.buttons?.length) choices.remember(last, options.buttons);
      return refs;
    };

    return {
      send,
      // No `files`: a picture by MMS must be at a public web address Twilio fetches
      // (`MediaUrl`), and Conch never puts your files on the internet. The assistant is told so.
      // A text can't be changed once sent; the question just stops taking answers.
      edit: async (ref) => choices.forget(ref),
      typing: () => Promise.resolve(),
      download: (file) => this.#download(file),
      directChat: (userId) => Promise.resolve(appId(userId)),
      close: () => {
        stop.abort();
        unmount?.();
        offDoor?.();
      },
    };
  }

  /** A picture sent by MMS: only from this account's own messages on Twilio, with its key. */
  async #download(file: ChannelFile) {
    const base = `${this.#api}${this.#account}/Messages/`;
    if (!file.ref.startsWith(base))
      throw new ChannelError('refused', 'That file isn’t on Twilio, so Conch didn’t fetch it.');
    let response: Response;
    try {
      // Twilio sends it on to its file host; the key isn't passed along to another host.
      response = await fetch(file.ref, {
        headers: {
          authorization: `Basic ${Buffer.from(`${this.secrets.accountSid}:${this.secrets.authToken}`).toString('base64')}`,
        },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new ChannelError(
        'network',
        redact(
          `Couldn’t download that picture (${(error as Error).message}).`,
          this.secrets.authToken,
        ),
      );
    }
    if (!response.ok)
      throw new ChannelError('network', `Twilio didn’t hand over that file (${response.status}).`);
    const size = Number(response.headers.get('content-length') ?? 0);
    if (size > FILE_LIMIT)
      throw new ChannelError('refused', 'Pictures by text can be 5 MB at most.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > FILE_LIMIT)
      throw new ChannelError('refused', 'Pictures by text can be 5 MB at most.');
    return {
      name: file.name,
      bytes,
      ...((file.mimeType ?? response.headers.get('content-type')) && {
        mimeType: file.mimeType ?? response.headers.get('content-type') ?? undefined,
      }),
    };
  }
}

/** An MMS file's name from its type: a picture, a contact card, a PDF… (Twilio sends no names). */
export function mmsName(index: number, type: string | undefined): string {
  const base = type?.split(';')[0]?.trim().toLowerCase() ?? '';
  const known: Record<string, string> = {
    'application/pdf': 'pdf',
    'text/vcard': 'vcf',
    'text/x-vcard': 'vcf',
    'text/plain': 'txt',
    'image/jpeg': 'jpg',
  };
  const ext = known[base] ?? (base.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'jpg');
  const what = base.startsWith('image/')
    ? 'picture'
    : base.startsWith('video/')
      ? 'video'
      : base.startsWith('audio/')
        ? 'audio'
        : ext === 'vcf'
          ? 'contact'
          : 'file';
  return `${what}-${index + 1}.${ext}`;
}
