import {
  CALLS_DEFAULT,
  type Channel,
  type ChannelCalls,
  type ChannelDoor,
  type ChannelList,
  type ServerEvent,
} from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApprovalCalls } from './approvals';
import { phoneCallsCheck } from './doctor';
import {
  SpeechDetector,
  decodeUlaw,
  encodeUlaw,
  resample,
  sampleToUlaw,
  samplesOf,
  ulawToSample,
  wavFrom,
} from './audio';
import {
  type CallAsk,
  decisionOf,
  PhoneLine,
  type PhoneContext,
  type PhoneDeps,
  STRANGER_WORDS,
  UNCONFIRMED_WORDS,
} from './phone';
import { FRAME, StreamCall } from './stream';
import { twiml, xml } from './twiml';

const NUMBER = '+15005550006';
const OWNER = '+15551230001';
const STRANGER = '+15559870002';
const HOOK = 'https://mac.tail1.ts.net/conch/hooks/abcdefghijklmnopqrstuvwx';
const sid = (n: number) => `CA${String(n).padStart(32, '0')}`;
const MZ = `MZ${'0'.repeat(32)}`;

afterEach(() => {
  vi.useRealTimers();
});

function line(
  calls: Partial<ChannelCalls> = {},
  over: Partial<PhoneDeps> = {},
  context: Partial<PhoneContext> = {},
) {
  let now = 1_700_000_000_000;
  const said: { from: string; text: string }[] = [];
  const used: { direction: 'in' | 'out'; seconds: number }[] = [];
  const api = vi.fn(async (_method: string, path: string, _form?: Record<string, string>) =>
    path === '/Calls.json' ? { sid: sid(99) } : {},
  );
  const deps: PhoneDeps = {
    api: api as PhoneDeps['api'],
    number: async () => NUMBER,
    hookUrl: () => HOOK,
    context: async () => ({
      settings: { ...CALLS_DEFAULT, answer: true, approvals: true, ...calls },
      owner: OWNER,
      assistant: 'Pearl',
      ...context,
    }),
    words: (from, _sid, text) => said.push({ from, text }),
    used: (usage) => used.push(usage),
    now: () => now,
    ...over,
  };
  return {
    phone: new PhoneLine(deps),
    api,
    said,
    used,
    advance: (ms: number) => (now += ms),
  };
}

const params = (fields: Record<string, string>) =>
  new Map(Object.entries({ AccountSid: 'AC' + '0'.repeat(32), ...fields }));

/** The carrier fully vouches for the caller ID, unless `extra` says otherwise. */
const ring = (phone: PhoneLine, from = OWNER, n = 1, extra: Record<string, string> = {}) =>
  phone.deliver(
    params({
      CallSid: sid(n),
      From: from,
      To: NUMBER,
      Direction: 'inbound',
      StirVerstat: 'TN-Validation-Passed-A',
      ...extra,
    }),
    {},
  );

const step = (
  phone: PhoneLine,
  call: string,
  fields: Record<string, string> = {},
  n = 1,
  extra: Record<string, string> = {},
) =>
  phone.deliver(params({ CallSid: sid(n), From: OWNER, To: NUMBER, ...fields }), {
    call,
    ...extra,
  });

describe('TwiML', () => {
  it('escapes everything, so nothing said becomes an instruction to Twilio', () => {
    expect(xml('<Dial>+1</Dial> & "x"')).toBe('&lt;Dial&gt;+1&lt;/Dial&gt; &amp; &quot;x&quot;');
    const doc = twiml({ say: 'Hi </Say><Dial>+15550000000</Dial>' }, { hangup: true });
    expect(doc).not.toContain('<Dial>');
    expect(doc).toMatch(/<Say>Hi &lt;\/Say&gt;&lt;Dial&gt;.*<\/Say><Hangup\/>/);
  });
});

