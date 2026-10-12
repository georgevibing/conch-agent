/**
 * Where a frozen gateway's JavaScript was when its supervisor gave up on it, so
 * repeated freezes can be diagnosed. Only function names and file:line inside
 * the Conch release folder: never commands, environments, arguments, values,
 * credentials or chat content (`supervisor-state.ts`).
 *
 * Node's `--report-on-signal` can't do this: its handler is ordinary JavaScript
 * on the main event loop, so a busy loop never writes the report (and the report
 * carries the whole environment). Instead a small thread inside the gateway asks
 * V8's inspector, in-process with no port, to pause the main thread. V8 honours
 * that between any two statements, even inside `while (true) {}`. A gateway
 * blocked in native code (a synchronous syscall) can't pause; that is recorded
 * as `outside-javascript`. Lines are those of the source as written: tsx runs
 * each module as one or two long lines, so a frame is mapped back through the
 * module's inline source map, and left out when it can't be.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

/** The supervisor never waits longer than this for the gateway's answer. */
export const EVIDENCE_BOUND_MS = 2_000;
export const EVIDENCE_KEPT = 3;
export const EVIDENCE_MAX_BYTES = 16_384;
const MAX_FRAMES = 40;
const ANSWER_MAX_BYTES = 65_536;
/** A module's source map larger than this isn't read: its frames are left out. */
const MAP_MAX_CHARS = 2_000_000;

export interface StackFrame {
  name: string;
  file: string;
  line: number;
}
export interface FreezeEvidence {
  version: 1;
  at: number;
  where: 'javascript' | 'outside-javascript';
  frames: StackFrame[];
}

export function evidenceFolder(home: string): string {
  return join(home, 'recovery', 'evidence');
}

