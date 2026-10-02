/**
 * Conch's own model for meaning (ADR 0041): a small sentence-embedding model
 * that runs on this computer's processor, with nothing else to install.
 *
 * - **Asked for, then downloaded once.** The person presses Get it; Conch
 *   fetches the model's few files from Hugging Face, with progress, retrying a
 *   flaky network by itself. They land in `CONCH_HOME/models` (derived: never
 *   backed up, fetched again when missing) and work offline from then on.
 * - **Exactly the files Conch expects.** Every file is pinned to one revision,
 *   size and SHA-256 here, in the code. Anything else that arrives is thrown
 *   away, and a damaged file is noticed (Repair everything) and fetched again.
 * - **Never the network once it's here.** transformers.js runs it with remote
 *   loading off and a `fetch` that refuses, so the runtime can't reach out.
 *   An ONNX file is a graph of numbers, not code.
 * - **In a process of its own** (`forkRunner`, `ondevice-runner.ts`), with
 *   none of Conch's environment, stopped after ten idle minutes so its memory
 *   goes back. If it crashes, only it stops, and search uses words.
 * - **English, or many languages.** English speakers get all-MiniLM-L6-v2
 *   (23 MB); anyone whose browser or computer speaks something else gets the
 *   multilingual MiniLM (136 MB), which matches across 50 languages.
 */
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readJson, writeJson } from '../lib/fs';
import type { Embedder } from './embed';
import type { LoadRunner, Runner } from './ondevice-load';

export { loadTransformers, type LoadRunner, type Runner } from './ondevice-load';

export interface OnDeviceFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface OnDeviceSpec {
  /** Conch's name for it, kept in `meaning.json`. */
  id: string;
  /** What people see: "all-MiniLM-L6-v2". */
  name: string;
  repo: string;
  /** The exact commit the files come from. */
  revision: string;
  multilingual: boolean;
  /** Its own scale (see `Embedder.floor`), tuned on the sentences in `ondevice.test.ts`. */
  floor: number;
  same: number;
  files: OnDeviceFile[];
}

/** The models Conch can get, English first. Their hashes are Hugging Face's own (Git LFS). */
export const ON_DEVICE_MODELS: readonly OnDeviceSpec[] = [
  {
    id: 'minilm-l6-v2',
    name: 'all-MiniLM-L6-v2',
    repo: 'Xenova/all-MiniLM-L6-v2',
    revision: '751bff37182d3f1213fa05d7196b954e230abad9',
    multilingual: false,
    floor: 0.3,
    same: 0.5,
    files: [
      {
        path: 'config.json',
        bytes: 650,
        sha256: '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7',
      },
      {
        path: 'tokenizer.json',
        bytes: 711_661,
        sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0',
      },
      {
        path: 'tokenizer_config.json',
        bytes: 366,
        sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3',
      },
      {
        path: 'special_tokens_map.json',
        bytes: 125,
        sha256: 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
      },
      {
        path: 'onnx/model_quantized.onnx',
        bytes: 22_972_370,
        sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
      },
    ],
  },
  {
    id: 'multilingual-minilm-l12-v2',
    name: 'paraphrase-multilingual-MiniLM-L12-v2',
    repo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    revision: '2c4055b12046f11709e9df2c122e59ffbdc2f900',
    multilingual: true,
    floor: 0.35,
    same: 0.6,
    files: [
      {
        path: 'config.json',
        bytes: 673,
        sha256: '05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7',
      },
      {
        path: 'tokenizer.json',
        bytes: 17_082_913,
        sha256: 'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441',
      },
      {
        path: 'tokenizer_config.json',
        bytes: 496,
        sha256: '3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2',
      },
      {
        path: 'special_tokens_map.json',
        bytes: 280,
        sha256: '06e405a36dfe4b9604f484f6a1e619af1a7f7d09e34a8555eb0b77b66318067f',
      },
      {
        path: 'onnx/model_quantized.onnx',
        bytes: 118_308_126,
        sha256: '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc',
      },
    ],
  },
];

