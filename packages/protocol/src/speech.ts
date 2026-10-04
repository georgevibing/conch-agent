/**
 * Conch's voices (ADR 0077): natural voices that run on the computer Conch
 * runs on (Piper), and the voices of a provider you connected (OpenAI's),
 * besides the device's own (`speechSynthesis`, ADR 0027). And how an answer
 * sounds, the same in the browser and in a voice note.
 */
import { z } from 'zod';

/** A voice Conch speaks with: `piper:<voice>` on this computer, `openai:<voice>` from OpenAI. */
export const ConchVoiceId = z.string().regex(/^(?:piper|openai):[A-Za-z0-9_-]{1,64}$/);
export type ConchVoiceId = z.infer<typeof ConchVoiceId>;

/** It's one of Conch's voices, not one of the device's. */
export const isConchVoice = (voice: string | undefined): voice is ConchVoiceId =>
  voice !== undefined && ConchVoiceId.safeParse(voice).success;

/** A natural voice that runs on this computer, and whether it's here. */
export const NaturalVoice = z.object({
  /** `piper:en_US-lessac-medium` */
  id: ConchVoiceId,
  /** "Lessac" */
  name: z.string(),
  /** BCP-47: "en-US". */
  lang: z.string(),
  /** In its own words: "American English", "Ελληνικά". */
  language: z.string(),
  bytes: z.number(),
  state: z.enum(['ready', 'missing', 'downloading']),
  done: z.number().optional(),
  total: z.number().optional(),
  /** Why the last download stopped, in a sentence. */
  problem: z.string().optional(),
});
export type NaturalVoice = z.infer<typeof NaturalVoice>;

/** A voice from a provider you connected: what's read aloud goes to that provider. */
export const CloudVoice = z.object({
  id: ConchVoiceId,
  name: z.string(),
  /** "OpenAI" */
  provider: z.string(),
});
export type CloudVoice = z.infer<typeof CloudVoice>;

export const SpeechStatus = z.object({
  /** Piper itself (the `piper` need). */
  piper: z.enum(['missing', 'ready']),
  voices: z.array(NaturalVoice),
  /** Only voices of providers you connected. */
  cloud: z.array(CloudVoice),
  /** The voice voice notes are answered with, when one is ready. */
  reply: ConchVoiceId.optional(),
});
export type SpeechStatus = z.infer<typeof SpeechStatus>;

/** `POST /api/voice/speak`: a sentence or two in, a WAV out. */
export const SpeakBody = z.object({
  text: z.string().trim().min(1).max(2000),
  voice: ConchVoiceId,
  /** 1 is the voice's own pace. */
  rate: z.number().min(0.5).max(2).default(1),
});
export type SpeakBody = z.infer<typeof SpeakBody>;

/** Markdown as it sounds: no symbols, no code read out character by character. */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (I’ve put the code on screen.) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/\|/g, ', ')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sentences, so speech can start before a long answer is all there, and stop between them. */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?…]+(?:[.!?…]+["”’)]*|$)/g) ?? [text])
    .map((s) => s.trim())
    .filter(Boolean);
}