describe('a call’s audio', () => {
  it('turns μ-law into samples and back', () => {
    for (const s of [0, 100, -100, 1000, -1000, 8000, -8000, 30000, -30000]) {
      const back = ulawToSample(sampleToUlaw(s));
      expect(Math.abs(back - s)).toBeLessThanOrEqual(Math.max(8, Math.abs(s) * 0.07));
    }
    const samples = Int16Array.from({ length: 160 }, (_, i) => Math.round(Math.sin(i / 3) * 8000));
    expect(decodeUlaw(encodeUlaw(samples)).length).toBe(160);
  });

  it('resamples up and down, and reads back a WAV it wrote', () => {
    const tone = Int16Array.from({ length: 800 }, (_, i) => Math.round(Math.sin(i / 4) * 5000));
    expect(resample(tone, 8_000, 16_000).length).toBe(1600);
    expect(resample(tone, 22_050, 8_000).length).toBe(Math.floor(800 / (22_050 / 8_000)));
    const wav = wavFrom(tone, 8_000);
    const read = samplesOf(wav);
    expect(read?.rate).toBe(8_000);
    expect(read?.samples.length).toBe(800);
    expect(samplesOf(Buffer.from('not a wav at all, not at all, really not one'))).toBeUndefined();
  });

  it('tells words from a quiet line, and when they end', () => {
    const detector = new SpeechDetector({ endFrames: 5 });
    const quiet = new Int16Array(FRAME).fill(20);
    const loud = Int16Array.from({ length: FRAME }, (_, i) => (i % 2 ? 6000 : -6000));
    for (let i = 0; i < 20; i++) expect(detector.frame(quiet).started).toBe(false);
    const starts = [0, 1, 2].map(() => detector.frame(loud).started);
    expect(starts).toEqual([false, false, true]);
    const ends = [0, 1, 2, 3, 4].map(() => detector.frame(quiet).ended);
    expect(ends.at(-1)).toBe(true);
  });
});

describe('calling your assistant (ADR 0138)', () => {
  it('a stranger hears one sentence and the call ends: no turn, nothing kept', async () => {
    const { phone, said } = line();
    const answer = await ring(phone, STRANGER);
    expect(answer.body).toContain(`<Say>${xml(STRANGER_WORDS)}</Say><Hangup/>`);
    expect(said).toEqual([]);
    expect(phone.busy).toBe(false);
  });

  it('the owner’s number that failed the carrier’s caller-ID check is a stranger', async () => {
    const { phone, said } = line();
    const answer = await ring(phone, OWNER, 1, { StirVerstat: 'TN-Validation-Failed-A' });
    expect(answer.body).toContain('only takes calls from its owner');
    expect(said).toEqual([]);
  });

  it('with calls off, a stranger is refused and you hear how to turn them on', async () => {
    const { phone } = line({ answer: false });
    expect((await ring(phone, STRANGER)).body).toContain('<Reject reason="rejected"/>');
    expect((await ring(phone, OWNER, 2)).body).toMatch(/Calls to Pearl are turned off/);
    const unknown = line({}, {}, { owner: undefined });
    expect((await ring(unknown.phone, OWNER)).body).toContain('only takes calls from its owner');
  });

  it('refuses a call to another number, or one that isn’t a call', async () => {
    const { phone } = line();
    const wrong = await phone.deliver(
      params({ CallSid: sid(1), From: OWNER, To: '+15550000000', Direction: 'inbound' }),
      {},
    );
    expect(wrong.body).toContain('<Reject');
    expect(
      (await phone.deliver(params({ CallSid: 'nope', From: OWNER, To: NUMBER }), {})).body,
    ).toContain('<Reject');
  });

  it('greets you, takes what you say into your chat, and says the answer (Twilio’s voice)', async () => {
    const { phone, said } = line();
    const hello = await ring(phone);
    expect(hello.body).toMatch(/<Gather[^>]*input="speech"[^>]*action="[^"]+\?call=heard"/);
    expect(hello.body).toContain('Hi, it’s Pearl.');
    expect(phone.busy).toBe(true);
    const heard = await step(phone, 'heard', { SpeechResult: 'What’s on my calendar?' });
    expect(said).toEqual([{ from: OWNER, text: 'What’s on my calendar?' }]);
    expect(heard.body).toMatch(/<Redirect method="POST">[^<]+call=wait<\/Redirect>/);
    expect((await step(phone, 'wait')).body).toContain('<Pause');
    // The answer arrives: said on the call, not texted.
    expect(
      phone.take(OWNER, 'You have **two** meetings. [Details](https://x.example)', false),
    ).toBe(true);
    const spoken = await step(phone, 'wait');
    expect(spoken.body).toContain('<Say>You have two meetings. Details</Say>');
    expect(spoken.body).toContain('call=heard');
    // Someone else's chat isn't on the call.
    expect(phone.take(STRANGER, 'hi', false)).toBe(false);
  });

  it('a question with buttons still goes by text, and the call says so', async () => {
    const { phone } = line();
    await ring(phone);
    await step(phone, 'heard', { SpeechResult: 'run the tests' });
    expect(phone.take(OWNER, 'Pearl would like to: run npm test', true)).toBe(false);
    expect((await step(phone, 'wait')).body).toContain('I’ve texted you the question.');
  });

  it('says it’s still working, and texts the answer when it takes too long', async () => {
    const { phone, advance } = line();
    await ring(phone);
    await step(phone, 'heard', { SpeechResult: 'plan my week' });
    advance(9_000);
    expect((await step(phone, 'wait')).body).toContain('Still working on it.');
    advance(90_000);
    const gone = await step(phone, 'wait');
    expect(gone.body).toMatch(/I’ll text you the answer\. Goodbye\.<\/Say><Hangup\/>/);
    expect(phone.busy).toBe(false);
    // The answer that comes after goes by text.
    expect(phone.take(OWNER, 'Done.', false)).toBe(false);
  });

  it('ends at the longest a call may last, and counts it', async () => {
    const { phone, used, advance } = line({ maxMinutes: 5 });
    await ring(phone);
    advance(5 * 60_000);
    const over = await step(phone, 'heard', { SpeechResult: 'one more thing' });
    expect(over.body).toMatch(/as long as a call can last.*<Hangup\/>/);
    expect(used).toEqual([{ direction: 'in', seconds: 300 }]);
  });

  it('one call at a time, and an idle line is put down', async () => {
    const { phone } = line();
    await ring(phone);
    expect((await ring(phone, OWNER, 2)).body).toContain('on another call');
    for (let i = 0; i < 2; i++) expect((await step(phone, 'heard')).body).toContain('<Gather');
    expect((await step(phone, 'heard')).body).toMatch(/Goodbye\.<\/Say><Hangup\/>/);
  });

  it('a step for a call it doesn’t know hangs up', async () => {
    const { phone, said } = line();
    expect((await step(phone, 'heard', { SpeechResult: 'rm -rf' }, 7)).body).toContain('<Hangup/>');
    expect(said).toEqual([]);
  });
});

