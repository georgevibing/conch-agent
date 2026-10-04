/**
 * Piper, kept running (ADR 0077). Starting Piper takes a second or two (its
 * Python, then the voice); speaking a sentence once it's up takes a tenth of
 * that. So Conch keeps one small Piper process while voices are wanted, fed a
 * line of JSON per sentence, and stops it after five quiet minutes.
 *
 * The process runs Piper's own Python (the uv tool's, ADR 0077 § 3) with a
 * fixed script below: no shell, none of Conch's environment, and only the
 * paths of the voices Conch downloaded and checked. Text goes in on stdin,
 * never as an argument. When that Python can't be found, each sentence runs
 * `piper` itself instead: slower, the same voice.
 */
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { run } from '../lib/proc';

/** What the process runs: one request per line in, a header line and the samples out. */
export const SERVE = `
import sys, json
from piper import PiperVoice, SynthesisConfig
voices = {}
out = sys.stdout.buffer
for line in sys.stdin:
    ask = {}
    try:
        ask = json.loads(line)
        model = ask["model"]
        voice = voices.get(model)
        if voice is None:
            if len(voices) >= 2:
                voices.clear()
            voice = voices[model] = PiperVoice.load(model)
        length = ask.get("length")
        config = SynthesisConfig(length_scale=float(length) if length else None)
        pcm = b"".join(c.audio_int16_bytes for c in voice.synthesize(ask["text"], syn_config=config))
        out.write((json.dumps({"id": ask.get("id"), "rate": voice.config.sample_rate, "bytes": len(pcm)}) + "\\n").encode())
        out.write(pcm)
        out.flush()
    except Exception as error:
        out.write((json.dumps({"id": ask.get("id"), "error": str(error)[:300]}) + "\\n").encode())
        out.flush()
`;

/** A sentence spoken: 16-bit mono samples at `rate`. */
export interface Spoken {
  rate: number;
  pcm: Buffer;
}

/** A 16-bit mono WAV around raw samples. */
export function wavOf(pcm: Buffer, rate: number): Buffer {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/**
 * Piper's own Python: beside `piper` when it's a link into its uv tool
 * (macOS, Linux), else in uv's tool folder (Windows, where `piper.exe` is a
 * small launcher of uv's own).
 */
export async function piperPython(piper: string): Promise<string | undefined> {
  const names = process.platform === 'win32' ? ['python.exe'] : ['python3', 'python'];
  const near = (dir: string) => names.map((n) => join(dir, n)).find((p) => existsSync(p));
  try {
    const beside = near(dirname(realpathSync(piper)));
    if (beside) return beside;
  } catch {
    // Not a link: look where uv keeps its tools.
  }
  const toolDirs: string[] = [];
  if (process.env.UV_TOOL_DIR) toolDirs.push(process.env.UV_TOOL_DIR);
  const uv = join(dirname(piper), process.platform === 'win32' ? 'uv.exe' : 'uv');
  if (existsSync(uv)) {
    const said = await run(uv, ['tool', 'dir'], { timeout: 10_000 }).catch(() => undefined);
    const dir = said?.code === 0 ? said.stdout.trim() : '';
    if (dir) toolDirs.push(dir);
  }
  toolDirs.push(
    process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'uv', 'tools')
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'uv', 'tools'),
  );
  for (const dir of toolDirs) {
    const found = near(join(dir, 'piper-tts', process.platform === 'win32' ? 'Scripts' : 'bin'));
    if (found) return found;
  }
  return undefined;
}

/** Only what Python needs to start: none of Conch's keys or settings. */
function pythonEnv(): NodeJS.ProcessEnv {
  const keep = [
    'PATH',
    'Path',
    'SYSTEMROOT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HOME',
    'LANG',
  ];
  return {
    ...Object.fromEntries(keep.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : []))),
    // Words in any language, whatever the system's code page.
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
}

const IDLE_MS = 5 * 60_000;
const START_MS = 60_000;

interface Waiting {
  id: number;
  resolve(spoken: Spoken): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** One Piper process, spoken to one sentence at a time. */
export class PiperProcess {
  #child?: ChildProcessWithoutNullStreams;
  #buffer = Buffer.alloc(0);
  #header?: { id: number; rate: number; bytes: number };
  #waiting = new Map<number, Waiting>();
  #next = 1;
  #idle?: NodeJS.Timeout;
  #lastError = '';

  constructor(
    private readonly python: string,
    private readonly spawn: typeof nodeSpawn = nodeSpawn,
  ) {}

  get running(): boolean {
    return Boolean(this.#child);
  }

  speak(model: string, text: string, length?: number): Promise<Spoken> {
    const child = this.#start();
    const id = this.#next++;
    clearTimeout(this.#idle);
    return new Promise<Spoken>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(id);
        reject(new Error('Piper took too long to answer.'));
        this.stop();
      }, START_MS);
      this.#waiting.set(id, { id, resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, model, text, ...(length && { length }) })}\n`);
    }).finally(() => {
      if (!this.#waiting.size) {
        this.#idle = setTimeout(() => this.stop(), IDLE_MS);
        this.#idle.unref?.();
      }
    });
  }

  #start(): ChildProcessWithoutNullStreams {
    if (this.#child) return this.#child;
    const child = this.spawn(this.python, ['-u', '-c', SERVE], {
      env: pythonEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.#child = child;
    this.#buffer = Buffer.alloc(0);
    this.#header = undefined;
    child.stdout.on('data', (chunk: Buffer) => this.#read(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      this.#lastError = `${this.#lastError}${chunk}`.slice(-1000);
    });
    const gone = (why: string) => {
      if (this.#child !== child) return;
      this.#child = undefined;
      const reason = this.#lastError.trim().split('\n').pop() || why;
      for (const waiting of this.#waiting.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error(`Piper stopped: ${reason}`));
      }
      this.#waiting.clear();
    };
    child.on('error', (error) => gone(error.message));
    child.on('exit', (code) => gone(`it ended (${code ?? 'killed'}).`));
    child.stdin.on('error', () => undefined);
    return child;
  }

  #read(chunk: Buffer) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      if (!this.#header) {
        const end = this.#buffer.indexOf(10);
        if (end < 0) return;
        const line = this.#buffer.subarray(0, end).toString('utf8');
        this.#buffer = this.#buffer.subarray(end + 1);
        let said: { id?: number; rate?: number; bytes?: number; error?: string };
        try {
          said = JSON.parse(line) as typeof said;
        } catch {
          continue;
        }
        const waiting = said.id === undefined ? undefined : this.#waiting.get(said.id);
        if (said.error !== undefined || !said.rate || said.bytes === undefined) {
          if (waiting) {
            this.#waiting.delete(waiting.id);
            clearTimeout(waiting.timer);
            waiting.reject(new Error(`Piper couldn’t say it: ${said.error ?? 'no reason given'}`));
          }
          continue;
        }
        this.#header = { id: said.id ?? 0, rate: said.rate, bytes: said.bytes };
      }
      const header = this.#header;
      if (this.#buffer.length < header.bytes) return;
      const pcm = Buffer.from(this.#buffer.subarray(0, header.bytes));
      this.#buffer = this.#buffer.subarray(header.bytes);
      this.#header = undefined;
      const waiting = this.#waiting.get(header.id);
      if (waiting) {
        this.#waiting.delete(header.id);
        clearTimeout(waiting.timer);
        waiting.resolve({ rate: header.rate, pcm });
      }
    }
  }

  stop(): void {
    clearTimeout(this.#idle);
    const child = this.#child;
    this.#child = undefined;
    child?.stdin.end();
    child?.kill();
  }
}
