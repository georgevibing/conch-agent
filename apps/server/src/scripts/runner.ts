/**
 * Running a script that calls tools (ADR 0123).
 *
 * The script runs in the sealed runtime Conch apps use (ADR 0061 §2,
 * `conchapps/runtime.ts`, unchanged): a Node process of its own under the
 * permission model, with no network, no programs, no environment, no files
 * but its own module, 256 MB of memory, and the fence inside it. Its one way
 * out is `app.fetch`, which the runtime hands to the fetcher here, and this
 * fetcher only answers the script's own requests: a tool call, a progress
 * word, a note.
 *
 * Every tool call goes through `host.authorize`, the same gate as a call the
 * model made itself (permission mode, Auto's judgement, questions, the guard
 * after reading, skill holds, tools turned off), one call at a time so the
 * patterns across calls are judged in order. A call that was refused or
 * declined throws in the script; nothing is skipped quietly.
 *
 * The bounds: a work clock (`seconds`, waiting for the person not counted),
 * a cap on calls, the runtime's memory and message caps, the output caps of
 * the wrapper, and Stop (the turn's signal), each of which ends the process.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APP_COLORS,
  APP_GLYPHS,
  ConchAppManifest,
  SCRIPT_LIMITS,
  type ConversationEventInput,
  type ScriptCallStatus,
  type ScriptProgress,
  type ScriptRun,
  type ScriptStop,
  type ScriptTally,
} from '@conch/protocol';
import { z } from 'zod';

import { SealedRuntime } from '../conchapps/runtime';
import type { AppFetchRequest, AppFetchResponse } from '../conchapps/types';
import { checkHostArgs } from '../engines/tools/args';
import { failureText, hostToolText, type HostTool } from '../engines/types';
import { newId } from '../lib/ids';
import { scriptStep, type ScriptStep } from './scope';
import { moduleFor, prepare, SCRIPT_SITE, ScriptSyntaxError } from './wrapper';

/** A tool a script may call: the tool, and the name the gate knows it by (`mcp__conch__…`, `Write`). */
export interface ScriptTool {
  tool: HostTool;
  display: string;
}

/** The events a run adds to the chat's log. */
export type ScriptEvent = Extract<ConversationEventInput, { type: 'script.run' | 'script.call' }>;

/** What a run may reach and what it answers to: the turn it's in. */
export interface ScriptHost {
  /** The tools a script may call, by the name the model knows them. */
  tools(): ReadonlyMap<string, ScriptTool>;
  /**
   * The gate, as if the model had made the call (ADR 0123): undefined to go
   * ahead, or why not, and whether that's because the person said no.
   */
  authorize(
    display: string,
    input: Record<string, unknown>,
    callId: string,
  ): Promise<{ message: string; declined: boolean } | undefined>;
  /**
   * A call is over: what it changed is kept (ADR 0030), what it read marks the
   * chat (ADR 0028), and it's no longer an uncertain action. `ran` when it ran.
   */
  settle?(
    callId: string,
    ran?: { display: string; input: Record<string, unknown>; ok: boolean },
  ): Promise<void>;
  append(event: ScriptEvent): void;
  /** The turn's: Stop, or the turn ending, ends the run. */
  signal: AbortSignal;
}

export interface RunOptions {
  script: string;
  title: string;
  /** Seconds of work, waiting for the person not counted. */
  seconds?: number;
  /** Tool calls, at most. */
  calls?: number;
  /** The `run_script` call it is, when known. */
  toolUseId?: string;
  /** For tests: the runtime to start, and a quicker clock. */
  hostScript?: string;
  tickMs?: number;
  now?: () => number;
}

export interface ScriptOutcome {
  /** False when the script failed or met a bound: the model reads `text` as the error. */
  ok: boolean;
  /** What the model gets: what the script returned and logged, and how the run went. */
  text: string;
  run: ScriptRun;
}

