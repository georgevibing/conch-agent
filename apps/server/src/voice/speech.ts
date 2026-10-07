/**
 * A natural voice (ADR 0077): answers read aloud by a neural voice on the
 * computer Conch runs on (Piper), offline, instead of the device's own; or,
 * when the person chooses it, by a provider they connected (OpenAI's voices).
 * The device's `speechSynthesis` stays the fallback, in the browser.
 *
 * - **A few good voices, pinned.** Each Piper voice is two files from
 *   `rhasspy/piper-voices` at one revision, with the size and SHA-256 written
 *   here; anything else that arrives is thrown away. They land in
 *   `voice/voices` (derived: fetched again on a new computer).
 * - **Piper itself is a need** (`piper`, installed by uv), kept running while
 *   it's wanted (`piper.ts`).
 * - **A provider's voice only when it's yours and you chose it.** OpenAI's
 *   voices are offered only with an OpenAI key saved, and say that what's read
 *   aloud goes to OpenAI.
 * - **Voice notes back.** A channel answering a voice note with one
 *   (`voiceNote`) speaks the answer with the reply voice, then FFmpeg makes it
 *   the voice note the chat app plays.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  type CloudVoice,
  type ConchVoiceId,
  type DoctorItem,
  type NaturalVoice,
  sentences,
  speakable,
  type SpeechStatus,
} from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import { run } from '../lib/proc';
import { toVoiceNote, wavSeconds, type Exec, type NoteFormat, type Pipe } from './audio';
import { PiperProcess, piperPython, wavOf, type Spoken } from './piper';

/** The exact commit of `rhasspy/piper-voices` every voice comes from. */
export const PIPER_REVISION = 'c10ece1aade47bb51c153c893d14e5bf8e5b7117';

export interface PinnedFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface PiperVoiceSpec {
  id: string;
  name: string;
  lang: string;
  language: string;
  files: PinnedFile[];
}

