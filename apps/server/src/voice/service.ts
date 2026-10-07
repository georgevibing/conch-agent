/**
 * Private dictation (ADR 0027) and voice notes (ADR 0077): whisper.cpp turns
 * what you say into text on this computer, so your voice never leaves it.
 *
 * - **Dictation.** The page records, makes it a 16 kHz mono WAV, and sends it
 *   here; whisper.cpp reads it and the words come back.
 * - **Voice notes** from chat apps arrive as Opus, AAC or AMR: FFmpeg (a need)
 *   makes them the WAV whisper.cpp reads first (`audio.ts`).
 *
 * Nothing is kept: each recording is deleted the moment it's read.
 *
 * Getting it is one press: whisper.cpp through the computer's package manager
 * (a need, ADR 0016), then its speech model (about 150 MB) from Hugging Face,
 * with progress, carrying on where it stopped, and checked against the
 * SHA-256 Hugging Face publishes for it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { DoctorItem, VoiceStatus } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import { run } from '../lib/proc';
import { AudioError, toWav16k, wavSeconds, type Exec, type Pipe } from './audio';

/** The model: multilingual, small enough for any computer, good enough for dictation. */
export const MODEL = {
  name: 'ggml-base.bin',
  label: 'Speech model',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  /** About this big; the real size comes from the download. */
  bytes: 147_951_465,
};

/** A minute of speech is plenty for one go; anything longer is refused politely. */
export const MAX_AUDIO_BYTES = 16_000 * 2 * 300 + 44;

/** A voice note may be longer than dictation: its first ten minutes are read. */
export const VOICE_NOTE_SECONDS = 600;
const VOICE_NOTE_BYTES = 16_000 * 2 * VOICE_NOTE_SECONDS + 4096;

export const voiceDir = (home: string) => join(home, 'voice');

/** At most this many recordings wait for whisper.cpp at once. */
export const MAX_WAITING = 16;
/** A recording older than this in `voice/tmp` was left by something that crashed. */
const STALE_MS = 15 * 60_000;

export type { Exec };
const exec: Exec = (file, args, timeout) => run(file, args, { timeout, maxBuffer: 1024 * 1024 });

/**
 * Whether Conch can hear a voice note on this computer right now, and what
 * would make it able to: a program to install (a need), or the speech model.
 */
export type Hearing =
  | { ready: true }
  | { ready: false; need: 'whisper' | 'ffmpeg' }
  | { ready: false; model: 'missing' | 'downloading'; problem?: string };

export interface VoiceDeps {
  home: string;
  /** whisper-cli, where it is (the `whisper` need). */
  whisper: () => Promise<string | undefined>;
  /** FFmpeg, where it is (the `ffmpeg` need): voice notes come in other formats. */
  ffmpeg?: () => Promise<string | undefined>;
  exec?: Exec;
  /** FFmpeg over stdin and stdout (`audio.ts`); tests stand in for it. */
  pipe?: Pipe;
  /** "Hey Conch" can be had here: this Conch runs in the desktop app (ADR 0078). */
  wake?: boolean;
  fetch?: typeof fetch;
  emit?: (status: VoiceStatus) => void;
  heal?: (message: string) => void;
}

/** A WAV header Conch can read: RIFF/WAVE, PCM, 16 kHz, mono, 16-bit. */
export function checkWav(bytes: Uint8Array, maxBytes = MAX_AUDIO_BYTES): string | undefined {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    b.length < 44 ||
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.toString('ascii', 8, 12) !== 'WAVE'
  )
    return 'That isn’t a recording Conch can read.';
  if (
    b.readUInt16LE(20) !== 1 ||
    b.readUInt16LE(22) !== 1 ||
    b.readUInt32LE(24) !== 16_000 ||
    b.readUInt16LE(34) !== 16
  )
    return 'The recording has to be 16 kHz mono.';
  if (b.length > maxBytes) return 'That’s more than five minutes. Say it in a few goes.';
  return undefined;
}

