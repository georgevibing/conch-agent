/**
 * Phone calls on the SMS number (ADR 0138): calling your assistant, and
 * Conch ringing you when an OK has waited.
 *
 * Every webhook reaches this only after `sms.ts` checked Twilio's signature
 * and the account, exactly as for a text. Then:
 *
 * - **Only you get the assistant.** A call from any number but the owner's
 *   (or one the carrier says failed caller-ID checks) hears one sentence and
 *   ends: no model turn, nothing kept. A call while calls are off is refused.
 * - **The call is the owner's SMS chat**, by voice: what's said becomes a
 *   message (read like a voice note's words, ADR 0077), and the answers are
 *   spoken back. Questions with buttons still go by text.
 * - **Audio stays here when it can.** With whisper.cpp and a reply voice on
 *   this computer, the call's audio comes over Media Streams and Conch hears
 *   and speaks itself (`stream.ts`). Without them, or when the public address
 *   doesn't carry WebSockets, Twilio's own `<Gather>` and `<Say>` do it.
 * - **A call Conch places approves at most one step**, and only one a
 *   lock-screen tap could (ADR 0108), with 1 or "yes"; 2 or "no" denies.
 *   Anything else is "something needs you in Conch". An answering machine
 *   hears only that, never what it's about.
 * - **Bounded.** One call at a time, `maxMinutes` long at most either way
 *   (Twilio's own `TimeLimit` for the calls Conch places), and the calls it
 *   places a day are capped by the service.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ChannelCalls } from '@conch/protocol';
import { speakable, TwilioStreamMessage } from '@conch/protocol';

import type { DoorSocket, HookReply, HookRequest, HookStream } from '../door';
import { StreamCall } from './stream';
import { twiml, type Verb } from './twiml';

/** Hearing and speaking on this computer, for the call's own audio. */
export interface PhoneVoice {
  /** whisper.cpp and its model, and a reply voice, are here now. */
  ready(): Promise<boolean>;
  hear(wav: Buffer): Promise<string>;
  speak(text: string): Promise<Buffer | undefined>;
}

/** What the channel knows, read fresh for every call. */
export interface PhoneContext {
  settings: ChannelCalls;
  /** The owner's number (E.164), once they said hello. */
  owner?: string;
  /** The assistant's name, as it introduces itself. */
  assistant: string;
}

/** A question Conch rings about (ADR 0108's rules decide `quick`). */
export interface CallAsk {
  conversationId: string;
  permissionId: string;
  /** What it would do, in a few words ("Run the tests"). */
  summary: string;
  /** Asked again when they answer: still waiting, and may a lock-screen tap allow it? */
  still(): { waiting: boolean; quick: boolean };
  respond(decision: 'allow' | 'deny'): Promise<void>;
}