/** One or two good voices for each language Settings → Voice offers. */
export const PIPER_VOICES: readonly PiperVoiceSpec[] = [
  {
    id: 'en_US-lessac-medium',
    name: 'Lessac',
    lang: 'en-US',
    language: 'American English',
    files: [
      {
        path: 'en/en_US/lessac/medium/en_US-lessac-medium.onnx',
        bytes: 63_201_294,
        sha256: '5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f',
      },
      {
        path: 'en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
        bytes: 4_885,
        sha256: 'efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0',
      },
    ],
  },
  {
    id: 'en_US-ryan-medium',
    name: 'Ryan',
    lang: 'en-US',
    language: 'American English',
    files: [
      {
        path: 'en/en_US/ryan/medium/en_US-ryan-medium.onnx',
        bytes: 63_201_294,
        sha256: 'abf4c274862564ed647ba0d2c47f8ee7c9b717d27bdad9219100eb310db4047a',
      },
      {
        path: 'en/en_US/ryan/medium/en_US-ryan-medium.onnx.json',
        bytes: 4_883,
        sha256: '44034c056cb15681b2ad494307c7f3f2e4499d1253c700c711fa0a4607ffe78d',
      },
    ],
  },
  {
    id: 'en_US-amy-medium',
    name: 'Amy',
    lang: 'en-US',
    language: 'American English',
    files: [
      {
        path: 'en/en_US/amy/medium/en_US-amy-medium.onnx',
        bytes: 63_201_294,
        sha256: 'b3a6e47b57b8c7fbe6a0ce2518161a50f59a9cdd8a50835c02cb02bdd6206c18',
      },
      {
        path: 'en/en_US/amy/medium/en_US-amy-medium.onnx.json',
        bytes: 4_882,
        sha256: '95a23eb4d42909d38df73bb9ac7f45f597dbfcde2d1bf9526fdeaf5466977d77',
      },
    ],
  },
  {
    id: 'en_GB-alba-medium',
    name: 'Alba',
    lang: 'en-GB',
    language: 'British English',
    files: [
      {
        path: 'en/en_GB/alba/medium/en_GB-alba-medium.onnx',
        bytes: 63_201_294,
        sha256: '401369c4a81d09fdd86c32c5c864440811dbdcc66466cde2d64f7133a66ad03b',
      },
      {
        path: 'en/en_GB/alba/medium/en_GB-alba-medium.onnx.json',
        bytes: 4_888,
        sha256: 'aa965a2f02ecced632c2694e1fc72bbff6d65f265fab567ca945918c73dd89f4',
      },
    ],
  },
  {
    id: 'en_GB-alan-medium',
    name: 'Alan',
    lang: 'en-GB',
    language: 'British English',
    files: [
      {
        path: 'en/en_GB/alan/medium/en_GB-alan-medium.onnx',
        bytes: 63_201_294,
        sha256: '0a309668932205e762801f1efc2736cd4b0120329622adf62be09e56339d3330',
      },
      {
        path: 'en/en_GB/alan/medium/en_GB-alan-medium.onnx.json',
        bytes: 4_888,
        sha256: 'c0f0d124e5895c00e7c03b35dcc8287f319a6998a365b182deb5c8e752ee8c1e',
      },
    ],
  },
  {
    id: 'de_DE-thorsten-medium',
    name: 'Thorsten',
    lang: 'de-DE',
    language: 'Deutsch',
    files: [
      {
        path: 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx',
        bytes: 63_201_294,
        sha256: '7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819',
      },
      {
        path: 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json',
        bytes: 4_819,
        sha256: '974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85',
      },
    ],
  },
  {
    id: 'el_GR-rapunzelina-medium',
    name: 'Rapunzelina',
    lang: 'el-GR',
    language: 'Ελληνικά',
    files: [
      {
        path: 'el/el_GR/rapunzelina/medium/el_GR-rapunzelina-medium.onnx',
        bytes: 62_950_044,
        sha256: '3ca9fb3092215ee92edfc019b43feb0115ff4dfe638eb34474833ab1de840952',
      },
      {
        path: 'el/el_GR/rapunzelina/medium/el_GR-rapunzelina-medium.onnx.json',
        bytes: 4_973,
        sha256: '3a6182ec7c7550e14ef15e5d9badbb18f973a434086ac9658a1b10991fd192f8',
      },
    ],
  },
  {
    id: 'es_ES-davefx-medium',
    name: 'Davefx',
    lang: 'es-ES',
    language: 'Español',
    files: [
      {
        path: 'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx',
        bytes: 63_201_294,
        sha256: '6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917',
      },
      {
        path: 'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json',
        bytes: 4_817,
        sha256: '0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842',
      },
    ],
  },
  {
    id: 'fr_FR-siwis-medium',
    name: 'Siwis',
    lang: 'fr-FR',
    language: 'Français',
    files: [
      {
        path: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx',
        bytes: 63_201_294,
        sha256: '641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99',
      },
      {
        path: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json',
        bytes: 4_875,
        sha256: '39479916c2db192b5ac9764daddd0c744d83e023ad890c6976c0633ae4df8959',
      },
    ],
  },
  {
    id: 'it_IT-paola-medium',
    name: 'Paola',
    lang: 'it-IT',
    language: 'Italiano',
    files: [
      {
        path: 'it/it_IT/paola/medium/it_IT-paola-medium.onnx',
        bytes: 63_511_038,
        sha256: '6fc918b5a0ea6137382833dddfa567bffbe6a5060c02043c87192ee59c04210c',
      },
      {
        path: 'it/it_IT/paola/medium/it_IT-paola-medium.onnx.json',
        bytes: 7_099,
        sha256: 'aea19c0a7fce29fbc359b93f10e7902854401e4c95ae2ea328ae516b15d296cf',
      },
    ],
  },
  {
    id: 'nl_NL-pim-medium',
    name: 'Pim',
    lang: 'nl-NL',
    language: 'Nederlands',
    files: [
      {
        path: 'nl/nl_NL/pim/medium/nl_NL-pim-medium.onnx',
        bytes: 63_516_050,
        sha256: '403e58c3675c394f505c2428117bf34cc56e9542dcf6eadbdd3a84706c12e048',
      },
      {
        path: 'nl/nl_NL/pim/medium/nl_NL-pim-medium.onnx.json',
        bytes: 5_037,
        sha256: '08b58456ca00cf77123826b1712758f99d5fd19ddfb7ec7da8e1a715b047f642',
      },
    ],
  },
  {
    id: 'pt_BR-faber-medium',
    name: 'Faber',
    lang: 'pt-BR',
    language: 'Português (Brasil)',
    files: [
      {
        path: 'pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx',
        bytes: 63_201_294,
        sha256: '858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7',
      },
      {
        path: 'pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json',
        bytes: 4_855,
        sha256: '7e694de195ae3fc36dd732c445eb04fb49b649854893cb5506b978f0d50a1d6f',
      },
    ],
  },
  {
    id: 'pl_PL-gosia-medium',
    name: 'Gosia',
    lang: 'pl-PL',
    language: 'Polski',
    files: [
      {
        path: 'pl/pl_PL/gosia/medium/pl_PL-gosia-medium.onnx',
        bytes: 63_201_294,
        sha256: '38f66464240ed74f186e6b7dc13c6e3b22e023426299f25c2b3cc9dfa9373fbc',
      },
      {
        path: 'pl/pl_PL/gosia/medium/pl_PL-gosia-medium.onnx.json',
        bytes: 4_814,
        sha256: '1aefb31a9d53ffe44a8163ff73ec833acb7a6253848f6bb0403d8a66f9c7510d',
      },
    ],
  },
  {
    id: 'tr_TR-dfki-medium',
    name: 'Dfki',
    lang: 'tr-TR',
    language: 'Türkçe',
    files: [
      {
        path: 'tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx',
        bytes: 63_201_294,
        sha256: '2844717f524ab965d3fe86e60562cbb601d3e456836efcc2196cc3a14112a8fb',
      },
      {
        path: 'tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx.json',
        bytes: 4_960,
        sha256: '13ebd7810f1b61b5027583cf3131a0a233b6ea81c38f2200ebc4ff41c3cca039',
      },
    ],
  },
];