describe('only when it’s surely you: attestation A or the call passcode (ADR 0138)', () => {
  const PASSCODE = '482913';
  /** A passcode check that counts like the channel's: `lockAfter` wrong ones and it's locked. */
  function passcode(lockAfter = 5, fails = 0) {
    const tried: string[] = [];
    const check = vi.fn(async (digits: string) => {
      tried.push(digits);
      if (fails >= lockAfter) return 'locked' as const;
      if (digits === PASSCODE) return 'right' as const;
      return ++fails >= lockAfter ? ('locked' as const) : ('wrong' as const);
    });
    return {
      tried,
      check,
      context: {
        passcode: {
          get locked() {
            return fails >= lockAfter;
          },
          check,
        },
      },
    };
  }
  const unvouched = (verdict: string | undefined) => ({ StirVerstat: verdict ?? '' });

  it('attestation A gets your assistant without a passcode', async () => {
    const { phone } = line();
    const hello = await ring(phone, OWNER, 1, { StirVerstat: 'TN-Validation-Passed-A' });
    expect(hello.body).toContain('Hi, it’s Pearl.');
    expect(hello.body).toContain('call=heard');
  });

  it.each(['TN-Validation-Passed-B', 'TN-Validation-Passed-C', 'No-TN-Validation', undefined])(
    'without a passcode, %s hears it can’t confirm it’s you, and the call ends',
    async (verdict) => {
      const { phone, said } = line();
      const answer = await ring(phone, OWNER, 1, unvouched(verdict));
      expect(answer.body).toBe(twiml({ say: UNCONFIRMED_WORDS }, { hangup: true }));
      expect(answer.body).not.toContain('Pearl');
      expect(phone.busy).toBe(false);
      expect(phone.take(OWNER, 'Your latest email says…', false)).toBe(false);
      expect(said).toEqual([]);
    },
  );

  it('asks for the passcode on the keypad first, and nothing is heard or said until it’s right', async () => {
    const code = passcode();
    const { phone, said } = line({}, {}, code.context);
    const asked = await ring(phone, OWNER, 1, unvouched('TN-Validation-Passed-B'));
    expect(asked.body).toMatch(/<Gather input="dtmf" action="[^"]+\?call=code"/);
    expect(asked.body).toContain('Enter your call passcode');
    expect(asked.body).not.toContain('speech');
    expect(asked.body).not.toContain('Pearl');
    expect(phone.take(OWNER, 'Your latest email says…', false)).toBe(false);
    // Words before the passcode: nothing heard, and the call ends.
    expect((await step(phone, 'heard', { SpeechResult: 'read my latest email' })).body).toContain(
      '<Hangup/>',
    );
    expect(said).toEqual([]);
  });

  it('the right passcode gets your assistant', async () => {
    const code = passcode();
    const { phone, said } = line({}, {}, code.context);
    await ring(phone, OWNER, 1, unvouched(undefined));
    const hello = await step(phone, 'code', { Digits: PASSCODE });
    expect(code.tried).toEqual([PASSCODE]);
    expect(hello.body).toContain('Hi, it’s Pearl.');
    expect(hello.body).toContain('call=heard');
    await step(phone, 'heard', { SpeechResult: 'read my latest email' });
    expect(said).toEqual([{ from: OWNER, text: 'read my latest email' }]);
    expect(phone.take(OWNER, 'It says hello.', false)).toBe(true);
  });

  it('the passcode comes before the call’s own audio, too', async () => {
    const code = passcode();
    const v = { ready: async () => true, hear: async () => '', speak: async () => undefined };
    const { phone } = line({}, { voice: v }, code.context);
    const asked = await ring(phone, OWNER, 1, unvouched(undefined));
    expect(asked.body).not.toContain('<Stream');
    const hello = await step(phone, 'code', { Digits: PASSCODE });
    expect(hello.body).toContain('<Connect><Stream');
  });

  it('three wrong passcodes end the call, and the day’s lock turns the next call away', async () => {
    const code = passcode(5);
    const { phone, said } = line({}, {}, code.context);
    await ring(phone, OWNER, 1, unvouched(undefined));
    expect((await step(phone, 'code', { Digits: '111222' })).body).toContain('isn’t right');
    expect((await step(phone, 'code', { Digits: '9' })).body).toContain('isn’t right');
    const ended = await step(phone, 'code', { Digits: '000000' });
    expect(ended.body).toBe(twiml({ say: UNCONFIRMED_WORDS }, { hangup: true }));
    expect(phone.busy).toBe(false);
    // The right one, too late for this call.
    expect((await step(phone, 'code', { Digits: PASSCODE })).body).toContain('<Hangup/>');
    // Two more wrong ones on another call reach the day's lock.
    await ring(phone, OWNER, 2, unvouched(undefined));
    await step(phone, 'code', { Digits: '123123' }, 2);
    expect((await step(phone, 'code', { Digits: '321321' }, 2)).body).toBe(
      twiml({ say: UNCONFIRMED_WORDS }, { hangup: true }),
    );
    // Locked: not even asked, and the right passcode is never tried.
    const third = await ring(phone, OWNER, 3, unvouched(undefined));
    expect(third.body).toBe(twiml({ say: UNCONFIRMED_WORDS }, { hangup: true }));
    expect(code.tried).not.toContain(PASSCODE);
    expect(said).toEqual([]);
  });

  it('a silence isn’t a wrong passcode: asked once more, then the call ends', async () => {
    const code = passcode();
    const { phone } = line({}, {}, code.context);
    await ring(phone, OWNER, 1, unvouched(undefined));
    expect((await step(phone, 'code')).body).toContain('Enter your call passcode');
    expect((await step(phone, 'code')).body).toContain('<Hangup/>');
    expect(code.check).not.toHaveBeenCalled();
  });

  it('a failed check still turns the call away, and a stranger is never asked', async () => {
    const code = passcode();
    const { phone } = line({}, {}, code.context);
    const failed = await ring(phone, OWNER, 1, { StirVerstat: 'TN-Validation-Failed-A' });
    expect(failed.body).toContain('only takes calls from its owner');
    const stranger = await ring(phone, STRANGER, 2, unvouched(undefined));
    expect(stranger.body).toContain('only takes calls from its owner');
    expect(code.check).not.toHaveBeenCalled();
  });
});