export interface PhoneDeps {
  /** Twilio's REST API, with the account's key (`TwilioSmsAdapter.call`). */
  api<T>(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T>;
  /** The number calls are on. */
  number(): Promise<string>;
  /** The channel's public hook (`…/hooks/<id>`), while the door is ready. */
  hookUrl(): string | undefined;
  context(): Promise<PhoneContext>;
  voice?: PhoneVoice;
  /** The owner said this on a call: a message in their chat. */
  words(from: string, callSid: string, text: string): void;
  /** A call ended (or was placed): for today's count. */
  used(usage: { direction: 'in' | 'out'; seconds: number }): void;
  healed?(message: string): void;
  log?(message: string): void;
  now?: () => number;
}

type Params = Map<string, string>;

interface Call {
  sid: string;
  direction: 'in' | 'out';
  /** The owner's number. */
  peer: string;
  startedAt: number;
  mode: 'stream' | 'gather' | 'approval';
  /** The stream's one-use ticket (its hash), until the socket brings it. */
  ticket?: string;
  ticketExpires?: number;
  stream?: StreamCall;
  /** Answers waiting to be said at the next turn (Gather). */
  pending: string[];
  /** When the owner's last words went to the chat, until something comes back. */
  waitingSince?: number;
  toldStill?: boolean;
  /** Listened and heard nothing, in a row. */
  silent: number;
  /** An approval call: its question, and how many tries at an answer. */
  ask?: CallAsk;
  askId?: string;
  tries: number;
  assistant: string;
  maxMs: number;
  ended?: boolean;
  timer?: NodeJS.Timeout;
  counted?: boolean;
}

/** What a stranger hears: one sentence, then the call ends. */
export const STRANGER_WORDS =
  'Hello. This number belongs to a private assistant that only takes calls from its owner. Goodbye.';
const OFF_WORDS = (assistant: string) =>
  `Calls to ${assistant} are turned off. You can turn them on in Conch, on this number’s page. Goodbye.`;
const BUSY_WORDS = 'I’m on another call right now. Try again in a moment. Goodbye.';
const TIME_WORDS =
  'That’s as long as a call can last. Anything else I say, I’ll text you. Goodbye.';
const NEEDS_YOU = (assistant: string) =>
  `This is ${assistant}. Something needs you in Conch. Open it when you can. Goodbye.`;

/** How long the owner waits for an answer on the line before it's texted instead. */
const WAIT_MS = 90_000;
/** Said once if nothing came back by then. */
const STILL_MS = 8_000;
/** A stream that doesn't connect within this was never coming. */
const TICKET_MS = 30_000;
/** Silences in a row before an idle call ends (each about six seconds). */
const IDLE_TURNS = 3;
/** Calls Conch places ring for this long. */
const RING_SECONDS = 25;
/** Calls Conch places last this long at most, whatever `maxMinutes` says (one question). */
const APPROVAL_SECONDS = 180;
/** A call's socket sends about fifty messages a second; this many in one is something else. */
const MAX_MESSAGES_PER_SECOND = 500;
/** Calls remembered after they end, so a late webhook is answered calmly. */
const KEEP_ENDED = 50;

const digest = (token: string) => createHash('sha256').update(token).digest('base64url');

/** "yes", "Yes.", "allow it": what counts as allowing, by voice. Nothing longer. */
const YES = /^(?:yes|yeah|yep|yup|allow|allow it|approve|approve it|ok|okay|sure|go ahead)$/;
const NO = /^(?:no|nope|deny|deny it|don'?t|do not|stop|cancel)$/;
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** What an approval call heard: allow, deny, or neither. */
export function decisionOf(params: {
  digits?: string;
  speech?: string;
  confidence?: number;
}): 'allow' | 'deny' | undefined {
  if (params.digits === '1') return 'allow';
  if (params.digits === '2') return 'deny';
  if (params.digits) return undefined;
  const said = words(params.speech ?? '');
  if (NO.test(said)) return 'deny';
  // An unsure "yes" isn't one: only a clear one allows.
  if (YES.test(said) && (params.confidence === undefined || params.confidence >= 0.5))
    return 'allow';
  return undefined;
}

/** A carrier's caller-ID check that failed (SHAKEN/STIR, `StirVerstat`). */
const spoofed = (verstat: string | undefined) => Boolean(verstat && /Failed/i.test(verstat));

/** A number as Twilio writes it (E.164), or undefined. */
const e164 = (raw: string | undefined) =>
  raw && /^\+\d{6,15}$/.test(raw.trim()) ? raw.trim() : undefined;

/** The first letter small, for "It needs your OK to run the tests". */
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export class PhoneLine {
  readonly #calls = new Map<string, Call>();
  /** Approval calls by their id in the address, until Twilio says which call they are. */
  readonly #approvals = new Map<string, Call>();
  #fellBack = false;
  #closed = false;

  constructor(private readonly deps: PhoneDeps) {}

  get #now() {
    return (this.deps.now ?? Date.now)();
  }

  /** A webhook that's about a call (not a text). */
  static isCall(params: Params, query: Record<string, string>): boolean {
    return Boolean(query.call) || (params.has('CallSid') && !params.has('MessageSid'));
  }

  /** The live call with the owner at this number, if there is one. */
  #live(peer: string): Call | undefined {
    for (const call of this.#calls.values())
      if (!call.ended && call.peer === peer && call.direction === 'in') return call;
    return undefined;
  }

  /** On a call right now (either way). */
  get busy(): boolean {
    return [...this.#calls.values()].some((c) => !c.ended);
  }

  #url(step: string, extra: Record<string, string> = {}): string {
    const base = this.deps.hookUrl() ?? '';
    return `${base}?${new URLSearchParams({ call: step, ...extra }).toString()}`;
  }

  // ── Answers going out ──────────────────────────────────────────────────

  /**
   * An answer for the chat at `chatId`: spoken, when the owner is on a call
   * there right now (true: it's been taken, don't text it). A question with
   * buttons still goes by text, and the call says so.
   */
  take(chatId: string, markdown: string, buttons: boolean): boolean {
    const call = this.#live(chatId);
    if (!call) return false;
    call.waitingSince = undefined;
    call.toldStill = false;
    if (buttons) {
      this.#say(call, 'I need your OK for something. I’ve texted you the question.');
      return false;
    }
    this.#say(call, markdown);
    return true;
  }

  /** The assistant is still working on the owner's last words. */
  working(chatId: string): void {
    const call = this.#live(chatId);
    if (call?.waitingSince === undefined) return;
    if (call.mode !== 'stream' || call.toldStill) return;
    if (this.#now - call.waitingSince < STILL_MS) return;
    call.toldStill = true;
    void call.stream?.say('Still working on it.');
  }

  #say(call: Call, markdown: string) {
    if (call.stream) void call.stream.say(markdown);
    else call.pending.push(markdown);
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  /** A call webhook, its signature and account already checked. */
  async deliver(params: Params, query: Record<string, string>): Promise<HookReply> {
    const step = query.call;
    const reply = (...verbs: Verb[]): HookReply => ({
      status: 200,
      body: twiml(...verbs),
      type: 'text/xml',
    });
    if (this.#closed) return reply({ reject: 'busy' });
    if (step === 'status') {
      this.#status(params);
      return { status: 204 };
    }
    if (step === 'ok' || step === 'ok-answer')
      return reply(...(await this.#approval(step, params, query)));
    if (step === 'heard' || step === 'wait' || step === 'after')
      return reply(...(await this.#turn(step, params)));
    return reply(...(await this.#incoming(params)));
  }

  /** Someone calls the number. */
  async #incoming(params: Params): Promise<Verb[]> {
    const sid = params.get('CallSid') ?? '';
    if (!/^CA[0-9a-f]{32}$/.test(sid)) return [{ reject: 'rejected' }];
    if (params.get('Direction') && params.get('Direction') !== 'inbound') return [{ hangup: true }];
    if (params.get('To') !== (await this.deps.number())) return [{ reject: 'rejected' }];
    const known = this.#calls.get(sid);
    if (known) return known.ended ? [{ hangup: true }] : this.#listen(known);
    const context = await this.deps.context();
    const from = e164(params.get('From'));
    const owner = Boolean(from && context.owner && from === context.owner);
    if (!owner || spoofed(params.get('StirVerstat')))
      // Never a turn, never a request: one sentence and the call ends.
      return context.settings.answer
        ? [{ say: STRANGER_WORDS }, { hangup: true }]
        : [{ reject: 'rejected' }];
    if (!context.settings.answer) return [{ say: OFF_WORDS(context.assistant) }, { hangup: true }];
    if (this.busy) return [{ say: BUSY_WORDS }, { hangup: true }];
    const call: Call = {
      sid,
      direction: 'in',
      peer: from ?? '',
      startedAt: this.#now,
      mode: 'gather',
      pending: [],
      silent: 0,
      tries: 0,
      assistant: context.assistant,
      maxMs: context.settings.maxMinutes * 60_000,
    };
    this.#remember(call);
    const greeting = `Hi, it’s ${context.assistant}. What can I do for you?`;
    const hook = this.deps.hookUrl();
    if (hook && (await this.deps.voice?.ready().catch(() => false))) {
      const ticket = randomBytes(24).toString('base64url');
      call.mode = 'stream';
      call.ticket = digest(ticket);
      call.ticketExpires = this.#now + TICKET_MS;
      call.pending.push(greeting);
      return [
        {
          stream: {
            url: `${hook.replace(/^http/, 'ws')}/stream`,
            parameters: { ticket },
          },
        },
        // When the stream ends (or never connects), Twilio carries on here.
        { redirect: this.#url('after') },
      ];
    }
    call.pending.push(greeting);
    return this.#listen(call);
  }

  /** Say what's waiting, then listen (Gather: Twilio hears, Twilio speaks). */
  #listen(call: Call): Verb[] {
    const say = call.pending.splice(0);
    return [
      {
        gather: {
          action: this.#url('heard'),
          input: 'speech',
          timeout: 6,
          ...(say.length && { say: say.map(spokenWords) }),
        },
      },
    ];
  }

  #over(call: Call): boolean {
    return this.#now - call.startedAt >= call.maxMs;
  }

  /** The next step of a call the owner made: what they said, waiting, or after the stream. */
  async #turn(step: 'heard' | 'wait' | 'after', params: Params): Promise<Verb[]> {
    const call = this.#calls.get(params.get('CallSid') ?? '');
    if (!call || call.direction !== 'in' || call.ended) return [{ hangup: true }];
    if (step === 'after') {
      // The stream ended on purpose: so does the call.
      if (call.stream) {
        this.#end(call);
        return [{ hangup: true }];
      }
      // It never connected (an address that doesn't carry WebSockets): Twilio's voice instead.
      call.mode = 'gather';
      call.ticket = undefined;
      if (!this.#fellBack) {
        this.#fellBack = true;
        this.deps.healed?.(
          'Answered a call with Twilio’s voice: the public address didn’t carry the call’s audio',
        );
      }
      return this.#listen(call);
    }
    if (this.#over(call)) {
      this.#end(call);
      return [{ say: TIME_WORDS }, { hangup: true }];
    }
    if (step === 'heard') {
      const said = (params.get('SpeechResult') ?? '').trim();
      if (said) {
        call.silent = 0;
        call.waitingSince = this.#now;
        call.toldStill = false;
        this.deps.words(call.peer, call.sid, said);
        return [{ pause: 1 }, { redirect: this.#url('wait') }];
      }
      if (call.pending.length) return this.#listen(call);
      if (call.waitingSince !== undefined) return [{ pause: 2 }, { redirect: this.#url('wait') }];
      if (++call.silent >= IDLE_TURNS) {
        this.#end(call);
        return [{ say: 'I’ll be here when you need me. Goodbye.' }, { hangup: true }];
      }
      return this.#listen(call);
    }
    // Waiting for the answer to what they said.
    if (call.pending.length) return this.#listen(call);
    if (call.waitingSince === undefined) return this.#listen(call);
    const waited = this.#now - call.waitingSince;
    if (waited >= WAIT_MS) {
      this.#end(call);
      return [
        { say: 'This is taking a while. I’ll text you the answer. Goodbye.' },
        { hangup: true },
      ];
    }
    if (waited >= STILL_MS && !call.toldStill) {
      call.toldStill = true;
      return [{ say: 'Still working on it.' }, { redirect: this.#url('wait') }];
    }
    return [{ pause: 2 }, { redirect: this.#url('wait') }];
  }

  /** How a call ended (Twilio's status callback). */
  #status(params: Params) {
    const call = this.#calls.get(params.get('CallSid') ?? '');
    if (!call) return;
    const status = params.get('CallStatus') ?? '';
    if (!['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) return;
    const seconds = Number(params.get('CallDuration') ?? 0) || 0;
    this.#end(call, seconds);
  }

  #end(call: Call, seconds?: number) {
    if (call.ended && call.counted) return;
    call.ended = true;
    clearTimeout(call.timer);
    if (call.askId) this.#approvals.delete(call.askId);
    call.stream?.close();
    if (!call.counted && (seconds !== undefined || call.direction === 'in')) {
      call.counted = true;
      this.deps.used({
        direction: call.direction,
        seconds: seconds ?? Math.round((this.#now - call.startedAt) / 1000),
      });
    }
  }

  #remember(call: Call) {
    this.#calls.set(call.sid, call);
    // A call that outlives its limit by half a minute is ended from here (Twilio is told).
    call.timer = setTimeout(() => void this.hangUp(call.sid), call.maxMs + 30_000);
    call.timer.unref?.();
    if (this.#calls.size > KEEP_ENDED)
      for (const [sid, c] of this.#calls)
        if (c.ended && this.#calls.size > KEEP_ENDED) this.#calls.delete(sid);
  }

  /** End a call from Conch's side. */
  async hangUp(sid: string): Promise<void> {
    const call = this.#calls.get(sid);
    if (call) this.#end(call);
    await this.deps
      .api('POST', `/Calls/${encodeURIComponent(sid)}.json`, { Status: 'completed' })
      .catch((error: unknown) =>
        this.deps.log?.(`call: couldn’t hang up (${(error as Error).message})`),
      );
  }

  // ── The call's audio (Media Streams) ───────────────────────────────────

  /**
   * The `/stream` socket: Twilio signs the upgrade, which `accept` checks
   * (via `sms.ts`); the socket must then name a call this line is expecting,
   * with that call's one-use ticket, before a byte of audio is used.
   */
  stream(accept: (request: HookRequest) => boolean): HookStream {
    return {
      accept,
      open: (socket) => this.#open(socket),
    };
  }

  #open(socket: DoorSocket) {
    let call: Call | undefined;
    let second = 0;
    let messages = 0;
    // A socket that doesn't say which call it is soon is closed.
    const unclaimed = setTimeout(() => {
      if (!call) socket.close();
    }, 10_000);
    unclaimed.unref?.();
    socket.onClose(() => {
      clearTimeout(unclaimed);
      call?.stream?.close();
    });
    socket.onMessage((text) => {
      // About fifty messages a second is a call (more after a hiccup); far more is something else.
      const now = Math.floor(this.#now / 1000);
      if (now !== second) {
        second = now;
        messages = 0;
      }
      if (++messages > MAX_MESSAGES_PER_SECOND) return socket.close();
      let message: TwilioStreamMessage;
      try {
        const parsed = TwilioStreamMessage.safeParse(JSON.parse(text));
        if (!parsed.success) return;
        message = parsed.data;
      } catch {
        return;
      }
      if (call?.stream) {
        if (message.event !== 'connected' && message.event !== 'start')
          if (!('streamSid' in message) || message.streamSid === call.stream.streamSid)
            call.stream.receive(message);
        return;
      }
      if (message.event === 'connected') return;
      if (message.event !== 'start') return socket.close();
      const claimed = this.#claim(message);
      if (!claimed) return socket.close();
      call = claimed;
      clearTimeout(unclaimed);
      const peer = claimed.peer;
      const stream = new StreamCall(socket, message.streamSid, {
        hear: (wav) => this.deps.voice?.hear(wav) ?? Promise.resolve(''),
        speak: (words) => this.deps.voice?.speak(words) ?? Promise.resolve(undefined),
        words: (words) => {
          if (claimed.ended) return;
          if (this.#over(claimed)) return;
          claimed.waitingSince = this.#now;
          claimed.toldStill = false;
          this.deps.words(peer, claimed.sid, words);
        },
        ...(this.deps.log && { log: this.deps.log }),
      });
      claimed.stream = stream;
      for (const said of claimed.pending.splice(0)) void stream.say(said);
      // The limit: a goodbye, then the line is put down.
      const left = Math.max(0, claimed.maxMs - (this.#now - claimed.startedAt));
      const limit = setTimeout(() => {
        void stream
          .say(TIME_WORDS)
          .then(() => stream.played())
          .then(() => this.hangUp(claimed.sid));
      }, left);
      limit.unref?.();
      socket.onClose(() => clearTimeout(limit));
    });
  }

  /** The call a stream's `start` says it is, if that call expects it (once). */
  #claim(message: Extract<TwilioStreamMessage, { event: 'start' }>): Call | undefined {
    const call = this.#calls.get(message.start.callSid);
    const ticket = message.start.customParameters?.ticket;
    if (!call || call.ended || call.mode !== 'stream' || !call.ticket || !ticket) return undefined;
    const expected = Buffer.from(call.ticket);
    const given = Buffer.from(digest(ticket));
    const ok =
      expected.length === given.length &&
      timingSafeEqual(expected, given) &&
      (call.ticketExpires ?? 0) > this.#now;
    // Good once, whatever came of it.
    call.ticket = undefined;
    return ok ? call : undefined;
  }

  // ── Calls Conch places: an OK that waited ───────────────────────────────

  /** Ring the owner about one question. Resolves once Twilio took the call. */
  async ring(to: string, ask: CallAsk): Promise<void> {
    const context = await this.deps.context();
    const hook = this.deps.hookUrl();
    if (!hook) throw new Error('Twilio can’t reach Conch: its public address is off.');
    if (this.busy) throw new Error('Already on a call.');
    const askId = randomBytes(12).toString('base64url');
    const call: Call = {
      sid: '',
      direction: 'out',
      peer: to,
      startedAt: this.#now,
      mode: 'approval',
      pending: [],
      silent: 0,
      tries: 0,
      ask,
      askId,
      assistant: context.assistant,
      maxMs: Math.min(APPROVAL_SECONDS, context.settings.maxMinutes * 60) * 1000,
    };
    this.#approvals.set(askId, call);
    try {
      const placed = await this.deps.api<{ sid: string }>('POST', '/Calls.json', {
        To: to,
        From: await this.deps.number(),
        Url: this.#url('ok', { a: askId }),
        Method: 'POST',
        StatusCallback: this.#url('status'),
        StatusCallbackMethod: 'POST',
        // An answering machine hears that something needs you, never what.
        MachineDetection: 'Enable',
        Timeout: String(RING_SECONDS),
        TimeLimit: String(Math.round(call.maxMs / 1000)),
      });
      call.sid = placed.sid;
      this.#remember(call);
    } catch (error) {
      this.#approvals.delete(askId);
      throw error;
    }
  }

  async #approval(
    step: 'ok' | 'ok-answer',
    params: Params,
    query: Record<string, string>,
  ): Promise<Verb[]> {
    const call = this.#approvals.get(query.a ?? '');
    const sid = params.get('CallSid') ?? '';
    // Only the call Conch placed, to the owner, from this number.
    if (
      !call?.ask ||
      call.ended ||
      (call.sid && call.sid !== sid) ||
      params.get('To') !== call.peer ||
      params.get('From') !== (await this.deps.number())
    )
      return [{ hangup: true }];
    if (!call.sid) {
      call.sid = sid;
      this.#remember(call);
    }
    const ask = call.ask;
    const finish = (said: string): Verb[] => {
      this.#approvals.delete(call.askId ?? '');
      return [{ say: said }, { hangup: true }];
    };
    if (step === 'ok' && /^(?:machine|fax)/.test(params.get('AnsweredBy') ?? ''))
      return finish(NEEDS_YOU(call.assistant));
    const now = ask.still();
    if (!now.waiting) return finish('That’s been answered already. Nothing more to do. Goodbye.');
    if (!now.quick) return finish(NEEDS_YOU(call.assistant));
    const question: Verb = {
      gather: {
        action: this.#url('ok-answer', { a: call.askId ?? '' }),
        input: 'dtmf speech',
        numDigits: 1,
        timeout: 8,
        hints: 'yes, no, allow, deny',
        say: [
          step === 'ok'
            ? `This is ${call.assistant}. It needs your OK to ${lower(clip(ask.summary))}. To allow it, press 1 or say yes. To deny it, press 2 or say no.`
            : 'Sorry, I didn’t get that. Press 1 to allow it, or 2 to deny it.',
        ],
      },
    };
    if (step === 'ok')
      return [question, { redirect: this.#url('ok-answer', { a: call.askId ?? '' }) }];
    const confidence = Number(params.get('Confidence'));
    const decision = decisionOf({
      ...(params.get('Digits') && { digits: params.get('Digits') }),
      ...(params.get('SpeechResult') && { speech: params.get('SpeechResult') }),
      ...(Number.isFinite(confidence) && params.has('Confidence') && { confidence }),
    });
    if (!decision) {
      if (++call.tries < 2) return [question];
      return finish('Nothing was changed. It’s still waiting for you in Conch. Goodbye.');
    }
    // Asked again now: it may have been answered, or changed, while the phone rang.
    const latest = ask.still();
    if (!latest.waiting)
      return finish('That’s been answered already. Nothing more to do. Goodbye.');
    if (decision === 'allow' && !latest.quick) return finish(NEEDS_YOU(call.assistant));
    try {
      await ask.respond(decision);
    } catch (error) {
      this.deps.log?.(`call: couldn’t answer (${(error as Error).message})`);
      return finish(
        'Something went wrong, so nothing was changed. It’s waiting for you in Conch. Goodbye.',
      );
    }
    return finish(decision === 'allow' ? 'Allowed. Goodbye.' : 'Denied. Goodbye.');
  }

  close(): void {
    this.#closed = true;
    for (const call of this.#calls.values()) {
      clearTimeout(call.timer);
      call.stream?.close();
    }
  }
}

const clip = (text: string, max = 200) => {
  const flat = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '');
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** What Twilio's own voice says: Markdown read as plain words, cut to a few sentences. */
function spokenWords(markdown: string): string {
  const text = speakable(markdown);
  return text.length > 900 ? `${text.slice(0, 880).trimEnd()}… The rest is in Conch.` : text;
}