/** Longer than any run is allowed, so the runtime's own timer only ever catches a hang. */
const CEILING_MS = 2 * 60 * 60_000;
/** How often, at most, the chat hears how a run is going. */
const EVERY_MS = 300;
/** Tools a script can't call: the script tool itself, and what only makes sense said to the person once. */
export const NOT_FROM_SCRIPTS = new Set([
  'run_script',
  'ask',
  'offer',
  'suggest_replies',
  'update_plan',
  'exit_plan_mode',
  'delegate',
]);

/** What the wrapper hands back (`wrapper.ts`). */
const Payload = z.object({
  said: z.array(z.string()).default([]),
  unsaid: z.number().int().nonnegative().default(0),
  note: z.string().max(200).optional(),
  value: z.string().optional(),
  valueCut: z.number().int().nonnegative().optional(),
  error: z
    .object({
      name: z.string().max(200),
      message: z.string().max(2_000),
      line: z.number().int().positive().optional(),
      tool: z.string().max(200).optional(),
      declined: z.boolean().optional(),
    })
    .optional(),
});
type Payload = z.infer<typeof Payload>;

const cut = (text: string, max: number) =>
  text.length > max
    ? `${text.slice(0, max)}… (${(text.length - max).toLocaleString('en')} more characters)`
    : text;

/** A tool's answer as the script gets it: its JSON when it is JSON, else its words. */
export function valueOf(text: string): unknown {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed) || /^"/.test(trimmed))
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // Words that only start like JSON.
    }
  return text;
}

/**
 * A call's input as the chat keeps it: long words shortened first, so what's
 * kept stays JSON (who it went to, how many things it named) and the
 * patterns across calls can still read it (`behaviour.ts` `stepsOf`).
 */
