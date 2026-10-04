/**
 * Reading answers aloud (ADR 0027, ADR 0077), with one of two kinds of voice:
 *
 * - **One of Conch's** (`piper:…` a natural voice on the computer Conch runs
 *   on, `openai:…` a connected provider's): a sentence or two at a time from
 *   `/api/voice/speak`, the next one fetched while this one plays, played
 *   through the page's own audio, so the microphone's echo cancellation
 *   hears it too (talk mode's barge-in). If it can't speak, the rest is read
 *   with the device's voice instead, and the page is told once.
 * - **The device's own** (`speechSynthesis`): nothing sent anywhere.
 */
import { isConchVoice, sentences, speakable } from '@conch/protocol';

import { voiceApi } from './api';

export { sentences, speakable };

/** Whether this device can read aloud with `voice` (its own voices, or Conch's). */
export function canSpeak(voice?: string): boolean {
  if (typeof window === 'undefined') return false;
  if (isConchVoice(voice)) return 'AudioContext' in window;
  return 'speechSynthesis' in window;
}

/** The best voice for a language: the device's natural/enhanced ones first. */
export function bestVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
  chosen?: string,
): SpeechSynthesisVoice | undefined {
  if (chosen) {
    const picked = voices.find((v) => v.voiceURI === chosen);
    if (picked) return picked;
  }
  const base = lang.split('-')[0]?.toLowerCase() ?? 'en';
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const score = (v: SpeechSynthesisVoice) =>
    (/premium|enhanced|natural|neural/i.test(v.name) ? 4 : 0) +
    (v.lang.toLowerCase() === lang.toLowerCase() ? 2 : 0) +
    (v.localService ? 1 : 0) +
    (v.default ? 0.5 : 0);
  return [...matching].sort((a, b) => score(b) - score(a))[0] ?? voices.find((v) => v.default);
}

export interface Speaker {
  /** Say it; resolves when it's all been said (or it was stopped). */
  say(text: string): Promise<void>;
  stop(): void;
  speaking(): boolean;
}

export interface SpeakerOptions {
  lang: string;
  /** A device voice's `voiceURI`, or one of Conch's (`piper:…`, `openai:…`). */
  voice?: string;
  rate?: number;
  /** Conch's voice couldn't speak, so the device's did: why, in a sentence. */
  onFallback?: (message: string) => void;
}

const active = new Set<Speaker>();

/** One voice at a time across the page: stop whatever is speaking. */
export function hush(): void {
  for (const speaker of [...active]) speaker.stop();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) speechSynthesis.cancel();
}

/** Sentences gathered into pieces of about `size` characters: fewer requests, no cut words. */
export function pieces(parts: string[], size: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const part of parts) {
    if (current && current.length + part.length + 1 > size) {
      out.push(current);
      current = part;
    } else current = current ? `${current} ${part}` : part;
  }
  if (current) out.push(current);
  return out;
}

export function createSpeaker(options: SpeakerOptions): Speaker {
  return isConchVoice(options.voice) && canSpeak(options.voice)
    ? conchSpeaker(options)
    : deviceSpeaker(options);
}

function deviceSpeaker(options: SpeakerOptions): Speaker {
  let stopped = false;
  const speaker: Speaker = {
    async say(text) {
      if (!canSpeak()) return;
      stopped = false;
      active.add(speaker);
      try {
        const voices = speechSynthesis.getVoices();
        const voice = bestVoice(
          voices,
          options.lang,
          isConchVoice(options.voice) ? undefined : options.voice,
        );
        for (const sentence of sentences(speakable(text))) {
          if (stopped) return;
          await new Promise<void>((resolve) => {
            const u = new SpeechSynthesisUtterance(sentence);
            if (voice) u.voice = voice;
            u.lang = voice?.lang ?? options.lang;
            u.rate = options.rate ?? 1;
            u.onend = () => resolve();
            u.onerror = () => resolve();
            speechSynthesis.speak(u);
          });
        }
      } finally {
        active.delete(speaker);
      }
    },
    stop() {
      stopped = true;
      if (canSpeak()) speechSynthesis.cancel();
    },
    speaking: () => canSpeak() && speechSynthesis.speaking,
  };
  return speaker;
}

let shared: AudioContext | undefined;
/** One audio output for the page, woken by the press that asked it to speak. */
function audioContext(): AudioContext {
  shared ??= new AudioContext();
  return shared;
}

function conchSpeaker(options: SpeakerOptions): Speaker {
  const voice = options.voice ?? '';
  let stopped = false;
  let playing = false;
  let source: AudioBufferSourceNode | undefined;
  let controller: AbortController | undefined;
  let fallback: Speaker | undefined;
  const speaker: Speaker = {
    async say(text) {
      stopped = false;
      fallback = undefined;
      active.add(speaker);
      const parts = pieces(sentences(speakable(text)), 240);
      controller = new AbortController();
      const signal = controller.signal;
      const fetchPart = (i: number) => {
        const part = parts[i];
        if (part === undefined) return undefined;
        const wav = voiceApi.speak(part, voice, options.rate ?? 1, signal);
        wav.catch(() => undefined);
        return wav;
      };
      let next = fetchPart(0);
      try {
        for (let i = 0; i < parts.length; i++) {
          if (stopped) return;
          let wav: ArrayBuffer;
          try {
            wav = await (next ?? Promise.reject(new Error('Nothing to say.')));
          } catch (error) {
            if (stopped) return;
            // Conch's voice couldn't: the device's reads the rest.
            options.onFallback?.(
              error instanceof Error ? error.message : 'That voice couldn’t speak just now.',
            );
            fallback = deviceSpeaker({ ...options, voice: undefined });
            await fallback.say(parts.slice(i).join(' '));
            return;
          }
          // The next piece is fetched while this one plays.
          next = fetchPart(i + 1);
          const context = audioContext();
          if (context.state === 'suspended') await context.resume().catch(() => undefined);
          const buffer = await context.decodeAudioData(wav);
          if (stopped) return;
          await new Promise<void>((resolve) => {
            const node = context.createBufferSource();
            node.buffer = buffer;
            node.connect(context.destination);
            node.onended = () => resolve();
            source = node;
            playing = true;
            node.start();
          });
          playing = false;
        }
      } finally {
        playing = false;
        source = undefined;
        active.delete(speaker);
      }
    },
    stop() {
      stopped = true;
      controller?.abort();
      try {
        source?.stop();
      } catch {
        // Already ended.
      }
      fallback?.stop();
      playing = false;
    },
    speaking: () => playing || Boolean(fallback?.speaking()),
  };
  return speaker;
}