export const bytesOf = (spec: OnDeviceSpec) => spec.files.reduce((sum, f) => sum + f.bytes, 0);

/**
 * The model for these languages (the browser's, then this computer's): the
 * English one only when every language is English.
 */
export function modelFor(
  languages: string[],
  specs: readonly OnDeviceSpec[] = ON_DEVICE_MODELS,
): OnDeviceSpec {
  const english = specs.find((s) => !s.multilingual) ?? specs[0];
  const many = specs.find((s) => s.multilingual) ?? english;
  const said = languages.map((l) => l.trim().toLowerCase()).filter(Boolean);
  if (!said.length) said.push(systemLanguage());
  const onlyEnglish = said.every((l) => l === 'c' || l === 'posix' || /^en\b/.test(l));
  return (onlyEnglish ? english : many) as OnDeviceSpec;
}

/** This computer's language, as its environment or ICU says it. */
export function systemLanguage(): string {
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG;
  return (env?.split(/[.@]/)[0] ?? Intl.DateTimeFormat().resolvedOptions().locale).replace(
    '_',
    '-',
  );
}

/** Why a download stopped, in words a person can act on. */
export class GetModelError extends Error {
  constructor(
    message: string,
    /** Worth trying again by itself (a network blip), or not (no space, wrong file). */
    readonly passing: boolean,
  ) {
    super(message);
  }
}

export interface OnDeviceDeps {
  /** `CONCH_HOME/models`. */
  dir: string;
  specs?: readonly OnDeviceSpec[];
  fetch?: typeof fetch;
  load?: LoadRunner;
  /** Where the files come from (pinned by hash, so a mirror can't change them). */
  base?: string;
  heal?: (message: string) => void;
  /** Waits between tries; tests make it instant. */
  sleep?: (ms: number) => Promise<void>;
  /** Unload the model after this long unused, to give the memory back. */
  idleMs?: number;
}

const MARKER = 'meaning.json';
const CANT_RUN =
  'This computer couldn’t run the model that understands meaning, so search uses words.';
/** Waits before each new try of a download that failed in passing. */
const BACKOFF_MS = [2_000, 8_000, 30_000];

interface Marker {
  model: string;
  at: number;
}

export interface OnDeviceStatus {
  /** It's here, checked, and runs. */
  ready?: OnDeviceSpec;
  /** Getting it now: how far, 0–100. */
  getting?: number;
  /** Why the last try didn't work, or why it can't run here. */
  problem?: string;
}

export class OnDeviceModel {
  #getting?: Promise<void>;
  #progress?: number;
  #problem?: string;
  /** Checked this run (hashes read once, not on every search). */
  #checked?: { spec?: OnDeviceSpec; state: 'ok' | 'absent' | 'damaged' };
  /** It won't run on this computer: why. */
  #broken?: string;
  #runner?: Promise<Runner>;
  /** Times its process stopped by itself this run: twice, and it's set aside. */
  #crashes = 0;
  #idle?: ReturnType<typeof setTimeout>;

  constructor(private readonly deps: OnDeviceDeps) {}