describe('the call’s own audio (Media Streams)', () => {
  const speech = Buffer.from(
    encodeUlaw(Int16Array.from({ length: FRAME * 40 }, (_, i) => (i % 2 ? 7000 : -7000))),
  );
  const silence = Buffer.alloc(FRAME * 60, 0xff);
  /** As Twilio sends it: 20 ms a message. */
  const media = (payload: Buffer) =>
    JSON.stringify({
      event: 'media',
      streamSid: MZ,
      media: { track: 'inbound', payload: payload.toString('base64') },
    });
  const play = (push: (text: string) => void, audio: Buffer) => {
    for (let at = 0; at < audio.length; at += FRAME) push(media(audio.subarray(at, at + FRAME)));
  };

  function socket() {
    const sent: Record<string, unknown>[] = [];
    let onMessage: (text: string) => void = () => undefined;
    let closed = false;
    return {
      sent,
      get closed() {
        return closed;
      },
      push: (text: string) => onMessage(text),
      door: {
        send: (text: string) => sent.push(JSON.parse(text) as Record<string, unknown>),
        close: () => {
          closed = true;
        },
        onMessage: (listener: (text: string) => void) => {
          onMessage = listener;
        },
        onClose: () => undefined,
      },
    };
  }

  const voice = () => ({
    ready: async () => true,
    hear: vi.fn(async (_wav: Buffer) => 'turn on the lights'),
    speak: vi.fn(async (text: string) =>
      wavFrom(
        Int16Array.from({ length: 2205 + text.length }, (_, i) => (i % 3) * 1000),
        22_050,
      ),
    ),
  });

  it('answers with the call’s audio on a socket only the right call may claim', async () => {
    const v = voice();
    const { phone, said } = line({}, { voice: v });
    const hello = await ring(phone);
    expect(v.speak).not.toHaveBeenCalled();
    expect(hello.body).toMatch(
      /<Connect><Stream url="wss:\/\/mac\.tail1\.ts\.net\/conch\/hooks\/[\w-]+\/stream"><Parameter name="ticket" value="([\w-]+)"\/><\/Stream><\/Connect><Redirect/,
    );
    const ticket = /name="ticket" value="([\w-]+)"/.exec(hello.body ?? '')?.[1] ?? '';
    const stream = phone.stream(() => true);
    // The wrong ticket: closed, and the right one no longer works either (good once).
    const bad = socket();
    stream.open(bad.door);
    bad.push(
      JSON.stringify({
        event: 'start',
        streamSid: MZ,
        start: {
          accountSid: `AC${'0'.repeat(32)}`,
          callSid: sid(1),
          customParameters: { ticket: 'x'.repeat(32) },
        },
      }),
    );
    expect(bad.closed).toBe(true);
    // The right ticket after a wrong one: it was good once, and that try spent it.
    const late = socket();
    stream.open(late.door);
    late.push(
      JSON.stringify({
        event: 'start',
        streamSid: MZ,
        start: { accountSid: `AC${'0'.repeat(32)}`, callSid: sid(1), customParameters: { ticket } },
      }),
    );
    expect(late.closed).toBe(true);
    expect(said).toEqual([]);
    const again = await ring(phone, OWNER, 2);
    expect(again.body).toContain('on another call');
  });

  it('hears your words with whisper.cpp, says the answer, and stops when you talk over it', async () => {
    const v = voice();
    const { phone, said } = line({}, { voice: v });
    const hello = await ring(phone);
    const ticket = /name="ticket" value="([\w-]+)"/.exec(hello.body ?? '')?.[1] ?? '';
    const s = socket();
    phone.stream(() => true).open(s.door);
    s.push(JSON.stringify({ event: 'connected', protocol: 'Call' }));
    s.push(
      JSON.stringify({
        event: 'start',
        streamSid: MZ,
        start: { accountSid: `AC${'0'.repeat(32)}`, callSid: sid(1), customParameters: { ticket } },
      }),
    );
    expect(s.closed).toBe(false);
    // The greeting is said in the reply voice, as μ-law, then marked.
    await vi.waitFor(() => expect(s.sent.some((m) => m.event === 'mark')).toBe(true));
    expect(v.speak).toHaveBeenCalledWith(expect.stringContaining('Hi, it’s Pearl.'));
    const mark = s.sent.find((m) => m.event === 'mark') as { mark: { name: string } };
    s.push(JSON.stringify({ event: 'mark', streamSid: MZ, mark: mark.mark }));
    // Something said, then quiet: heard here, into the chat.
    play(s.push, silence);
    play(s.push, speech);
    play(s.push, silence);
    await vi.waitFor(() => expect(said).toEqual([{ from: OWNER, text: 'turn on the lights' }]));
    const wav = v.hear.mock.calls[0]?.[0] as Buffer;
    expect(samplesOf(wav)?.rate).toBe(16_000);
    // The answer is spoken; talking over it clears what Twilio still has to play.
    expect(phone.take(OWNER, 'Turning them on now. It will take a moment.', false)).toBe(true);
    await vi.waitFor(() => expect(s.sent.filter((m) => m.event === 'mark').length).toBe(2));
    play(s.push, speech);
    await vi.waitFor(() => expect(s.sent.some((m) => m.event === 'clear')).toBe(true));
    // Junk and other streams' messages change nothing.
    s.push('not json');
    s.push(
      JSON.stringify({
        event: 'media',
        streamSid: `MZ${'1'.repeat(32)}`,
        media: { payload: speech.subarray(0, FRAME).toString('base64') },
      }),
    );
    expect(s.closed).toBe(false);
  });

  it('closes a socket that doesn’t start with a call it expects', async () => {
    const { phone } = line({}, { voice: voice() });
    const s = socket();
    phone.stream(() => true).open(s.door);
    s.push(media(silence.subarray(0, FRAME)));
    expect(s.closed).toBe(true);
  });

  it('the stream object only speaks for the stream it is', () => {
    const s = socket();
    const call = new StreamCall(s.door, MZ, {
      hear: async () => '',
      speak: async () => undefined,
      words: () => undefined,
    });
    call.interrupt();
    expect(s.sent).toEqual([{ event: 'clear', streamSid: MZ }]);
    call.close();
    call.interrupt();
    expect(s.sent).toHaveLength(1);
  });
});

