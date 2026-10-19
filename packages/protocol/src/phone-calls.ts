/**
 * Phone calls on the SMS number (ADR 0138).
 *
 * The Twilio number Conch already texts from (ADR 0076) can take a call from
 * you and talk it through, hands-free, and can ring you when an OK has been
 * waiting. Both are off until you turn them on, on the channel's page.
 *
 * - `ChannelCalls` is what you chose (never the assistant's: no tool changes it);
 * - `ChannelCallUsage` is what calls used today, shown beside the switches;
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
});
export type ChannelCallUsage = z.infer<typeof ChannelCallUsage>;

/** "2 calls today, 7 minutes": what the page says beside the switches. */
export function callUsageWords(usage: ChannelCallUsage | undefined, today: string): string {
  if (!usage || usage.day !== today || (!usage.placed && !usage.answered)) return 'No calls today.';
  const calls = usage.placed + usage.answered;
  const minutes = Math.ceil(usage.seconds / 60);
  return `${calls === 1 ? 'One call' : `${calls} calls`} today, ${minutes === 1 ? 'a minute' : `${minutes} minutes`}.`;
}

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