/** whisper.cpp's text, cleaned of its markers ("[BLANK_AUDIO]", "(music)"). */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[A-Z_ ]+\]/g, ' ')
    .replace(/\((?:music|silence|inaudible|applause|laughter)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class VoiceService {
  #download?: { done: number; total: number; controller: AbortController; promise: Promise<void> };
  #problem?: string;
  /** whisper.cpp runs at most two at a time; the rest wait their turn. */
  #running = 0;
  #waiting: (() => void)[] = [];

  constructor(private readonly deps: VoiceDeps) {}

  get #model() {
    return join(voiceDir(this.deps.home), MODEL.name);
  }

  async status(): Promise<VoiceStatus> {
    const whisper = await this.deps.whisper().catch(() => undefined);
    const model = existsSync(this.#model);
    const download = this.#download
      ? { done: this.#download.done, total: this.#download.total }
      : undefined;
    return {
      private: !whisper
        ? { state: 'missing' }
        : download
          ? { state: 'downloading', ...download }
          : model
            ? { state: 'ready' }
            : {
                state: 'model-missing',
                bytes: MODEL.bytes,
                ...(this.#problem && { problem: this.#problem }),
              },
      ...(this.deps.wake !== undefined && { wake: { available: this.deps.wake } }),
    };
  }

  /** Get the speech model, carrying on from a download that stopped. Answers at once. */
  async getModel(): Promise<VoiceStatus> {
    if (!this.#download && !existsSync(this.#model)) {
      const controller = new AbortController();
      const entry = { done: 0, total: MODEL.bytes, controller, promise: Promise.resolve() };
      this.#download = entry;
      this.#problem = undefined;
      entry.promise = this.#fetchModel(entry)
        .catch((error: Error) => {
          this.#problem =
            error.name === 'AbortError'
              ? undefined
              : `The speech model didn’t finish downloading: ${error.message} It carries on from where it stopped.`;
        })
        .finally(() => {
          this.#download = undefined;
          void this.status().then((s) => this.deps.emit?.(s));
        });
    }
    return this.status();
  }

  async #fetchModel(entry: { done: number; total: number; controller: AbortController }) {
    const dir = voiceDir(this.deps.home);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const part = `${this.#model}.part`;
    const fetcher = this.deps.fetch ?? fetch;
    // What Hugging Face says the file is (its LFS object id is its SHA-256), before the redirect.
    const head = await fetcher(MODEL.url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: entry.controller.signal,
    });
    const expected = head.headers.get('x-linked-etag')?.replace(/"/g, '').toLowerCase();
    const size = Number(head.headers.get('x-linked-size'));
    if (Number.isFinite(size) && size > 0) entry.total = size;
    const have = await stat(part)
      .then((s) => s.size)
      .catch(() => 0);
    const response = await fetcher(MODEL.url, {
      headers: have > 0 ? { range: `bytes=${have}-` } : {},
      signal: entry.controller.signal,
    });
    if (!response.ok || !response.body)
      throw new Error(`Hugging Face answered ${response.status}.`);
    const resumed = response.status === 206;
    entry.done = resumed ? have : 0;
    const out = createWriteStream(part, { flags: resumed ? 'a' : 'w', mode: 0o600 });
    const body = Readable.fromWeb(response.body as never);
    body.on('data', (chunk: Buffer) => {
      entry.done += chunk.length;
    });
    let lastEmit = 0;
    const tick = setInterval(() => {
      if (Date.now() - lastEmit < 500) return;
      lastEmit = Date.now();
      void this.status().then((s) => this.deps.emit?.(s));
    }, 500);
    try {
      await pipeline(body, out);
    } finally {
      clearInterval(tick);
    }
    // Checked as a whole: a resumed file is only right if all of it is.
    if (expected && /^[0-9a-f]{64}$/.test(expected)) {
      const hash = createHash('sha256');
      await pipeline((await import('node:fs')).createReadStream(part), hash);
      const got = hash.digest('hex');
      if (got !== expected) {
        await rm(part, { force: true });
        throw new Error('it didn’t match its checksum, so Conch threw it away.');
      }
    }
    await rename(part, this.#model);
  }

  /** Stop the download, keeping what's here. */
  pause(): void {
    this.#download?.controller.abort();
  }

  /**
   * Whether a voice note can be heard here now. A WAV needs only whisper.cpp
   * and its model; anything else needs FFmpeg too.
   */
  async hearing(wav = false): Promise<Hearing> {
    const status = await this.status();
    const p = status.private;
    if (p.state === 'missing') return { ready: false, need: 'whisper' };
    if (!wav && !(await this.deps.ffmpeg?.().catch(() => undefined)))
      return { ready: false, need: 'ffmpeg' };
    if (p.state === 'downloading') return { ready: false, model: 'downloading' };
    if (p.state === 'model-missing')
      return { ready: false, model: 'missing', ...(p.problem && { problem: p.problem }) };
    return { ready: true };
  }

  /**
   * The words in a voice note in any format FFmpeg reads (Opus, AAC, AMR, a
   * WAV): its first ten minutes, and whether there was more.
   */
  async transcribeNote(
    bytes: Uint8Array,
    language = 'auto',
  ): Promise<{ text: string; cut: boolean; seconds: number }> {
    let wav: Uint8Array = bytes;
    if (checkWav(bytes, VOICE_NOTE_BYTES)) {
      await this.#ready();
      const ffmpeg = await this.deps.ffmpeg?.().catch(() => undefined);
      if (!ffmpeg)
        throw new VoiceError(
          'not-ready',
          'Voice notes need FFmpeg to be read. Get it in Settings → Voice.',
          'ffmpeg',
        );
      try {
        wav = await this.#turn(() =>
          toWav16k(
            { ffmpeg, ...(this.deps.pipe && { pipe: this.deps.pipe }) },
            bytes,
            VOICE_NOTE_SECONDS,
          ),
        );
      } catch (error) {
        if (error instanceof AudioError)
          throw new VoiceError('bad-audio', 'That voice note couldn’t be read.');
        throw error;
      }
    }
    const seconds = wavSeconds(wav);
    const text = await this.transcribe(wav, language, VOICE_NOTE_BYTES);
    return { text, cut: seconds >= VOICE_NOTE_SECONDS - 1, seconds };
  }

  /** whisper.cpp and its model are here, or a sentence saying which isn't. */
  async #ready(): Promise<string> {
    const whisper = await this.deps.whisper();
    if (!whisper)
      throw new VoiceError(
        'not-ready',
        'Private dictation needs whisper.cpp. Get it in Settings → Voice.',
        'whisper',
      );
    if (!existsSync(this.#model))
      throw new VoiceError(
        'not-ready',
        'Private dictation needs its speech model. Get it in Settings → Voice.',
      );
    return whisper;
  }

  /**
   * Run `work` when fewer than two others are running. At most `MAX_WAITING`
   * wait their turn: a flood of voice notes can't pile up behind them.
   */
  async #turn<T>(work: () => Promise<T>): Promise<T> {
    if (this.#running >= 2) {
      if (this.#waiting.length >= MAX_WAITING)
        throw new VoiceError('busy', 'Conch is still listening to the others. Send it again soon.');
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    this.#running += 1;
    try {
      return await work();
    } finally {
      this.#running -= 1;
      this.#waiting.shift()?.();
    }
  }

  /** The words in a 16 kHz mono WAV. `language`: a code ("en"), or "auto". */
  async transcribe(
    wav: Uint8Array,
    language = 'auto',
    maxBytes = MAX_AUDIO_BYTES,
    /** Words that set what it expects to hear ("Hey Conch."): Conch's own, never a person's. */
    prompt?: string,
  ): Promise<string> {
    const wrong = checkWav(wav, maxBytes);
    if (wrong) throw new VoiceError('bad-audio', wrong);
    const whisper = await this.#ready();
    const dir = join(voiceDir(this.deps.home), 'tmp');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.sweep(STALE_MS);
    const file = join(dir, `${randomBytes(8).toString('hex')}.wav`);
    await writeFile(file, wav, { mode: 0o600 });
    try {
      // About a tenth of real time on a laptop; never longer than five minutes.
      const seconds = (wav.byteLength - 44) / 32_000;
      const result = await this.#turn(() =>
        (this.deps.exec ?? exec)(
          whisper,
          [
            '-m',
            this.#model,
            '-f',
            file,
            '-l',
            /^[a-z]{2}$/.test(language) ? language : 'auto',
            '-nt',
            '-np',
            ...(prompt ? ['--prompt', prompt] : []),
          ],
          Math.round(Math.min(300_000, 15_000 + seconds * 2_000)),
        ),
      );
      if (result.code !== 0)
        throw new VoiceError(
          'failed',
          `whisper.cpp couldn’t read it: ${result.stderr.trim().split('\n').pop() ?? 'no reason given'}`,
        );
      return cleanTranscript(result.stdout);
    } finally {
      await rm(file, { force: true });
    }
  }

  /**
   * Recordings left behind by a crash: all of them on start, and any older
   * than `olderThanMs` whenever another is read.
   */
  async sweep(olderThanMs?: number): Promise<void> {
    const dir = join(voiceDir(this.deps.home), 'tmp');
    if (olderThanMs === undefined) return rm(dir, { recursive: true, force: true });
    const now = Date.now();
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const path = join(dir, name);
      const age = now - ((await stat(path).catch(() => undefined))?.mtimeMs ?? now);
      if (age > olderThanMs) await rm(path, { force: true, recursive: true });
    }
  }

  doctorCheck(): DoctorCheck {
    return {
      id: 'voice',
      group: 'This computer',
      title: 'Private dictation',
      run: async ({ repair }) => {
        const status = await this.status();
        const item = (state: 'ok' | 'off' | 'fixed' | 'warning', message: string): DoctorItem[] => [
          {
            id: 'voice',
            group: 'This computer',
            title: 'Private dictation',
            state,
            message,
            ...(state === 'warning' && { repairable: true }),
          },
        ];
        const p = status.private;
        if (p.state === 'missing')
          return item('off', 'Dictation uses your browser’s speech recognition.');
        if (p.state === 'ready')
          return item('ok', 'Your voice is turned into text on this computer.');
        if (p.state === 'downloading') return item('ok', 'Getting the speech model.');
        // whisper.cpp is here and the model isn't: a repair gets it again.
        if (repair) {
          await this.getModel();
          return item('fixed', 'The speech model was missing, so Conch is getting it again.');
        }
        return item('warning', 'whisper.cpp is here, but its speech model isn’t. Repair gets it.');
      },
    };
  }
}

export class VoiceError extends Error {
  constructor(
    readonly code: 'bad-audio' | 'not-ready' | 'failed' | 'busy',
    message: string,
    /** What has to be installed first (a need id, ADR 0016), when that's what's missing. */
    readonly need?: 'whisper' | 'ffmpeg',
  ) {
    super(message);
  }
}