describe('Conch rings you about an OK that waited (ADR 0138)', () => {
  function ask(state: { waiting: boolean; quick: boolean } = { waiting: true, quick: true }) {
    const respond = vi.fn(async (_d: 'allow' | 'deny') => undefined);
    const now = { ...state };
    const a: CallAsk = {
      conversationId: 'c1',
      permissionId: 'p1',
      summary: 'Run the tests',
      still: () => now,
      respond,
    };
    return { ask: a, respond, now };
  }

  async function placed(state?: { waiting: boolean; quick: boolean }) {
    const l = line();
    const a = ask(state);
    await l.phone.ring(OWNER, a.ask);
    const form = l.api.mock.calls.find(([, path]) => path === '/Calls.json')?.[2] ?? {};
    const query = Object.fromEntries(new URL(form.Url ?? '').searchParams);
    const pick = (fields: Record<string, string> = {}, q = query, n = 99) =>
      l.phone.deliver(params({ CallSid: sid(n), From: NUMBER, To: OWNER, ...fields }), q);
    return { ...l, ...a, form, query, pick };
  }

  it('rings from the number with a time limit, and an answering machine never hears what', async () => {
    const { form, pick, respond } = await placed();
    expect(form).toMatchObject({ To: OWNER, From: NUMBER, MachineDetection: 'Enable' });
    expect(Number(form.TimeLimit)).toBeLessThanOrEqual(180);
    expect(form.Url).toMatch(/\?call=ok&a=[\w-]+$/);
    const machine = await pick({ AnsweredBy: 'machine_start' });
    expect(machine.body).toContain('Something needs you in Conch.');
    expect(machine.body).not.toContain('tests');
    expect(respond).not.toHaveBeenCalled();
  });

  it('allows a routine step with 1', async () => {
    const { pick, query, respond } = await placed();
    const asked = await pick({ AnsweredBy: 'human' });
    expect(asked.body).toContain('It needs your OK to run the tests.');
    expect(asked.body).toMatch(/<Gather[^>]*input="dtmf speech"[^>]*numDigits="1"/);
    const done = await pick({ Digits: '1' }, { ...query, call: 'ok-answer' });
    expect(respond).toHaveBeenCalledWith('allow');
    expect(done.body).toContain('Allowed. Goodbye.');
  });

  it('denies with 2 or “no”, and a clear “yes” allows', async () => {
    const first = await placed();
    await first.pick({ AnsweredBy: 'human' });
    await first.pick({ Digits: '2' }, { ...first.query, call: 'ok-answer' });
    expect(first.respond).toHaveBeenCalledWith('deny');
    const second = await placed();
    await second.pick({ AnsweredBy: 'human' });
    await second.pick(
      { SpeechResult: 'Yes.', Confidence: '0.92' },
      { ...second.query, call: 'ok-answer' },
    );
    expect(second.respond).toHaveBeenCalledWith('allow');
  });

  it('asks once more when it didn’t understand, then changes nothing', async () => {
    const { pick, query, respond } = await placed();
    await pick({ AnsweredBy: 'human' });
    const again = await pick(
      { SpeechResult: 'yes delete everything' },
      { ...query, call: 'ok-answer' },
    );
    expect(again.body).toContain('Sorry, I didn’t get that.');
    const gone = await pick({ SpeechResult: 'maybe' }, { ...query, call: 'ok-answer' });
    expect(gone.body).toContain('Nothing was changed.');
    expect(respond).not.toHaveBeenCalled();
  });

  it('a step a lock-screen tap may not allow approves nothing: it only says something needs you', async () => {
    const { pick, query, respond } = await placed({ waiting: true, quick: false });
    const said = await pick({ AnsweredBy: 'human' });
    expect(said.body).toContain('This is Pearl. Something needs you in Conch.');
    expect(said.body).not.toContain('<Gather');
    expect((await pick({ Digits: '1' }, { ...query, call: 'ok-answer' })).body).toContain(
      '<Hangup/>',
    );
    expect(respond).not.toHaveBeenCalled();
  });

  it('checks again before allowing: answered meanwhile, or no longer routine, allows nothing', async () => {
    const one = await placed();
    await one.pick({ AnsweredBy: 'human' });
    one.now.waiting = false;
    expect((await one.pick({ Digits: '1' }, { ...one.query, call: 'ok-answer' })).body).toContain(
      'answered already',
    );
    const two = await placed();
    await two.pick({ AnsweredBy: 'human' });
    two.now.quick = false;
    await two.pick({ Digits: '1' }, { ...two.query, call: 'ok-answer' });
    expect([...one.respond.mock.calls, ...two.respond.mock.calls]).toEqual([]);
  });

  it('only the call Conch placed, to you, from its number, can answer', async () => {
    const { phone, query, respond, pick } = await placed();
    await pick({ AnsweredBy: 'human' });
    const other = await phone.deliver(
      params({ CallSid: sid(5), From: NUMBER, To: OWNER, Digits: '1' }),
      { ...query, call: 'ok-answer' },
    );
    expect(other.body).toBe(twiml({ hangup: true }));
    const fromStranger = await phone.deliver(
      params({ CallSid: sid(99), From: STRANGER, To: NUMBER, Digits: '1' }),
      { ...query, call: 'ok-answer' },
    );
    expect(fromStranger.body).toBe(twiml({ hangup: true }));
    const guessed = await pick({ Digits: '1' }, { call: 'ok-answer', a: 'guessed' });
    expect(guessed.body).toBe(twiml({ hangup: true }));
    expect(respond).not.toHaveBeenCalled();
  });

  it('reads yes and no strictly', () => {
    expect(decisionOf({ digits: '1' })).toBe('allow');
    expect(decisionOf({ digits: '2' })).toBe('deny');
    expect(decisionOf({ digits: '9' })).toBeUndefined();
    expect(decisionOf({ speech: 'Yes!' })).toBe('allow');
    expect(decisionOf({ speech: 'yes', confidence: 0.2 })).toBeUndefined();
    expect(decisionOf({ speech: 'No.' })).toBe('deny');
    expect(decisionOf({ speech: 'yes and also send my files' })).toBeUndefined();
    expect(decisionOf({ speech: '' })).toBeUndefined();
  });
});