const NAME = /^[\w$#.<>[\] ]{1,80}$/;
const FILE = /^[\w@+\-./]{1,200}$/;

/** Allowlisted frames only: an identifier, a relative path in the release, a line. */
export function stackOnly(raw: unknown): StackFrame[] {
  if (!Array.isArray(raw)) return [];
  const frames: StackFrame[] = [];
  for (const entry of raw.slice(0, MAX_FRAMES * 4)) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, file, line } = entry as Record<string, unknown>;
    if (
      typeof name !== 'string' ||
      !(NAME.test(name) || name === '(anonymous)') ||
      typeof file !== 'string' ||
      !FILE.test(file) ||
      file.startsWith('/') ||
      file.split('/').some((part) => part === '..' || part === '.' || part === '') ||
      typeof line !== 'number' ||
      !Number.isSafeInteger(line) ||
      line < 1 ||
      line > 10_000_000
    )
      continue;
    frames.push({ name, file, line });
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

/** At most `EVIDENCE_MAX_BYTES`: the innermost frames are the ones kept. */
export function evidenceText(evidence: FreezeEvidence): string {
  const frames = [...evidence.frames];
  for (;;) {
    const text = JSON.stringify({ ...evidence, frames });
    if (Buffer.byteLength(text) <= EVIDENCE_MAX_BYTES || !frames.length) return text;
    frames.pop();
  }
}

/** The newest evidence first; anything damaged or unexpected is passed over. */
export function readEvidence(home: string): FreezeEvidence[] {
  try {
    const folder = evidenceFolder(home);
    return kept(folder).flatMap((name) => {
      try {
        const file = join(folder, name);
        if (statSync(file).size > EVIDENCE_MAX_BYTES) return [];
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<FreezeEvidence>;
        if (
          raw.version !== 1 ||
          typeof raw.at !== 'number' ||
          (raw.where !== 'javascript' && raw.where !== 'outside-javascript')
        )
          return [];
        return [{ version: 1, at: raw.at, where: raw.where, frames: stackOnly(raw.frames) }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function kept(folder: string): string[] {
  return readdirSync(folder)
    .filter((name) => /^frozen-\d+\.json$/.test(name))
    .sort((a, b) => Number(b.slice(7, -5)) - Number(a.slice(7, -5)));
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Supervisor side: ask the gateway where it is, wait at most `boundMs`, and keep
 * a small, allowlisted record. Never throws and never holds up the kill; a
 * gateway that can't answer in time leaves nothing behind.
 */
export async function captureEvidence(
  pid: number | undefined,
  home: string,
  options: { boundMs?: number; now?: () => number } = {},
): Promise<boolean> {
  if (!pid) return false;
  const folder = evidenceFolder(home);
  const request = join(folder, `${pid}.request`);
  const answer = join(folder, `${pid}.frames.json`);
  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    tidy(folder);
    rmSync(answer, { force: true });
    writeFileSync(request, '', { mode: 0o600 });
    const deadline = performance.now() + (options.boundMs ?? EVIDENCE_BOUND_MS);
    let text: string | undefined;
    while (text === undefined && performance.now() < deadline) {
      await sleep(Math.max(0, Math.min(50, deadline - performance.now())));
      try {
        if (statSync(answer).size <= ANSWER_MAX_BYTES) text = readFileSync(answer, 'utf8');
        else break;
      } catch {
        // Not written yet.
      }
    }
    if (text === undefined) return false;
    const raw = JSON.parse(text) as { where?: unknown; frames?: unknown };
    const evidence: FreezeEvidence = {
      version: 1,
      at: (options.now ?? Date.now)(),
      where: raw.where === 'javascript' ? 'javascript' : 'outside-javascript',
      frames: stackOnly(raw.frames),
    };
    const temporary = join(folder, `frozen.${process.pid}.tmp`);
    writeFileSync(temporary, evidenceText(evidence), { mode: 0o600 });
    renameSync(temporary, join(folder, `frozen-${evidence.at}.json`));
    for (const name of kept(folder).slice(EVIDENCE_KEPT))
      rmSync(join(folder, name), { force: true });
    return true;
  } catch {
    return false;
  } finally {
    for (const file of [request, answer]) {
      try {
        rmSync(file, { force: true });
      } catch {
        // Tidied at the next capture.
      }
    }
  }
}

/** Requests and answers a stopped supervisor left behind. */
function tidy(folder: string): void {
  const old = Date.now() - 60_000;
  for (const name of readdirSync(folder)) {
    if (/^frozen-\d+\.json$/.test(name)) continue;
    try {
      if (statSync(join(folder, name)).mtimeMs < old) rmSync(join(folder, name), { force: true });
    } catch {
      // Gone already.
    }
  }
}

/**
 * Runs on its own thread, so it answers while the main thread is stuck. Plain
 * CommonJS without tsx: it must not depend on what the gateway loaded. Only
 * frames inside `root` ever reach the disk, as relative paths.
 */
const WATCHER = `
const { existsSync, renameSync, rmSync, writeFileSync } = require('node:fs');
const { Session } = require('node:inspector');
const { SourceMap } = require('node:module');
const { isAbsolute, join, relative, sep } = require('node:path');
const { fileURLToPath } = require('node:url');
const { workerData } = require('node:worker_threads');
const { folder, root, pid, pollMs, pauseMs, mapMs, mapMaxChars } = workerData;
const { supervisor, orphanMs, orphanCheckMs } = workerData;
const request = join(folder, pid + '.request');
const answer = join(folder, pid + '.frames.json');
let busy = false;
function inside(url) {
  if (typeof url !== 'string' || !url) return undefined;
  let path = url;
  try {
    if (url.startsWith('file:')) path = fileURLToPath(url);
  } catch {
    return undefined;
  }
  if (!isAbsolute(path)) return undefined;
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return rel.split(sep).join('/');
}
function write(where, frames) {
  try {
    writeFileSync(answer + '.tmp', JSON.stringify({ where, frames }), { mode: 0o600 });
    renameSync(answer + '.tmp', answer);
  } catch {}
}
// The source map inside the code V8 runs (tsx writes it inline), or null.
function mapOf(source) {
  if (typeof source !== 'string') return null;
  const at = source.lastIndexOf('//# sourceMappingURL=data:');
  if (at < 0) return null;
  const url = source.slice(at + 21).split(/\\s/, 1)[0];
  const comma = url.indexOf(',');
  if (comma < 0 || url.length - comma > mapMaxChars || !/^data:application\\/json[;,]/.test(url))
    return null;
  try {
    const payload = /;base64$/.test(url.slice(0, comma))
      ? Buffer.from(url.slice(comma + 1), 'base64').toString('utf8')
      : decodeURIComponent(url.slice(comma + 1));
    return new SourceMap(JSON.parse(payload));
  } catch {
    return null;
  }
}
function capture() {
  busy = true;
  const started = performance.now();
  // Scripts in the release, and whether what V8 runs has a source map.
  const scripts = new Map();
  const session = new Session();
  let finished = false;
  const close = () => {
    try { session.disconnect(); } catch {}
    busy = false;
  };
  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    write('outside-javascript', []);
    close();
  }, pauseMs);
  // The line of the source a person wrote, or nothing: V8's line is tsx's output,
  // the whole module on a line or two, and never passed off as a source line.
  function place(frame, maps) {
    const script = scripts.get(frame.location.scriptId);
    const file = inside(frame.url) || (script && script.file);
    if (!file) return undefined;
    const { lineNumber, columnNumber } = frame.location;
    if (script && !script.mapped) return { file, line: lineNumber + 1 };
    const map = maps.get(frame.location.scriptId);
    if (!map) return undefined;
    let entry;
    try { entry = map.findEntry(lineNumber, columnNumber || 0); } catch { return undefined; }
    if (!entry || typeof entry.originalLine !== 'number') return undefined;
    const original = inside(entry.originalSource);
    return original ? { file: original, line: entry.originalLine + 1 } : undefined;
  }
  function source(scriptId) {
    return new Promise((done) => {
      const late = setTimeout(done, Math.max(0, mapMs - (performance.now() - started)));
      session.post('Debugger.getScriptSource', { scriptId }, (error, result) => {
        clearTimeout(late);
        done(error ? undefined : result && result.scriptSource);
      });
    });
  }
  async function answer(callFrames) {
    const maps = new Map();
    for (const frame of callFrames) {
      const id = frame.location.scriptId;
      const script = scripts.get(id);
      if (maps.has(id) || (script && !script.mapped) || !(inside(frame.url) || script)) continue;
      if (performance.now() - started > mapMs) break;
      maps.set(id, mapOf(await source(id)));
    }
    const frames = [];
    for (const frame of callFrames) {
      const at = place(frame, maps);
      if (at) frames.push({ name: String(frame.functionName || '(anonymous)').slice(0, 80), ...at });
      if (frames.length >= 40) break;
    }
    return frames;
  }
  try {
    session.connectToMainThread();
    session.on('Debugger.scriptParsed', ({ params }) => {
      const file = inside(params.url);
      if (file) scripts.set(params.scriptId, { file, mapped: Boolean(params.sourceMapURL) });
    });
    session.on('Debugger.paused', ({ params }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      answer(params.callFrames.slice(0, 160))
        .catch(() => [])
        .then((frames) => {
          write('javascript', frames);
          session.post('Debugger.resume', () => close());
        });
    });
    session.post('Debugger.enable', () => session.post('Debugger.pause'));
  } catch {
    clearTimeout(timer);
    finished = true;
    close();
  }
}
setInterval(() => {
  if (busy || !existsSync(request)) return;
  try { rmSync(request, { force: true }); } catch {}
  capture();
}, pollMs);
// The supervisor is gone (this process was handed to another parent, or the
// one it had exited) and the gateway hasn't stopped by itself: its own way out
// runs on the main thread, which a freeze holds, so it ends here instead.
function gone() {
  if (process.ppid !== supervisor) return true;
  try {
    process.kill(supervisor, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}
if (supervisor > 1) {
  let goneAt;
  setInterval(() => {
    if (goneAt === undefined) {
      if (gone()) goneAt = performance.now();
    } else if (performance.now() - goneAt >= orphanMs) process.kill(process.pid, 'SIGKILL');
  }, orphanCheckMs);
}
`;

/**
 * A gateway whose supervisor went away stops by itself (its 'disconnect'
 * handler and the shutdown deadline); past this, it's frozen and is ended.
 */
export const ORPHAN_GRACE_MS = 20_000;

/**
 * Gateway side: answer the supervisor's requests from a thread of their own,
 * and, given the `supervisor`'s pid, end a gateway that is frozen once it has
 * gone. Costs a small idle thread; never keeps the gateway alive and never throws.
 */
export function answerEvidenceRequests(
  home: string,
  options: {
    root?: string;
    pollMs?: number;
    pauseMs?: number;
    mapMs?: number;
    supervisor?: number;
    orphanMs?: number;
    orphanCheckMs?: number;
  } = {},
): () => void {
  try {
    const worker = new Worker(WATCHER, {
      eval: true,
      execArgv: [],
      env: {},
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4 },
      workerData: {
        folder: evidenceFolder(home),
        // The folder that holds this release's code, whose files frames may name.
        root: options.root ?? resolve(import.meta.dirname, '..', '..', '..', '..'),
        pid: process.pid,
        pollMs: options.pollMs ?? 250,
        pauseMs: options.pauseMs ?? 1_000,
        // Finding source lines stops in time for the supervisor's bound.
        mapMs: options.mapMs ?? EVIDENCE_BOUND_MS - 500,
        mapMaxChars: MAP_MAX_CHARS,
        supervisor: options.supervisor ?? 0,
        orphanMs: options.orphanMs ?? ORPHAN_GRACE_MS,
        orphanCheckMs: options.orphanCheckMs ?? 1_000,
      },
    });
    worker.on('error', () => undefined);
    worker.unref();
    return () => void worker.terminate().catch(() => undefined);
  } catch {
    return () => undefined;
  }
}