  get #specs() {
    return this.deps.specs ?? ON_DEVICE_MODELS;
  }

  #path(spec: OnDeviceSpec, file: OnDeviceFile) {
    // Paths come from the code above, never from outside; still, keep them inside.
    const path = join(this.deps.dir, spec.repo, file.path);
    if (!path.startsWith(join(this.deps.dir, spec.repo) + sep))
      throw new Error('Unsafe model path');
    return path;
  }

  /** The model the person asked for, if they did. */
  async wanted(): Promise<OnDeviceSpec | undefined> {
    const marker = await readJson<Marker>(join(this.deps.dir, MARKER)).catch(() => undefined);
    return this.#specs.find((s) => s.id === marker?.model);
  }

  /** Is the asked-for model all here, every file as expected? Hashes are read once a run unless `fresh`. */
  async check(options: { fresh?: boolean } = {}): Promise<'ok' | 'absent' | 'damaged'> {
    if (this.#checked && !options.fresh) return this.#checked.state;
    const spec = await this.wanted();
    if (!spec) {
      this.#checked = { state: 'absent' };
      return 'absent';
    }
    let state: 'ok' | 'damaged' = 'ok';
    for (const file of spec.files)
      if (!(await this.#intact(spec, file))) {
        state = 'damaged';
        break;
      }
    this.#checked = { spec, state };
    return state;
  }

  async #intact(spec: OnDeviceSpec, file: OnDeviceFile): Promise<boolean> {
    const path = this.#path(spec, file);
    const size = await stat(path).then(
      (s) => s.size,
      () => -1,
    );
    if (size !== file.bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest('hex') === file.sha256;
  }

  status(): OnDeviceStatus {
    const ready = this.#checked?.state === 'ok' && !this.#broken ? this.#checked.spec : undefined;
    const problem = this.#broken ?? this.#problem;
    return {
      ...(ready && { ready }),
      ...(this.#progress !== undefined && { getting: this.#progress }),
      ...(problem && { problem }),
    };
  }

  /** What Conch would get for these languages, while there's none and it can run. */
  async offer(
    languages: string[],
  ): Promise<{ model: string; bytes: number; multilingual: boolean } | undefined> {
    if (this.#broken || (await this.check()) === 'ok') return undefined;
    const spec = (await this.wanted()) ?? modelFor(languages, this.#specs);
    return { model: spec.name, bytes: bytesOf(spec), multilingual: spec.multilingual };
  }

  /**
   * Get the model for these languages, with progress (the person pressed Get
   * it, so they've agreed). Their choice is written down first, so a download
   * cut short by a restart carries on by itself (`resume`).
   */
  get(languages: string[], onReady?: () => void): Promise<void> {
    this.#getting ??= (async () => {
      // Before the first await: whoever asks next already sees it started.
      this.#problem = undefined;
      this.#progress = 0;
      try {
        const spec = (await this.wanted()) ?? modelFor(languages, this.#specs);
        await mkdir(this.deps.dir, { recursive: true, mode: 0o700 });
        await writeJson(join(this.deps.dir, MARKER), { model: spec.id, at: Date.now() });
        for (let attempt = 0; ; attempt++) {
          try {
            await this.#download(spec);
            break;
          } catch (error) {
            const failure =
              error instanceof GetModelError ? error : explainDownload(error, bytesOf(spec));
            const wait = BACKOFF_MS[attempt];
            if (!failure.passing || wait === undefined) throw failure;
            await (this.deps.sleep ?? delay)(wait);
          }
        }
        this.#checked = { spec, state: 'ok' };
        this.#broken = undefined;
      } catch (error) {
        this.#problem =
          error instanceof GetModelError ? error.message : explainDownload(error, 0).message;
        this.#checked = undefined;
        throw error;
      } finally {
        this.#progress = undefined;
        this.#getting = undefined;
      }
      // After it's settled, so whoever's told can already use it.
      onReady?.();
    })();
    return this.#getting;
  }

  async #download(spec: OnDeviceSpec): Promise<void> {
    const total = bytesOf(spec);
    let done = 0;
    const tick = (n: number) => {
      done += n;
      this.#progress = Math.min(99, Math.floor((done / total) * 100));
    };
    for (const file of spec.files) {
      // Already here and right (an earlier try got this far): keep it.
      if (await this.#intact(spec, file)) {
        tick(file.bytes);
        continue;
      }
      let got = 0;
      try {
        await this.#fetchFile(spec, file, (n) => {
          got += n;
          tick(n);
        });
      } catch (error) {
        done -= got;
        throw error;
      }
    }
    this.#progress = 100;
  }

  async #fetchFile(spec: OnDeviceSpec, file: OnDeviceFile, tick: (n: number) => void) {
    const base = this.deps.base ?? 'https://huggingface.co';
    const url = `${base}/${spec.repo}/resolve/${spec.revision}/${file.path}`;
    const response = await (this.deps.fetch ?? fetch)(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!response.ok || !response.body)
      throw new GetModelError(
        response.status >= 500 || response.status === 429
          ? 'Hugging Face, where the model comes from, isn’t answering right now.'
          : 'The model isn’t where Conch expected it. An update to Conch will fix this.',
        response.status >= 500 || response.status === 429,
      );
    const target = this.#path(spec, file);
    const part = `${target}.part`;
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const handle = await open(part, 'w', 0o600);
    const hash = createHash('sha256');
    let size = 0;
    try {
      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > file.bytes) break;
        hash.update(chunk);
        await handle.write(chunk);
        tick(chunk.byteLength);
      }
    } finally {
      await handle.close();
    }
    if (size !== file.bytes || hash.digest('hex') !== file.sha256) {
      await rm(part, { force: true });
      // Cut short is a network blip; the wrong bytes in full are not.
      throw new GetModelError(
        size < file.bytes
          ? 'The download was cut short.'
          : 'What arrived wasn’t the model Conch expected, so it wasn’t used.',
        size < file.bytes,
      );
    }
    await rename(part, target);
  }

  /**
   * At start: clear half-downloaded files, and carry on a download the
   * person asked for that didn't finish (or a file that went missing).
   */
  async resume(onReady?: () => void): Promise<void> {
    await sweepParts(this.deps.dir).catch(() => undefined);
    if (!(await this.wanted())) return;
    if ((await this.check()) === 'ok') return;
    await this.get([], () => {
      this.deps.heal?.(
        'The model that lets memory search understand meaning was incomplete, so Conch got it again.',
      );
      onReady?.();
    }).catch(() => undefined);
  }

  /** The model as an `Embedder`, when it's here and runs; else nothing (search uses words). */
  async embedder(): Promise<Embedder | undefined> {
    if (this.#getting || this.#broken) return undefined;
    if ((await this.check()) !== 'ok') return undefined;
    const spec = this.#checked?.spec;
    if (!spec) return undefined;
    return {
      id: `built-in:${spec.id}@${spec.revision.slice(0, 7)}`,
      source: 'built-in',
      label: spec.name,
      floor: spec.floor,
      same: spec.same,
      embed: async (texts) => {
        const runner = await this.#run(spec);
        const out: Float32Array[] = [];
        try {
          // A few at a time: a thousand memories never become one giant message.
          for (let i = 0; i < texts.length; i += 32)
            out.push(...(await runner.embed(texts.slice(i, i + 32).map((t) => t.slice(0, 2000)))));
        } catch (error) {
          // Its process stopped: start a new one next time, unless it keeps stopping.
          if (error instanceof RunnerGone) {
            this.#runner = undefined;
            if (++this.#crashes >= 2) this.#broken = CANT_RUN;
          }
          throw error;
        }
        this.#touch();
        return out;
      },
    };
  }

  #run(spec: OnDeviceSpec): Promise<Runner> {
    this.#runner ??= (this.deps.load ?? forkRunner)(this.deps.dir, spec).catch((error: unknown) => {
      this.#runner = undefined;
      // Here, but it won't run on this computer (an old processor, a missing system library).
      this.#broken = CANT_RUN;
      throw error;
    });
    this.#touch();
    return this.#runner;
  }

  #touch() {
    clearTimeout(this.#idle);
    this.#idle = setTimeout(() => void this.unload(), this.deps.idleMs ?? 10 * 60_000);
    this.#idle.unref?.();
  }

  /** Give the memory back; the next search loads it again. */
  async unload(): Promise<void> {
    clearTimeout(this.#idle);
    const runner = this.#runner;
    this.#runner = undefined;
    await (await runner?.catch(() => undefined))?.dispose().catch(() => undefined);
  }

  /** Try again on a computer that couldn't run it (after an update, say). */
  retryRun() {
    this.#broken = undefined;
    this.#crashes = 0;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A download's failure, in plain words. */
export function explainDownload(error: unknown, bytes: number): GetModelError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? '';
  if (code === 'ENOSPC')
    return new GetModelError(
      `There isn’t enough space on this computer for it (it needs ${Math.ceil(bytes / 1_000_000)} MB).`,
      false,
    );
  if (code === 'EACCES' || code === 'EPERM')
    return new GetModelError('Conch couldn’t save it in its own folder.', false);
  return new GetModelError('Couldn’t download it: the internet seems to be unreachable.', true);
}

/** Half-downloaded files left by a crash or a restart. */
async function sweepParts(dir: string): Promise<void> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries)
    if (entry.isFile() && entry.name.endsWith('.part'))
      await rm(join(entry.parentPath, entry.name), { force: true });
}