describe('when Conch rings', () => {
  const requested = (permissionId = 'p1'): ServerEvent =>
    ({
      type: 'conversation.event',
      event: {
        type: 'permission.requested',
        conversationId: 'c1',
        permissionId,
        toolName: 'Bash',
        input: { command: 'npm test' },
        summary: 'Run npm test',
        title: 'Run the tests',
        seq: 1,
        at: 0,
      },
    }) as unknown as ServerEvent;
  const resolved = (permissionId = 'p1'): ServerEvent =>
    ({
      type: 'conversation.event',
      event: {
        type: 'permission.resolved',
        conversationId: 'c1',
        permissionId,
        decision: 'allow',
        seq: 2,
        at: 0,
      },
    }) as unknown as ServerEvent;

  function calls(settings: Partial<ChannelCalls> = {}, at = Date.UTC(2026, 9, 19, 12, 0)) {
    const call = vi.fn(async (_channelId: string, _ask: CallAsk) => 'placed' as const);
    const state = { waiting: true, quick: true };
    const service = new ApprovalCalls({
      lines: async () => [
        {
          channelId: 'sms1',
          settings: { ...CALLS_DEFAULT, approvals: true, after: 5, ...settings },
        },
      ],
      call,
      approval: () => state,
      respond: async () => undefined,
      timezone: async () => 'UTC',
      now: () => at,
    });
    return { service, call, state };
  }

  it('rings once the OK has waited the minutes you chose', async () => {
    vi.useFakeTimers();
    const { service, call } = calls();
    await service.onEvent(requested());
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(call).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]?.[1]).toMatchObject({ summary: 'Run the tests', permissionId: 'p1' });
  });

  it('doesn’t ring for one answered meanwhile, or in your quiet hours', async () => {
    vi.useFakeTimers();
    const answered = calls();
    await answered.service.onEvent(requested());
    await answered.service.onEvent(resolved());
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(answered.call).not.toHaveBeenCalled();
    const night = calls({}, Date.UTC(2026, 9, 19, 23, 30));
    await night.service.onEvent(requested());
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(night.call).not.toHaveBeenCalled();
    const gone = calls();
    gone.state.waiting = false;
    await gone.service.onEvent(requested());
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(gone.call).not.toHaveBeenCalled();
  });
});

