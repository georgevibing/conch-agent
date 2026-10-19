/**
 * Phone calls on the SMS number (ADR 0138).
 *
 * The Twilio number Conch already texts from (ADR 0076) can take a call from
 * you and talk it through, hands-free, and can ring you when an OK has been
 * waiting. Both are off until you turn them on, on the channel's page.
 *
 * - `ChannelCalls` is what you chose (never the assistant's: no tool changes it);
 * - `ChannelCallUsage` is what calls used today, shown beside the switches;
 * - `SetCallPasscodeBody` sets the call passcode: the keys a caller enters
 *   when the carrier can't vouch for the caller ID. Only a slow hash of it
 *   is kept, on the gateway, and it's never sent back;
 * - `TwilioStreamMessage` is what Twilio's Media Streams send over the call's
 *   WebSocket, validated before anything is done with it.
 */
import { z } from 'zod';

import { QUIET_HOURS_DEFAULT, QuietHours } from './checkins';

/** The longest a call may last, in minutes, as offered. */
export const CALL_MINUTES = [5, 10, 20, 30] as const;
/** Calls Conch may place in a day, as offered. */
export const CALLS_PER_DAY = [1, 3, 5, 10] as const;
/** How long an OK waits before Conch rings, in minutes, as offered. */
export const CALL_AFTER = [2, 5, 10, 15] as const;

export const ChannelCalls = z.object({
  /**
   * Answer when you call the number: your assistant, by voice. Only your own
   * number gets it; anyone else hears one sentence and the call ends.
   */
  answer: z.boolean().default(false),
  /**
   * Ring you when an OK has waited `after` minutes and nobody answered it.
   * A step a lock-screen tap may allow can be allowed with 1 or “yes”;
   * anything else only says that something needs you in Conch.
   */
  approvals: z.boolean().default(false),
  after: z.number().int().min(1).max(60).default(5),
  /** No calls from Conch between these times (this computer's clock). Your calls are still answered. */
  quiet: QuietHours.default(QUIET_HOURS_DEFAULT),
  /** Calls Conch places in a day, at most. */
  perDay: z.number().int().min(1).max(10).default(3),
  /** The longest any call lasts, either way, in minutes. */
  maxMinutes: z.number().int().min(1).max(30).default(10),
});
export type ChannelCalls = z.infer<typeof ChannelCalls>;

export const CALLS_DEFAULT: ChannelCalls = ChannelCalls.parse({});

/** What calls used today, on this computer's clock. */
export const ChannelCallUsage = z.object({
  /** `2026-10-19`. */
  day: z.string().max(10),
  /** Calls Conch placed (an OK waiting). */
  placed: z.number().int().nonnegative().default(0),
  /** Calls you made to it that it answered. */
  answered: z.number().int().nonnegative().default(0),
  /** Seconds on the phone, both ways. */
  seconds: z.number().int().nonnegative().default(0),
  /** Wrong call passcodes entered today: at `CALL_PASSCODE.lockAfter`, no more tries until tomorrow. */
  passcodeFails: z.number().int().nonnegative().default(0),
});
export type ChannelCallUsage = z.infer<typeof ChannelCallUsage>;

/** "2 calls today, 7 minutes": what the page says beside the switches. */
export function callUsageWords(usage: ChannelCallUsage | undefined, today: string): string {
  if (!usage || usage.day !== today || (!usage.placed && !usage.answered)) return 'No calls today.';
  const calls = usage.placed + usage.answered;
  const minutes = Math.ceil(usage.seconds / 60);
  return `${calls === 1 ? 'One call' : `${calls} calls`} today, ${minutes === 1 ? 'a minute' : `${minutes} minutes`}.`;
}

// ── The call passcode ───────────────────────────────────────────────────────

/**
 * A call from your number gets your assistant only when the carrier fully
 * vouches for the caller ID (SHAKEN/STIR attestation A,
 * `TN-Validation-Passed-A`), or once the caller keys in this passcode.
 * `tries` wrong ones end a call; `lockAfter` wrong ones in a day stop every
 * try until tomorrow, and you're told.
 */
export const CALL_PASSCODE = { min: 6, max: 12, tries: 3, lockAfter: 5 } as const;

/** The carrier's verdict that vouches for the caller ID by itself. */
export const FULL_ATTESTATION = 'TN-Validation-Passed-A';

/**
 * What's wrong with a passcode, in plain words, or undefined when it's fine:
 * digits only, 6 to 12 of them, and not one anyone would try first (a digit
 * over and over, or a run like 123456).
 */
export function callPasscodeProblem(passcode: string): string | undefined {
  const { min, max } = CALL_PASSCODE;
  if (!/^\d*$/.test(passcode)) return 'Use digits only: it’s entered on a phone’s keypad.';
  if (passcode.length < min || passcode.length > max) return `Use ${min} to ${max} digits.`;
  if (/^(\d)\1+$/.test(passcode)) return 'That’s one digit over and over: anyone would try it.';
  const steps = new Set(
    [...passcode].slice(1).map((d, i) => (Number(d) - Number(passcode[i]) + 10) % 10),
  );
  if (steps.size === 1 && (steps.has(1) || steps.has(9)))
    return 'That’s a run of digits: anyone would try it.';
  return undefined;
}

/** `PUT /api/channels/:id/call-passcode`: a new passcode (it replaces the old one). */
export const SetCallPasscodeBody = z.object({
  passcode: z
    .string()
    .max(CALL_PASSCODE.max)
    .superRefine((value, ctx) => {
      const problem = callPasscodeProblem(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    }),
});
export type SetCallPasscodeBody = z.infer<typeof SetCallPasscodeBody>;

// ── Twilio Media Streams (the call's audio, both ways) ──────────────────────

const sid = z.string().regex(/^[A-Z]{2}[0-9a-f]{32}$/);
const seq = z.string().max(20).optional();

/** One message Twilio sends over a call's WebSocket. Anything else is dropped. */
export const TwilioStreamMessage = z.discriminatedUnion('event', [
  z.object({ event: z.literal('connected'), protocol: z.string().max(40).optional() }),
  z.object({
    event: z.literal('start'),
    sequenceNumber: seq,
    streamSid: sid,
    start: z.object({
      accountSid: sid,
      callSid: sid,
      streamSid: sid.optional(),
      tracks: z.array(z.string().max(20)).max(4).optional(),
      mediaFormat: z
        .object({
          encoding: z.string().max(40),
          sampleRate: z.number().int(),
          channels: z.number().int(),
        })
        .optional(),
      customParameters: z.record(z.string().max(40), z.string().max(200)).optional(),
    }),
  }),
  z.object({
    event: z.literal('media'),
    sequenceNumber: seq,
    streamSid: sid,
    media: z.object({
      track: z.string().max(20).optional(),
      chunk: z.string().max(20).optional(),
      timestamp: z.string().max(20).optional(),
      // 20 ms of 8 kHz μ-law is 160 bytes; a little room for bigger chunks.
      payload: z.string().max(8_000),
    }),
  }),
  z.object({
    event: z.literal('dtmf'),
    sequenceNumber: seq,
    streamSid: sid,
    dtmf: z.object({ track: z.string().max(20).optional(), digit: z.string().max(2) }),
  }),
  z.object({
    event: z.literal('mark'),
    sequenceNumber: seq,
    streamSid: sid,
    mark: z.object({ name: z.string().max(60) }),
  }),
  z.object({ event: z.literal('stop'), sequenceNumber: seq, streamSid: sid.optional() }),
]);
export type TwilioStreamMessage = z.infer<typeof TwilioStreamMessage>;
