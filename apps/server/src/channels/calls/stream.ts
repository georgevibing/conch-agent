/**
 * A call's audio over Twilio's Media Streams (ADR 0138): the caller's voice
 * comes in as 8 kHz μ-law, 20 ms a message, and Conch's answers go back the
 * same way. Hearing is whisper.cpp on this computer and speaking is the
 * reply voice (Piper), so what's said on the call is turned into words here,
 * not by a service.
 *
 * - **Turns.** A few loud frames start the caller's words and 800 ms of quiet
 *   ends them; the words go to the chat as one message.
 * - **Barge-in.** Speaking while Conch speaks (clearly louder than the line,
 *   for a little while) stops it at once (`clear`), and what was said is
 *   heard as the next message. Any key stops it too.
 * - **Bounded.** One utterance is 30 seconds at most, at most one is heard at
 *   a time, and a reply is spoken a few sentences at a time.
 */
import { sentences, speakable, type TwilioStreamMessage } from '@conch/protocol';

import { groups } from '../../voice/speech';
import { SpeechDetector, decodeUlaw, encodeUlaw, resample, samplesOf, wavFrom } from './audio';

/** 20 ms at 8 kHz. */
export const FRAME = 160;
/** Frames kept from before the words started, so their first sound isn't cut. */
const PREROLL = 12;
/** The longest one utterance may be (30 s). */
const MAX_FRAMES = 1_500;
/** Shorter than this (200 ms of speech) is a cough, not words. */
const MIN_SPEECH = 10;
/** μ-law bytes per media message going out (half a second). */
const OUT_CHUNK = 4_000;
/** What a spoken reply is cut to: the rest is in Conch. */
export const MAX_SPOKEN_CHARS = 900;

export interface StreamSocket {
  send(text: string): void;
  close(): void;
}

export interface StreamDeps {
  /** The words in a 16 kHz mono WAV (whisper.cpp). */
  hear(wav: Buffer): Promise<string>;
  /** A sentence or two as a WAV, in the reply voice; undefined when it can't speak. */
  speak(text: string): Promise<Buffer | undefined>;
  /** The caller said this. */
  words(text: string): void;
  log?(message: string): void;
}

export class StreamCall {
  readonly #detector = new SpeechDetector();
  #preroll: Int16Array[] = [];
  #captured: Int16Array[] | undefined;
  #speechFrames = 0;
  #carry = new Int16Array(0);
  /** Marks sent and not yet played. */
  #playing = new Set<string>();
  #marks = 0;
  /** Bumped by a barge-in: speech made for an older generation isn't sent. */
  #generation = 0;
  #speaking: Promise<void> = Promise.resolve();
  #synthesizing = 0;
  #hearing: Promise<void> = Promise.resolve();
  #closed = false;
  #afterPlayed: (() => void)[] = [];

  constructor(
    private readonly socket: StreamSocket,
    readonly streamSid: string,
    private readonly deps: StreamDeps,
  ) {}

  /** Conch is saying something (or about to). */
  get speaking(): boolean {
    return this.#playing.size > 0 || this.#synthesizing > 0;
  }