/** OpenAI's voices, for a person who saved an OpenAI key and chose one. */
export const OPENAI_VOICES = ['alloy', 'ash', 'coral', 'nova', 'sage', 'shimmer', 'verse'] as const;

/** A spoken answer is at most this long; the rest stays in writing. */
const MAX_SPOKEN = 1_500;

export const voicesDir = (home: string) => join(home, 'voice', 'voices');
const tmpDir = (home: string) => join(home, 'voice', 'tmp');

export interface SpeechDeps {
  home: string;
  /** Piper, where it is (the `piper` need). */
  piper: () => Promise<string | undefined>;
  /** FFmpeg, for voice notes (the `ffmpeg` need). */
  ffmpeg?: () => Promise<string | undefined>;
  /** The OpenAI key, if one is saved (never prompting anybody). */
  openaiKey?: () => Promise<string | undefined>;
  /** The voice the person chose for voice notes (Settings → Voice). */
  chosen?: () => Promise<string | undefined>;
  fetch?: typeof fetch;
  exec?: Exec;
  /** FFmpeg over stdin and stdout (`audio.ts`); tests stand in for it. */
  pipe?: Pipe;
  /** Starts Piper's Python; tests stand in for it. */
  process?: (python: string) => Pick<PiperProcess, 'speak' | 'stop'>;
  /** Where Piper's Python is; tests stand in for it. */
  python?: (piper: string) => Promise<string | undefined>;
  emit?: (status: SpeechStatus) => void;
  /** The voices on offer; tests give their own. */
  voices?: readonly PiperVoiceSpec[];
}

export class SpeechError extends Error {
  constructor(
    readonly code: 'not-ready' | 'unknown' | 'failed',
    message: string,
    /** What to install first, when that's what's missing. */
    readonly need?: 'piper',
  ) {
    super(message);
  }
}

export class SpeechService {
  #downloads = new Map<string, { done: number; total: number; controller: AbortController }>();
  #problems = new Map<string, string>();
  #process?: { python: string; runner: Pick<PiperProcess, 'speak' | 'stop'> };
  /** Voices whose files were hashed this run and matched. */
  #checked = new Set<string>();

  constructor(private readonly deps: SpeechDeps) {}

