/**
 * Private dictation (ADR 0027): whisper.cpp turns what you say into text on
 * this computer, so your voice never leaves it. The page records, makes it a
 * 16 kHz mono WAV, and sends it here; whisper.cpp reads it and the words come
 * back. Nothing is kept: each recording is deleted the moment it's read.
 *
 * Getting it is one press: whisper.cpp through the computer's package manager
 * (a need, ADR 0016), then its speech model (about 150 MB) from Hugging Face,
 * with progress, carrying on where it stopped, and checked against the
 * SHA-256 Hugging Face publishes for it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { VoiceStatus } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import { run, type RunResult } from '../lib/proc';

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

export const voiceDir = (home: string) => join(home, 'voice');

export type Exec = (file: string, args: string[], timeout: number) => Promise<RunResult>;
const exec: Exec = (file, args, timeout) => run(file, args, { timeout, maxBuffer: 1024 * 1024 });

export interface VoiceDeps {
  home: string;
  /** whisper-cli, where it is (the `whisper` need). */
  whisper: () => Promise<string | undefined>;
  exec?: Exec;
  fetch?: typeof fetch;
  emit?: (status: VoiceStatus) => void;
  heal?: (message: string) => void;
}

/** A WAV header Conch can read: RIFF/WAVE, PCM, 16 kHz, mono, 16-bit. */
export function checkWav(bytes: Uint8Array): string | undefined {
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
  if (b.length > MAX_AUDIO_BYTES) return 'That’s more than five minutes. Say it in a few goes.';
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

  /** The words in a 16 kHz mono WAV. `language`: a code ("en"), or "auto". */
  async transcribe(wav: Uint8Array, language = 'auto'): Promise<string> {
    const wrong = checkWav(wav);
    if (wrong) throw new VoiceError('bad-audio', wrong);
    const whisper = await this.deps.whisper();
    if (!whisper)
      throw new VoiceError(
        'not-ready',
        'Private dictation needs whisper.cpp. Get it in Settings → Voice.',
      );
    if (!existsSync(this.#model))
      throw new VoiceError(
        'not-ready',
        'Private dictation needs its speech model. Get it in Settings → Voice.',
      );
    const dir = join(voiceDir(this.deps.home), 'tmp');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${randomBytes(8).toString('hex')}.wav`);
    await writeFile(file, wav, { mode: 0o600 });
    try {
      // About a tenth of real time on a laptop; never longer than two minutes.
      const seconds = (wav.byteLength - 44) / 32_000;
      const result = await (this.deps.exec ?? exec)(
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
        ],
        Math.min(120_000, 15_000 + seconds * 2_000),
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

  /** Recordings left behind by a crash are removed on start. */
  async sweep(): Promise<void> {
    await rm(join(voiceDir(this.deps.home), 'tmp'), { recursive: true, force: true });
  }

  doctorCheck(): DoctorCheck {
    return {
      id: 'voice',
      group: 'This computer',
      title: 'Private dictation',
      run: async ({ repair }) => {
        const status = await this.status();
        const item = (state: 'ok' | 'off' | 'fixed' | 'warning', message: string) => [
          { id: 'voice', group: 'This computer', title: 'Private dictation', state, message },
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
        return item('warning', 'whisper.cpp is here, but its speech model isn’t.');
      },
    };
  }
}

export class VoiceError extends Error {
  constructor(
    readonly code: 'bad-audio' | 'not-ready' | 'failed',
    message: string,
  ) {
    super(message);
  }
}