  /** One message from Twilio, already checked. */
  receive(message: TwilioStreamMessage): void {
    if (this.#closed) return;
    if (message.event === 'media') {
      if (message.media.track && message.media.track !== 'inbound') return;
      this.#audio(Buffer.from(message.media.payload, 'base64'));
    } else if (message.event === 'mark') {
      this.#playing.delete(message.mark.name);
      if (!this.#playing.size) this.#drained();
    } else if (message.event === 'dtmf') {
      // A key while Conch talks: stop talking.
      if (this.speaking) this.interrupt();
    } else if (message.event === 'stop') this.close();
  }

  #audio(bytes: Buffer) {
    const incoming = decodeUlaw(bytes);
    const all = new Int16Array(this.#carry.length + incoming.length);
    all.set(this.#carry);
    all.set(incoming, this.#carry.length);
    let at = 0;
    for (; at + FRAME <= all.length; at += FRAME) this.#frame(all.slice(at, at + FRAME));
    this.#carry = all.slice(at);
  }

  #frame(frame: Int16Array) {
    const strict = this.speaking;
    const seen = this.#detector.frame(frame, strict);
    if (!this.#captured) {
      this.#preroll.push(frame);
      if (this.#preroll.length > PREROLL) this.#preroll.shift();
      if (!seen.started) return;
      // Words over Conch's own: it stops and listens.
      if (strict) this.interrupt();
      this.#captured = [...this.#preroll];
      this.#preroll = [];
      this.#speechFrames = 0;
      return;
    }
    this.#captured.push(frame);
    if (seen.speech) this.#speechFrames++;
    if (seen.ended || this.#captured.length >= MAX_FRAMES) this.#finish();
  }

  #finish() {
    const frames = this.#captured ?? [];
    this.#captured = undefined;
    this.#detector.reset();
    if (this.#speechFrames < MIN_SPEECH) return;
    const samples = new Int16Array(frames.length * FRAME);
    frames.forEach((f, i) => samples.set(f, i * FRAME));
    const wav = wavFrom(resample(samples, 8_000, 16_000), 16_000);
    // One at a time: the next waits for this one's words.
    this.#hearing = this.#hearing.then(async () => {
      if (this.#closed) return;
      try {
        const text = (await this.deps.hear(wav)).trim();
        if (text.replace(/[^\p{L}\p{N}]/gu, '').length >= 2 && !this.#closed) this.deps.words(text);
      } catch (error) {
        this.deps.log?.(`call: couldn’t hear that (${(error as Error).message})`);
      }
    });
  }

  /** Stop speaking now: what's queued at Twilio is dropped, and what's being made too. */
  interrupt(): void {
    this.#generation++;
    this.#playing.clear();
    this.#send({ event: 'clear', streamSid: this.streamSid });
    this.#drained();
  }

  /**
   * Say an answer (Markdown is read as plain words), a few sentences at a
   * time, after whatever is being said. Resolves once it's all sent.
   */
  say(markdown: string): Promise<void> {
    const generation = this.#generation;
    let text = speakable(markdown);
    if (text.length > MAX_SPOKEN_CHARS) {
      const kept: string[] = [];
      for (const s of sentences(text)) {
        if (kept.join(' ').length + s.length > MAX_SPOKEN_CHARS) break;
        kept.push(s);
      }
      text = `${kept.join(' ')} The rest is in Conch.`;
    }
    if (!text.trim()) return Promise.resolve();
    this.#synthesizing++;
    const next = this.#speaking.then(async () => {
      try {
        for (const chunk of groups(sentences(text), 300)) {
          if (this.#closed || generation !== this.#generation) return;
          const wav = await this.deps.speak(chunk).catch((error: unknown) => {
            this.deps.log?.(`call: couldn’t speak (${(error as Error).message})`);
            return undefined;
          });
          const audio = wav && samplesOf(wav);
          if (!audio || this.#closed || generation !== this.#generation) continue;
          this.#play(encodeUlaw(resample(audio.samples, audio.rate, 8_000)));
        }
      } finally {
        this.#synthesizing = Math.max(0, this.#synthesizing - 1);
        if (!this.speaking) this.#drained();
      }
    });
    this.#speaking = next;
    return next;
  }

  /** Resolves once everything said so far has been played (or interrupted). */
  played(): Promise<void> {
    if (!this.speaking) return Promise.resolve();
    return new Promise((resolve) => this.#afterPlayed.push(resolve));
  }

  #play(ulaw: Buffer) {
    for (let at = 0; at < ulaw.length; at += OUT_CHUNK)
      this.#send({
        event: 'media',
        streamSid: this.streamSid,
        media: { payload: ulaw.subarray(at, at + OUT_CHUNK).toString('base64') },
      });
    const name = `said-${++this.#marks}`;
    this.#playing.add(name);
    this.#send({ event: 'mark', streamSid: this.streamSid, mark: { name } });
  }

  #drained() {
    if (this.speaking) return;
    const waiting = this.#afterPlayed;
    this.#afterPlayed = [];
    for (const resolve of waiting) resolve();
  }

  #send(message: unknown) {
    if (this.#closed) return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      this.close();
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#playing.clear();
    this.#synthesizing = 0;
    this.#drained();
    try {
      this.socket.close();
    } catch {
      // Already gone.
    }
  }

  get closed(): boolean {
    return this.#closed;
  }
}
