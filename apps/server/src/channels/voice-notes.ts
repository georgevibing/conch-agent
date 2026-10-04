/**
 * Voice notes in chat apps (ADR 0077). Someone records one in Telegram,
 * WhatsApp, Signal, Discord, Slack, Matrix, iMessage or WeChat; Conch turns it
 * into words on this computer (whisper.cpp, through `VoiceService`), and the
 * assistant reads the words like anything typed. The recording stays with
 * the message in Conch, with its words.
 *
 * When Conch can't hear yet, nothing is lost and nobody is left wondering:
 *
 * - the note waits, kept with the channel (and its recording kept), and goes
 *   to the assistant by itself, in order, the moment Conch can hear;
 * - the speech model missing is fixed on the spot (it's fetched again), and
 *   the sender hears "give me a minute";
 * - a program missing (whisper.cpp, FFmpeg) is a need the person installs with
 *   one press on the channel's page (ADR 0016); the sender is told once.
 */
import { z } from 'zod';

import { Id } from '@conch/protocol';

import type { Hearing } from '../voice/service';
import type { ChannelFile } from './types';

/** What a channel needs from Conch's ears (`VoiceService`). */
export interface VoiceNotes {
  hearing(wav?: boolean): Promise<Hearing>;
  transcribeNote(
    bytes: Uint8Array,
    language?: string,
  ): Promise<{ text: string; cut: boolean; seconds: number }>;
  /** Fetch the speech model (again); answers at once. */
  getModel(): Promise<unknown>;
}

/** A message with a voice note Conch couldn't hear yet, waiting with its channel. */
export const WaitingNote = z.object({
  /** Who sent it (their id in the app) and where to answer. */
  person: z.string().max(200),
  /** Where it was said: their own chat, or their seat in a group (ADR 0075). */
  seat: z
    .object({
      key: z.string().max(400),
      name: z.string().max(200),
      group: z
        .object({ id: z.string().max(200), name: z.string().max(200), owner: z.boolean() })
        .optional(),
    })
    .optional(),
  chatId: z.string().max(500),
  messageId: z.string().max(500),
  /** What they typed with it, if anything. */
  text: z.string().max(100_000).default(''),
  /** Everything sent with it, saved in Conch (held until it goes). */
  attachments: z.array(Id).max(20),
  /** Which of those are voice notes to hear first. */
  voice: z.array(Id).max(20),
  outside: z.string().max(300).optional(),
  at: z.number(),
});
export type WaitingNote = z.infer<typeof WaitingNote>;

/** At most this many wait per channel; the oldest goes first when more arrive. */
export const MAX_WAITING = 30;
/** A voice note waits at most a week; then it's let go, recording and all. */
export const WAITING_MS = 7 * 24 * 60 * 60_000;
/** Voice notes heard at once: per person, and in all. */
export const PER_PERSON = 3;
export const IN_ALL = 8;

/** The app says it's a voice note someone recorded. */
export const isVoiceNote = (file: ChannelFile) => file.voice === true;

/** A 16 kHz mono WAV needs no FFmpeg. */
export function isWav(bytes: Uint8Array): boolean {
  return (
    bytes.length > 44 &&
    Buffer.from(bytes.buffer, bytes.byteOffset, 12).toString('ascii', 0, 4) === 'RIFF' &&
    Buffer.from(bytes.buffer, bytes.byteOffset, 12).toString('ascii', 8, 12) === 'WAVE'
  );
}

/** The message the assistant reads: what they typed, then what they said. */
export function withWords(typed: string, words: string[]): string {
  return [typed.trim(), ...words.map((w) => w.trim())].filter(Boolean).join('\n\n');
}

/** What the sender is told, once, while their voice note waits. */
export function waitWords(hearing: Exclude<Hearing, { ready: true }>): string {
  if ('model' in hearing)
    return 'Got your voice note. I’m getting ready to listen on your computer, so give me a minute.';
  return 'Got your voice note, but I can’t listen to voice notes on your computer yet. Open Conch and turn them on there, and I’ll answer this one then. Or type it for me.';
}

export const UNCLEAR = 'I couldn’t make out that voice note. Could you say it again, or type it?';

export const LONG = 'That was a long one, so I listened to the first ten minutes.';

export const BUSY =
  'I’m still listening to your other voice notes. Send this one again in a moment.';