/** The model's process stopped while it had work. */
export class RunnerGone extends Error {}

/** What the model's process may see of the environment: enough for Node, none of Conch's. */
export function runnerEnv(): NodeJS.ProcessEnv {
  const keep = [
    'PATH',
    'Path',
    'SYSTEMROOT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'HOME',
  ];
  return Object.fromEntries(keep.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])));
}

/** Node's flags for the model's process: only tsx's loader, so it can run TypeScript. */
function runnerArgs(): string[] {
  const tsx = dirname(createRequire(import.meta.url).resolve('tsx/package.json'));
  return ['--import', pathToFileURL(join(tsx, 'dist', 'loader.mjs')).href];
}

/**
 * The real runner: the model in its own process (`ondevice-runner.ts`).
 * Stopping it (`dispose`, after ten idle minutes) gives all its memory back.
 */
export const forkRunner: LoadRunner = async (dir, spec) => {
  const child = fork(fileURLToPath(new URL('./ondevice-runner.ts', import.meta.url)), [], {
    env: runnerEnv(),
    execArgv: runnerArgs(),
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let last = '';
  child.stderr?.on('data', (chunk: Buffer) => (last = `${last}${chunk}`.slice(-2000)));
  const pending = new Map<number, { resolve(v: Float32Array[]): void; reject(e: Error): void }>();
  let next = 0;
  let gone = false;
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The model took too long to start.')), 120_000);
    child.on(
      'message',
      (m: { type: string; id?: number; vectors?: Float32Array[]; message?: string }) => {
        if (m.type === 'ready') {
          clearTimeout(timer);
          resolve();
        } else if (m.type === 'failed') {
          clearTimeout(timer);
          reject(new Error(m.message ?? 'The model wouldn’t load.'));
        } else if (m.id !== undefined) {
          const waiting = pending.get(m.id);
          pending.delete(m.id);
          // Each its own copy: what arrives over the channel can share one buffer.
          if (m.type === 'vectors')
            waiting?.resolve((m.vectors ?? []).map((v) => Float32Array.from(v)));
          else waiting?.reject(new Error(m.message ?? 'The model couldn’t read that.'));
        }
      },
    );
    child.once('exit', (code, signal) => {
      gone = true;
      clearTimeout(timer);
      const why = new RunnerGone(
        `The model’s process stopped (${signal ?? `code ${code}`}).${last ? ` ${last.trim().split('\n').pop()}` : ''}`,
      );
      reject(why);
      for (const waiting of pending.values()) waiting.reject(why);
      pending.clear();
    });
  });
  child.send({ type: 'load', dir, spec });
  try {
    await ready;
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    embed: (texts) =>
      gone
        ? Promise.reject(new RunnerGone('The model’s process stopped.'))
        : new Promise((resolve, reject) => {
            const id = next++;
            pending.set(id, { resolve, reject });
            child.send({ type: 'embed', id, texts });
          }),
    async dispose() {
      if (gone) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.disconnect();
      // It leaves when the channel closes; if it doesn't, it's stopped.
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await exited;
      clearTimeout(timer);
    },
  };
};