export function keptInput(raw: unknown): string {
  const short = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 160)}…` : value;
    if (depth > 4 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => short(v, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, short(v, depth + 1)]));
  };
  const whole = JSON.stringify(raw) ?? '{}';
  if (whole.length <= SCRIPT_LIMITS.keepChars) return whole;
  const kept = JSON.stringify(short(raw, 0)) ?? '{}';
  return cut(kept, SCRIPT_LIMITS.keepChars);
}

/** Up to `slots` at once; the rest wait in order. */
function slots(count: number) {
  let free = count;
  const waiting: (() => void)[] = [];
  return {
    async take() {
      if (free > 0) {
        free--;
        return;
      }
      await new Promise<void>((resolve) => waiting.push(resolve));
    },
    give() {
      const next = waiting.shift();
      if (next) next();
      else free++;
    },
  };
}

/** Names close to `name`, for "did you mean". */
function closest(name: string, names: readonly string[]): string[] {
  const words = name
    .toLowerCase()
    .split(/[_\W]+/)
    .filter(Boolean);
  return names
    .map((n) => ({ n, score: words.filter((w) => n.toLowerCase().includes(w)).length }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => c.n);
}

const STOP_WORDS: Record<ScriptStop, (run: { seconds: number; calls: number }) => string> = {
  time: ({ seconds }) =>
    `It ran out of time after ${seconds} seconds of work (time waiting for the person isn’t counted), so Conch stopped it. Do less in one run, or give it more with "seconds" (at most ${SCRIPT_LIMITS.maxSeconds}).`,
  calls: ({ calls }) =>
    `It reached its limit of ${calls} tool calls, so Conch stopped it there. Do less in one run, or give it more with "calls" (at most ${SCRIPT_LIMITS.maxCalls}).`,
  memory: () =>
    `It ran out of memory (${SCRIPT_LIMITS.memoryMb} MB), so Conch stopped it. Keep less in memory at once: work through the data in pieces.`,
  output: () =>
    'It sent back more than Conch takes at once, so Conch stopped it. Return less: a summary, or the few rows that matter.',
  you: () => 'It was stopped before it finished: the person pressed Stop, or the turn ended.',
  crash: () => 'It stopped unexpectedly, before it finished.',
};

export async function runScript(host: ScriptHost, options: RunOptions): Promise<ScriptOutcome> {
  const now = options.now ?? Date.now;
  const runId = newId('run');
  const title = options.title.trim().slice(0, 160) || 'Run a script';
  const seconds = Math.min(
    Math.max(1, Math.round(options.seconds ?? SCRIPT_LIMITS.seconds)),
    SCRIPT_LIMITS.maxSeconds,
  );
  const maxCalls = Math.min(
    Math.max(1, Math.round(options.calls ?? SCRIPT_LIMITS.calls)),
    SCRIPT_LIMITS.maxCalls,
  );
  const startedAt = now();
  const script = options.script.slice(0, SCRIPT_LIMITS.scriptChars);

  // ── What the chat hears ──
  const tally = new Map<string, Required<Omit<ScriptTally, 'tool'>>>();
  let calls = 0;
  let progress: ScriptProgress | undefined;
  let note: string | undefined;
  let worked = 0;
  const run = (state: ScriptRun['state'], extra: Partial<ScriptRun> = {}): ScriptRun => ({
    runId,
    ...(options.toolUseId && { toolUseId: options.toolUseId }),
    state,
    title,
    calls,
    tally: [...tally]
      .sort((a, b) => b[1].calls - a[1].calls)
      .slice(0, 64)
      .map(([tool, n]) => ({
        tool,
        calls: n.calls,
        ...(n.running && { running: n.running }),
        ...(n.failed && { failed: n.failed }),
        ...(n.declined && { declined: n.declined }),
      })),
    ...(progress && { progress }),
    ...(note && { note }),
    startedAt,
    ...extra,
  });
  let saidAt = 0;
  let later: NodeJS.Timeout | undefined;
  let over = false;
  const tell = (force = false) => {
    if (over) return;
    clearTimeout(later);
    const wait = EVERY_MS - (now() - saidAt);
    if (!force && wait > 0) {
      later = setTimeout(() => tell(true), wait);
      later.unref();
      return;
    }
    saidAt = now();
    host.append({ type: 'script.run', ...run('running') });
  };
  const count = (tool: string, from: ScriptCallStatus | undefined, to: ScriptCallStatus) => {
    const n = tally.get(tool) ?? { calls: 0, running: 0, failed: 0, declined: 0 };
    if (from === undefined) n.calls++;
    if (from === 'running') n.running--;
    if (to === 'running') n.running++;
    if (to === 'error') n.failed++;
    if (to === 'declined') n.declined++;
    tally.set(tool, n);
  };

  host.append({ type: 'script.run', ...run('running', { script }) });
  saidAt = now();

  const finish = (outcome: { ok: boolean; text: string; extra: Partial<ScriptRun> }) => {
    over = true;
    clearTimeout(later);
    const state: ScriptRun['state'] =
      outcome.extra.stop === 'you' ? 'stopped' : outcome.ok ? 'done' : 'failed';
    const final = run(state, {
      script,
      durationMs: worked,
      result: cut(outcome.text, SCRIPT_LIMITS.resultChars),
      ...outcome.extra,
    });
    host.append({ type: 'script.run', ...final });
    return { ok: outcome.ok, text: outcome.text, run: final };
  };

  let code: string;
  try {
    code = prepare(script).code;
  } catch (error) {
    const message = error instanceof ScriptSyntaxError ? error.message : failureText(error);
    return finish({ ok: false, text: message, extra: { error: message.slice(0, 2_000) } });
  }

  // ── The clock: work only, never the time a question waits ──
  let waiting = 0;
  let stop: ScriptStop | undefined;
  let runtime: SealedRuntime | undefined;
  const end = (why: ScriptStop) => {
    if (stop) return;
    stop = why;
    void runtime?.stop();
  };
  let tickedAt = now();
  const ticker = setInterval(() => {
    const at = now();
    if (!waiting) worked += at - tickedAt;
    tickedAt = at;
    if (worked > seconds * 1000) end('time');
  }, options.tickMs ?? 200);
  ticker.unref();
  const onAbort = () => end('you');
  host.signal.addEventListener('abort', onAbort, { once: true });
  if (host.signal.aborted) end('you');

  // ── Each call, through the gate ──
  let gate: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
    const turn = gate.then(work, work);
    gate = turn.catch(() => undefined);
    return turn;
  };
  const running = slots(SCRIPT_LIMITS.parallel);
  type Answer = { ok: true; value: unknown } | { ok: false; message: string; declined?: boolean };

  const callTool = async (name: string, body: string): Promise<Answer> => {
    if (stop) return { ok: false, message: 'The run is stopping.' };
    const step = ++calls;
    if (step > maxCalls) {
      calls = maxCalls;
      end('calls');
      return { ok: false, message: STOP_WORDS.calls({ seconds, calls: maxCalls }) };
    }
    const bare = name.replace(/^mcp__conch__/, '');
    const available = host.tools();
    const found = NOT_FROM_SCRIPTS.has(bare) ? undefined : available.get(bare);
    if (!found) {
      calls--;
      const near = closest(bare, [...available.keys()]);
      return {
        ok: false,
        message: NOT_FROM_SCRIPTS.has(bare)
          ? `A script can’t call ${bare}: ${bare === 'run_script' ? 'scripts don’t start scripts' : 'that one is for talking to the person, once, outside the script'}.`
          : `There’s no tool called ${bare.slice(0, 60)} here.${near.length ? ` Did you mean ${near.join(', ')}?` : ''} A script calls the tools you have, by the same names.`,
      };
    }
    if (Buffer.byteLength(body) > SCRIPT_LIMITS.inputBytes)
      return {
        ok: false,
        message: `That’s too much to send to ${bare} at once: at most ${SCRIPT_LIMITS.inputBytes / 1024} KB.`,
      };
    let raw: unknown;
    try {
      raw = JSON.parse(body || '{}');
    } catch {
      return { ok: false, message: `tools.${bare} takes one object of its inputs.` };
    }
    const callId = newId('sc');
    const input = keptInput(raw);
    const startedCall = now();
    const said = (status: ScriptCallStatus, output?: string) =>
      host.append({
        type: 'script.call',
        runId,
        callId,
        step,
        tool: bare,
        input,
        status,
        ...(output !== undefined && { output: cut(output, SCRIPT_LIMITS.keepOutput) }),
        ...(status !== 'running' && { durationMs: Math.max(0, now() - startedCall) }),
      });
    const checked = checkHostArgs(found.tool, raw, bare);
    if (!checked.ok) {
      count(bare, undefined, 'error');
      said('error', checked.message);
      tell();
      return { ok: false, message: checked.message };
    }
    const scope: ScriptStep = {
      runId,
      step,
      title,
      asking: (yes) => {
        waiting += yes ? 1 : -1;
      },
    };
    // The gate, one call at a time, with the clock stopped (a question, a second look).
    const refusal = await oneAtATime(() =>
      scriptStep.run(scope, async () => {
        if (stop) return { message: 'The run is stopping.', declined: false };
        waiting++;
        try {
          return await host.authorize(found.display, checked.args, callId);
        } catch (error) {
          return { message: failureText(error), declined: false };
        } finally {
          waiting--;
        }
      }),
    );
    if (refusal) {
      count(bare, undefined, 'declined');
      said('declined', refusal.message);
      tell();
      await host.settle?.(callId).catch(() => undefined);
      return {
        ok: false,
        message: refusal.declined
          ? `The person said no to this ${bare} call, so it didn’t happen. Carry on without it, or stop and ask them.`
          : refusal.message,
        ...(refusal.declined && { declined: true }),
      };
    }
    count(bare, undefined, 'running');
    said('running');
    tell();
    await running.take();
    let text: string;
    let failed = false;
    let declined = false;
    try {
      if (stop) throw new Error('The run is stopping.');
      const result = await scriptStep.run(scope, () =>
        found.tool.run(checked.args as never, { operationId: callId }),
      );
      text = hostToolText(result);
      failed = typeof result !== 'string' && result.isError === true;
      declined = typeof result !== 'string' && result.effect === 'not-executed';
    } catch (error) {
      text = failureText(error);
      failed = true;
    } finally {
      running.give();
    }
    await host
      .settle?.(callId, { display: found.display, input: checked.args, ok: !failed && !declined })
      .catch(() => undefined);
    const status: ScriptCallStatus = declined ? 'declined' : failed ? 'error' : 'success';
    count(bare, 'running', status);
    said(status, text);
    tell();
    if (declined) return { ok: false, message: text, declined: true };
    if (failed) return { ok: false, message: text };
    return { ok: true, value: valueOf(text) };
  };

  // ── What the script asks for, over the runtime's one way out ──
  const answer = (json: unknown): AppFetchResponse => ({
    ok: true,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(json),
  });
  const fetcher = async (_app: unknown, request: AppFetchRequest): Promise<AppFetchResponse> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      url = new URL('https://invalid.invalid');
    }
    if (url.origin !== SCRIPT_SITE || request.method !== 'POST')
      return {
        ok: false,
        status: 0,
        headers: {},
        body: '',
        refused: 'A script has no network of its own: it reaches things only through tools.',
      };
    const body = request.bodyBase64
      ? Buffer.from(request.body ?? '', 'base64').toString('utf8')
      : (request.body ?? '');
    const path = url.pathname;
    if (path.startsWith('/call/')) {
      const name = decodeURIComponent(path.slice('/call/'.length));
      return answer(await callTool(name, body));
    }
    let said: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === 'object') said = parsed as Record<string, unknown>;
    } catch {
      // Nothing to read: nothing to say.
    }
    if (path === '/progress') {
      const done = Number(said.done);
      const total = Number(said.total);
      if (Number.isFinite(done) && done >= 0)
        progress = {
          done: Math.max(done, progress?.done ?? 0),
          ...(Number.isFinite(total) && total > 0 && { total }),
          ...(typeof said.label === 'string' &&
            said.label.trim() && { label: said.label.trim().slice(0, 80) }),
        };
      tell();
    } else if (path === '/note' && typeof said.text === 'string' && said.text.trim()) {
      note = said.text.trim().slice(0, 200);
      tell();
    }
    return answer({ ok: true });
  };

  // ── The run ──
  const dir = await mkdtemp(join(tmpdir(), 'conch-script-'));
  let payload: Payload | undefined;
  let failedText: string | undefined;
  try {
    await mkdir(join(dir, 'data'));
    await writeFile(join(dir, 'tools.mjs'), moduleFor(code));
    runtime = new SealedRuntime({
      appDir: dir,
      dataDir: join(dir, 'data'),
      manifest: ConchAppManifest.parse({
        conch: 1,
        id: 'script',
        name: 'The script',
        tagline: 'A script the assistant wrote',
        version: '1.0.0',
        icon: { glyph: APP_GLYPHS[0], color: APP_COLORS[0] },
        tools: 'tools.mjs',
      }),
      settings: () => Promise.resolve({}),
      fetcher,
      callMs: CEILING_MS,
      // Nothing to keep: a script's data is in its variables.
      dataLimit: 1,
      idleMs: CEILING_MS,
      ...(options.hostScript && { hostScript: options.hostScript }),
    });
    if (stop) throw new Error('stopped');
    const outcome = await runtime.call('run', {});
    if (outcome.ok) {
      const parsed = Payload.safeParse(outcome.json);
      if (parsed.success) payload = parsed.data;
      else failedText = 'The script’s answer was too big to read back.';
    } else failedText = outcome.text;
    if (!stop && !outcome.ok && /heap out of memory|allocation failed/i.test(runtime.log))
      stop = 'memory';
    if (!stop && !outcome.ok && /sent back more than Conch takes/.test(outcome.text))
      stop = 'output';
    if (!stop && !outcome.ok && /crashed|stopped as they loaded/.test(outcome.text)) stop = 'crash';
  } catch (error) {
    if (!stop) failedText = failureText(error);
  } finally {
    clearInterval(ticker);
    host.signal.removeEventListener('abort', onAbort);
    await runtime?.stop().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  worked = Math.min(worked, seconds * 1000 + 1000);
  if (payload?.note) note = payload.note;
  return finish(compose({ payload, failedText, stop, seconds, maxCalls, calls, tally, worked }));
}

/** What the model reads: what the script returned and logged, then how the run went, cut to fit. */
function compose(r: {
  payload: Payload | undefined;
  failedText: string | undefined;
  stop: ScriptStop | undefined;
  seconds: number;
  maxCalls: number;
  calls: number;
  tally: ReadonlyMap<string, { calls: number; failed: number; declined: number }>;
  worked: number;
}): { ok: boolean; text: string; extra: Partial<ScriptRun> } {
  const parts: string[] = [];
  const p = r.payload;
  const error = p?.error;
  if (r.stop) parts.push(STOP_WORDS[r.stop]({ seconds: r.seconds, calls: r.maxCalls }));
  else if (r.failedText) parts.push(`The script couldn’t run: ${r.failedText}`);
  if (error) {
    const where = error.line ? ` at line ${error.line}` : '';
    parts.push(
      error.declined
        ? `The script stopped${where}: the person said no to a ${error.tool ?? 'tool'} call, so it didn’t happen, and the script didn’t catch that. ${error.message}`
        : `The script stopped${where} with ${error.name}: ${error.message}`,
    );
  }
  // What it returned and what it logged share the room: what's left of one goes to the other.
  const room = SCRIPT_LIMITS.resultChars - 1_500;
  const logged = p ? p.said.join('\n').length : 0;
  const valueRoom = Math.max(room - Math.min(logged, room / 3), room / 2);
  if (p?.value !== undefined) {
    const shown = p.value.slice(0, valueRoom);
    const more = (p.valueCut ?? 0) + p.value.length - shown.length;
    parts.push(
      `It returned:\n${shown}${more ? `\n… ${more.toLocaleString('en')} more characters not shown: return less, or only what matters.` : ''}`,
    );
  }
  if (p && p.said.length) {
    const left = room - Math.min(p.value?.length ?? 0, valueRoom);
    const lines: string[] = [];
    let used = 0;
    for (const line of p.said) {
      if (used + line.length + 1 > left) break;
      lines.push(line);
      used += line.length + 1;
    }
    const unsaid = p.unsaid + p.said.length - lines.length;
    parts.push(
      lines.length
        ? `It logged:\n${lines.join('\n')}${unsaid ? `\n… ${unsaid.toLocaleString('en')} more lines not shown.` : ''}`
        : `It logged ${unsaid.toLocaleString('en')} lines, none of which fit.`,
    );
  } else if (p?.unsaid)
    parts.push(`It logged ${p.unsaid.toLocaleString('en')} lines, none of which fit.`);
  if (p && p.value === undefined && !p.said.length && !error)
    parts.push('It returned nothing and logged nothing: return what the person should hear.');
  const tools = [...r.tally]
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 8)
    .map(
      ([tool, n]) =>
        `${tool} ×${n.calls}${n.failed ? ` (${n.failed} failed)` : ''}${n.declined ? ` (${n.declined} not allowed)` : ''}`,
    );
  parts.push(
    `${r.calls.toLocaleString('en')} tool call${r.calls === 1 ? '' : 's'}${tools.length ? `: ${tools.join(', ')}` : ''} · ${(r.worked / 1000).toFixed(1)} s of work.`,
  );
  const ok = !r.stop && !r.failedText && !error;
  const text = cut(parts.join('\n\n'), SCRIPT_LIMITS.resultChars);
  const reason = r.stop
    ? STOP_WORDS[r.stop]({ seconds: r.seconds, calls: r.maxCalls })
    : r.failedText
      ? `The script couldn’t run: ${r.failedText}`
      : error
        ? `${error.line ? `Line ${error.line}: ` : ''}${error.name}: ${error.message}`
        : undefined;
  return {
    ok,
    text,
    extra: {
      ...(r.stop && { stop: r.stop }),
      ...(reason && { error: reason.slice(0, 2_000) }),
    },
  };
}