  get #voices(): readonly PiperVoiceSpec[] {
    return this.deps.voices ?? PIPER_VOICES;
  }

  #spec(id: string): PiperVoiceSpec | undefined {
    return this.#voices.find((s) => s.id === id || `piper:${s.id}` === id);
  }

  #file(file: PinnedFile) {
    return join(voicesDir(this.deps.home), file.path.split('/').pop() ?? file.path);
  }

  /** Every file of a voice is here, and the right size. */
  #have(spec: PiperVoiceSpec): boolean {
    return spec.files.every((f) => {
      try {
        return statSync(this.#file(f)).size === f.bytes;
      } catch {
        return false;
      }
    });
  }

  /** Its files hash to what's written here: checked once per start. */
  async #intact(spec: PiperVoiceSpec): Promise<boolean> {
    if (this.#checked.has(spec.id)) return true;
    for (const file of spec.files) {
      const hash = createHash('sha256');
      try {
        await pipeline(createReadStream(this.#file(file)), hash);
      } catch {
        return false;
      }
      if (hash.digest('hex') !== file.sha256) return false;
    }
    this.#checked.add(spec.id);
    return true;
  }

  async status(): Promise<SpeechStatus> {
    const piper = await this.deps.piper().catch(() => undefined);
    const key = await this.deps.openaiKey?.().catch(() => undefined);
    const voices: NaturalVoice[] = this.#voices.map((spec) => {
      const download = this.#downloads.get(spec.id);
      const problem = this.#problems.get(spec.id);
      return {
        id: `piper:${spec.id}`,
        name: spec.name,
        lang: spec.lang,
        language: spec.language,
        bytes: spec.files.reduce((sum, f) => sum + f.bytes, 0),
        state: download ? 'downloading' : this.#have(spec) ? 'ready' : 'missing',
        ...(download && { done: download.done, total: download.total }),
        ...(problem && !download && { problem }),
      };
    });
    const cloud: CloudVoice[] = key
      ? OPENAI_VOICES.map((v) => ({
          id: `openai:${v}`,
          name: `${v.charAt(0).toUpperCase()}${v.slice(1)}`,
          provider: 'OpenAI',
        }))
      : [];
    const reply = await this.replyVoice({ piper, key });
    return { piper: piper ? 'ready' : 'missing', voices, cloud, ...(reply && { reply }) };
  }

  /**
   * The voice voice notes are answered with: the one chosen, if it can speak
   * now; else the first natural voice that's here. Never a provider's voice
   * nobody chose.
   */
  async replyVoice(
    known: { piper?: string; key?: string } = {},
  ): Promise<ConchVoiceId | undefined> {
    const chosen = await this.deps.chosen?.().catch(() => undefined);
    const piper = known.piper ?? (await this.deps.piper().catch(() => undefined));
    if (chosen?.startsWith('piper:')) {
      const spec = this.#spec(chosen);
      if (spec && piper && this.#have(spec)) return `piper:${spec.id}`;
    }
    if (chosen?.startsWith('openai:')) {
      const name = chosen.slice('openai:'.length);
      const key = known.key ?? (await this.deps.openaiKey?.().catch(() => undefined));
      if (key && (OPENAI_VOICES as readonly string[]).includes(name)) return `openai:${name}`;
    }
    if (!piper) return undefined;
    const first = this.#voices.find((s) => this.#have(s));
    return first ? `piper:${first.id}` : undefined;
  }

  /** Download a voice (pinned, checked); answers at once, progress comes through `emit`. */
  async getVoice(id: string): Promise<SpeechStatus> {
    const spec = this.#spec(id);
    if (!spec) throw new SpeechError('unknown', 'Conch doesn’t know that voice.');
    if (!this.#downloads.has(spec.id) && !this.#have(spec)) {
      const entry = {
        done: 0,
        total: spec.files.reduce((sum, f) => sum + f.bytes, 0),
        controller: new AbortController(),
      };
      this.#downloads.set(spec.id, entry);
      this.#problems.delete(spec.id);
      const tick = setInterval(() => void this.status().then((s) => this.deps.emit?.(s)), 500);
      tick.unref?.();
      void this.#fetchVoice(spec, entry)
        .catch((error: Error) => {
          if (error.name !== 'AbortError')
            this.#problems.set(
              spec.id,
              `${spec.name} didn’t finish downloading: ${error.message} Try again.`,
            );
        })
        .finally(() => {
          clearInterval(tick);
          this.#downloads.delete(spec.id);
          void this.status().then((s) => this.deps.emit?.(s));
        });
    }
    return this.status();
  }

  /** Resolves once a voice that's downloading has finished (tests, and callers that carry on). */
  async settled(): Promise<void> {
    while (this.#downloads.size) await new Promise((r) => setTimeout(r, 20));
  }

  async #fetchVoice(spec: PiperVoiceSpec, entry: { done: number; controller: AbortController }) {
    await mkdir(voicesDir(this.deps.home), { recursive: true, mode: 0o700 });
    for (const file of spec.files) {
      const target = this.#file(file);
      if (existsSync(target) && statSync(target).size === file.bytes) {
        entry.done += file.bytes;
        continue;
      }
      const part = `${target}.part`;
      const response = await (this.deps.fetch ?? fetch)(
        `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_REVISION}/${file.path}`,
        { signal: entry.controller.signal },
      );
      if (!response.ok || !response.body)
        throw new Error(`Hugging Face answered ${response.status}.`);
      const hash = createHash('sha256');
      let got = 0;
      const count = new Transform({
        transform(chunk: Buffer, _encoding, next) {
          hash.update(chunk);
          got += chunk.length;
          entry.done += chunk.length;
          // Never more than the file Conch expects.
          if (got > file.bytes) return next(new Error('it was bigger than it should be.'));
          next(null, chunk);
        },
      });
      try {
        await pipeline(
          Readable.fromWeb(response.body as never),
          count,
          createWriteStream(part, { mode: 0o600 }),
        );
        if (got !== file.bytes || hash.digest('hex') !== file.sha256)
          throw new Error('it didn’t match its checksum, so Conch threw it away.');
        await rename(part, target);
      } finally {
        await rm(part, { force: true });
      }
    }
    this.#checked.add(spec.id);
  }

  /** Stop downloading a voice. */
  pause(id: string): void {
    const spec = this.#spec(id);
    if (spec) this.#downloads.get(spec.id)?.controller.abort();
  }

  /** Remove a downloaded voice. */
  async forget(id: string): Promise<SpeechStatus> {
    const spec = this.#spec(id);
    if (spec) {
      this.pause(spec.id);
      for (const file of spec.files) await rm(this.#file(file), { force: true });
      this.#checked.delete(spec.id);
    }
    return this.status();
  }

  /** Say `text` (a sentence or two) with `voice`: a WAV. */
  async speak(text: string, voice: string, rate = 1): Promise<Buffer> {
    if (voice.startsWith('openai:')) return this.#openai(text, voice.slice(7), rate);
    const spec = voice.startsWith('piper:') ? this.#spec(voice) : undefined;
    if (!spec) throw new SpeechError('unknown', 'Conch doesn’t know that voice.');
    const piper = await this.deps.piper().catch(() => undefined);
    if (!piper)
      throw new SpeechError(
        'not-ready',
        'Natural voices need Piper. Get it in Settings → Voice.',
        'piper',
      );
    if (!this.#have(spec))
      throw new SpeechError(
        'not-ready',
        `${spec.name} isn’t downloaded yet. Get it in Settings → Voice.`,
      );
    const model = this.#file(spec.files[0] ?? { path: '', bytes: 0, sha256: '' });
    const length = rate === 1 ? undefined : Math.round((1 / rate) * 100) / 100;
    const spoken = await this.#piper(piper, model, text, length);
    return wavOf(spoken.pcm, spoken.rate);
  }

  /** Piper kept running when its Python can be found; else `piper` itself, once per sentence. */
  async #piper(piper: string, model: string, text: string, length?: number): Promise<Spoken> {
    const python = await (this.deps.python ?? piperPython)(piper);
    if (python) {
      if (this.#process?.python !== python) {
        this.#process?.runner.stop();
        this.#process = {
          python,
          runner: this.deps.process?.(python) ?? new PiperProcess(python),
        };
      }
      try {
        return await this.#process.runner.speak(model, text, length);
      } catch (error) {
        throw new SpeechError('failed', (error as Error).message);
      }
    }
    await mkdir(tmpDir(this.deps.home), { recursive: true, mode: 0o700 });
    const out = join(
      tmpDir(this.deps.home),
      `${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
    );
    try {
      const result = await run(
        piper,
        ['-m', model, '-f', out, ...(length ? ['--length-scale', String(length)] : [])],
        { timeout: 60_000, input: text },
      );
      if (result.code !== 0)
        throw new SpeechError(
          'failed',
          `Piper couldn’t say it: ${result.stderr.trim().split('\n').pop() ?? 'no reason given'}`,
        );
      const wav = await readFile(out);
      return { rate: wav.readUInt32LE(24), pcm: dataOf(wav) };
    } finally {
      await rm(out, { force: true });
    }
  }

  async #openai(text: string, name: string, rate: number): Promise<Buffer> {
    if (!(OPENAI_VOICES as readonly string[]).includes(name))
      throw new SpeechError('unknown', 'Conch doesn’t know that voice.');
    const key = await this.deps.openaiKey?.().catch(() => undefined);
    if (!key)
      throw new SpeechError(
        'not-ready',
        'OpenAI’s voices need your OpenAI key. Add it in Settings → Providers.',
      );
    const response = await (this.deps.fetch ?? fetch)('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: name,
        input: text,
        response_format: 'wav',
        speed: rate,
      }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => {
      throw new SpeechError('failed', 'OpenAI couldn’t be reached.');
    });
    if (response.status === 401)
      throw new SpeechError(
        'failed',
        'OpenAI didn’t accept your key. Check it in Settings → Providers.',
      );
    if (response.status === 429)
      throw new SpeechError('failed', 'OpenAI says you’ve reached a limit. Try again in a moment.');
    if (!response.ok) throw new SpeechError('failed', `OpenAI answered ${response.status}.`);
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * An answer as a voice note for a chat app, with the reply voice: at most
   * the first 1 500 characters spoken (the rest stays in writing). Undefined
   * when there's no voice to answer with, or no FFmpeg to make the note.
   */
  async voiceNote(
    markdown: string,
    format: NoteFormat,
  ): Promise<{ bytes: Buffer; mimeType: string; seconds: number } | undefined> {
    const voice = await this.replyVoice();
    const ffmpeg = await this.deps.ffmpeg?.().catch(() => undefined);
    if (!voice || !ffmpeg) return undefined;
    let text = speakable(markdown);
    if (text.length > MAX_SPOKEN) {
      const kept: string[] = [];
      for (const s of sentences(text)) {
        if (kept.join(' ').length + s.length > MAX_SPOKEN) break;
        kept.push(s);
      }
      text = `${kept.join(' ')} The rest is in writing.`;
    }
    if (!text) return undefined;
    // Piper speaks a few sentences at a time; OpenAI takes it whole.
    const parts: Buffer[] = [];
    let rate = 0;
    for (const chunk of voice.startsWith('openai:') ? [text] : groups(sentences(text), 400)) {
      const wav = await this.speak(chunk, voice);
      rate ||= wav.readUInt32LE(24);
      parts.push(dataOf(wav));
    }
    const wav = wavOf(Buffer.concat(parts), rate || 22_050);
    const bytes = await toVoiceNote(
      { ffmpeg, ...(this.deps.pipe && { pipe: this.deps.pipe }) },
      wav,
      format,
    );
    return {
      bytes,
      mimeType: format === 'ogg' ? 'audio/ogg' : 'audio/aac',
      seconds: Math.max(1, Math.round(wavSeconds(wav))),
    };
  }

  stop(): void {
    this.#process?.runner.stop();
    this.#process = undefined;
    for (const download of this.#downloads.values()) download.controller.abort();
  }

  doctorCheck(): DoctorCheck {
    const base = { id: 'speech', group: 'This computer', title: 'Natural voices' };
    const item = (
      state: DoctorItem['state'],
      message: string,
      action?: DoctorItem['action'],
    ): DoctorItem[] => [{ ...base, state, message, ...(action && { action }) }];
    return {
      ...base,
      run: async ({ repair }) => {
        const downloaded = this.#voices.filter((s) =>
          s.files.some((f) => existsSync(this.#file(f))),
        );
        if (!downloaded.length)
          return item('off', 'Answers are read with each device’s own voice.');
        if (!(await this.deps.piper().catch(() => undefined)))
          return item('needs-you', 'Piper isn’t on this computer any more.', {
            kind: 'need',
            label: 'Install Piper',
            mode: 'install',
            need: 'piper',
          });
        // A voice whose files are damaged or half there is fetched again.
        const broken: PiperVoiceSpec[] = [];
        for (const spec of downloaded)
          if (!this.#downloads.has(spec.id) && (!this.#have(spec) || !(await this.#intact(spec))))
            broken.push(spec);
        const name = broken[0]?.name ?? 'A voice';
        if (!broken.length) return item('ok', 'Answers can be read with a natural voice, offline.');
        if (!repair)
          return [
            {
              ...base,
              state: 'warning',
              message: `${name} is damaged. Repair gets it again.`,
              repairable: true,
            },
          ];
        for (const spec of broken) {
          for (const file of spec.files) await rm(this.#file(file), { force: true });
          await this.getVoice(spec.id);
        }
        return item('fixed', `${name} was damaged, so Conch is getting it again.`);
      },
    };
  }
}

/** Sentences gathered into pieces of about `size` characters. */
export function groups(parts: string[], size: number): string[] {
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

/** The samples of a WAV, past its header (and any chunks before its data). */
export function dataOf(wav: Buffer): Buffer {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') return wav.subarray(offset + 8, Math.min(wav.length, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  return wav.subarray(44);
}