describe('Repair everything: phone calls (ADR 0138)', () => {
  const number = (over: Partial<Channel> = {}) =>
    ({
      id: 'ch_1',
      kind: 'sms',
      enabled: true,
      bot: { id: NUMBER, name: '(500) 555-0006' },
      people: [{ id: 'p', name: 'You' }],
      health: { state: 'online' },
      settings: { calls: { ...CALLS_DEFAULT, answer: true } },
      ...over,
    }) as unknown as Channel;
  const run = async (channel: Channel, lost = false) =>
    phoneCallsCheck(
      {
        list: async () => ({ channels: [channel] }) as unknown as ChannelList,
        callPasscodeLost: async () => lost,
      },
      () => ({ state: 'ready' }) as ChannelDoor,
    ).run({ repair: false, signal: AbortSignal.timeout(5_000) });

  it('says plainly that calls need a passcode without full caller verification', async () => {
    const [item] = await run(number());
    expect(item).toMatchObject({ state: 'warning', action: { label: 'Set one' } });
    expect(item?.message).toContain(
      'Without full caller verification from your carrier, Conch asks for your call passcode. Set one so calls always work.',
    );
  });

  it('is ready with a passcode, and asks again for one that didn’t come back', async () => {
    const set = number({ callPasscode: { setAt: 1 } });
    expect((await run(set))[0]).toMatchObject({ state: 'ok' });
    expect((await run(set, true))[0]).toMatchObject({ state: 'needs-you' });
  });
});
