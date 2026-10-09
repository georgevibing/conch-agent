/**
 * The things a wait can watch (ADR 0125), each as a `Watcher`: one cheap look
 * that says where it stands. None of them calls a model. The service decides
 * when to look (`pace.ts`), what to show, and when to wake the assistant.
 */
import { createHash } from 'node:crypto';

import type { WaitKind, WaitPart } from '@conch/protocol';

import type { AppFetcher } from '../conchapps/types';
import type { ProcessPeek } from '../processes/service';

import { ciWords, readChecks, type CiTarget, type GitHubClient } from './github';
import type { Pace } from './pace';
import { span } from './pace';

/** What one look found. */
export interface Reading {
  /** It's over: the command exited, CI finished, the page changed, the time came. */
  settled: boolean;
  tone?: 'good' | 'bad' | 'neutral';
  /** A few words for the row: "4 of 7 checks done". */
  status: string;
  parts?: WaitPart[];
  url?: string;
  /** What the assistant reads when it ends: the outcome, and where to look next. */
  summary?: string;
  /** Don't look again before this (a server's own hint), in ms. */
  hintMs?: number;
  /** This look didn't work, but the next may (a blip, a limit). */
  blip?: string;
  /** It can't be watched at all: one sentence the model can act on. */
  fatal?: string;
}

export interface Watcher {
  kind: WaitKind;
  /** What it waits for, in a few words. */
  title: string;
  url?: string;
  pace: Pace;
  /** When it's due by itself (a time): the service sleeps till then. */
  dueAt?: number;
  /** It watches live (a command prints): looks happen when it says so, not on a clock. */
  live?: boolean;
  look(signal: AbortSignal): Promise<Reading>;
  /** Tells the service something may have changed, for a live watcher. Returns how to stop. */
  nudge?(listener: () => void): () => void;
}

// ── A command this chat started ──────────────────────────────────────────────

function lastLines(text: string, lines = 15, chars = 1500): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim())
    .slice(-lines)
    .join('\n')
    .slice(-chars);
}

function shortCommand(command: string): string {
  const one = command.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 57)}…` : one;
}

export function processWatcher(options: {
  id: string;
  owner: string;
  pattern?: RegExp;
  peek: (owner: string, id: string) => ProcessPeek | undefined;
  onChange: (id: string, listener: () => void) => () => void;
  now?: () => number;
}): Watcher {
  const now = options.now ?? Date.now;
  const first = options.peek(options.owner, options.id);
  if (!first)
    throw new Error('That command isn’t one this chat started. Start it with process_start first.');
  const title = shortCommand(first.command);
  const named = `\`${title}\``;
  const started = now();
  return {
    kind: 'process',
    title,
    pace: { base: 5000, max: 5000 },
    live: true,
    nudge: (listener) => options.onChange(options.id, listener),
    async look() {
      const p = options.peek(options.owner, options.id);
      if (!p)
        return {
          settled: true,
          tone: 'neutral',
          status: 'The command is gone',
          summary: `${named} is no longer there to watch.`,
        };
      if (options.pattern) {
        // Everything it kept, from the start: a server that was ready before the wait began is ready.
        const line = p.output
          .replace(/\r/g, '')
          .split('\n')
          .find((l) => options.pattern?.test(l));
        if (line !== undefined) {
          const shown = line.trim().slice(0, 200);
          return {
            settled: true,
            tone: 'good',
            status: `Printed “${shown.slice(0, 80)}”`,
            summary: `${named} printed a line matching /${options.pattern.source}/: “${shown}”. It is ${p.status === 'running' ? 'still running' : p.status}.`,
          };
        }
      }
      if (p.status === 'queued')
        return {
          settled: false,
          status: p.reason ? `Waiting to start: ${p.reason}` : 'Waiting to start',
        };
      if (p.status === 'running') return { settled: false, status: 'Running' };
      const took = span(now() - started);
      const tail = lastLines(p.output);
      const how =
        p.status === 'exited'
          ? p.exitCode === 0
            ? 'finished'
            : `failed with exit code ${p.exitCode ?? '?'}`
          : p.status === 'timed-out'
            ? 'hit its time limit'
            : 'was stopped';
      return {
        settled: true,
        tone: p.status === 'exited' && p.exitCode === 0 ? 'good' : 'bad',
        status: `${how.charAt(0).toUpperCase()}${how.slice(1)} after ${took}`,
        summary: `${named} ${how} after ${took}.${tail ? `\nLast lines:\n${tail}` : ''}${p.reason ? `\n${p.reason}` : ''}`,
      };
    },
  };
}

// ── CI on GitHub ─────────────────────────────────────────────────────────────

/** How often each way of reading may look: the public API's 60 an hour is slow on purpose. */
const CI_PACE: Record<GitHubClient['via'], Pace> = {
  gh: { base: 15_000, max: 120_000 },
  token: { base: 15_000, max: 120_000 },
  public: { base: 90_000, max: 300_000 },
};

/** Ten minutes with no check at all: no CI is coming for this commit. */
export const NO_CHECKS_MS = 10 * 60_000;

export function ciWatcher(options: {
  target: CiTarget;
  client: GitHubClient;
  /** Wake at the first failure instead of when everything's done. */
  failFast?: boolean;
  now?: () => number;
}): Watcher {
  const { target, client } = options;
  const now = options.now ?? Date.now;
  const started = now();
  const etags = new Map<string, { etag: string; json: unknown }>();
  const get = async (path: string, signal: AbortSignal) => {
    const cached = etags.get(path);
    const answer = await client.get(path, cached?.etag, signal);
    if (answer.status === 304 && cached) return { ...answer, status: 200, json: cached.json };
    if (answer.status === 200 && answer.etag && answer.json !== undefined)
      etags.set(path, { etag: answer.etag, json: answer.json });
    return answer;
  };
  const title = `CI for ${target.repo.split('/')[1] ?? target.repo} ${target.label}`;
  const runUrl = target.run
    ? `https://github.com/${target.repo}/actions/runs/${target.run}`
    : undefined;
  const commitUrl = target.sha
    ? `https://github.com/${target.repo}/commit/${target.sha}`
    : undefined;
  return {
    kind: 'ci',
    title,
    ...((runUrl ?? commitUrl) && { url: runUrl ?? commitUrl }),
    pace: CI_PACE[client.via],
    async look(signal) {
      let reading;
      let hint: number | undefined;
      const failedAnswer = (status: number, waitMs?: number): Reading | undefined => {
        if (status === 200) return undefined;
        if (status === 401)
          return {
            settled: false,
            status: '',
            fatal:
              'GitHub refused the sign-in. Sign in again with `gh auth login`, or reconnect GitHub in Apps.',
          };
        if (status === 404)
          return {
            settled: false,
            status: '',
            fatal: `GitHub doesn’t show ${target.repo} to Conch: it’s private, or the name is wrong. Sign in with \`gh auth login\`, or connect GitHub in Apps with access to it.`,
          };
        return {
          settled: false,
          status: '',
          blip: `GitHub answered ${status || 'nothing'}`,
          ...(waitMs && { hintMs: waitMs }),
        };
      };
      if (target.run) {
        const base = `/repos/${target.repo}/actions/runs/${target.run}`;
        const run = await get(base, signal);
        const bad = failedAnswer(run.status, run.waitMs);
        if (bad) return bad;
        const jobs = await get(`${base}/jobs?per_page=100&filter=latest`, signal);
        hint = Math.max(run.waitMs ?? 0, jobs.waitMs ?? 0) || undefined;
        const badJobs = failedAnswer(jobs.status, jobs.waitMs);
        if (badJobs) return badJobs;
        const r = (run.json ?? {}) as { status?: unknown; html_url?: unknown };
        const list = ((jobs.json ?? {}) as { jobs?: unknown }).jobs;
        reading = readChecks(Array.isArray(list) ? list : [], r.status === 'completed');
      } else {
        const path = `/repos/${target.repo}/commits/${target.sha}/check-runs?per_page=100&filter=latest`;
        const answer = await get(path, signal);
        hint = answer.waitMs;
        const bad = failedAnswer(answer.status, answer.waitMs);
        if (bad) return bad;
        const list = ((answer.json ?? {}) as { check_runs?: unknown }).check_runs;
        reading = readChecks(Array.isArray(list) ? list : []);
        if (!reading.parts.length && now() - started >= NO_CHECKS_MS)
          return {
            settled: true,
            tone: 'neutral',
            status: 'No CI ran for this commit',
            summary: `No checks started on ${target.repo} ${target.label} in ${span(NO_CHECKS_MS)}. CI may not run for this branch, or it needs approval on GitHub.`,
            ...(commitUrl && { url: commitUrl }),
          };
      }
      const words = ciWords(reading);
      const failedNow = reading.parts.some((p) => p.state === 'failed');
      const settled = reading.complete || (Boolean(options.failFast) && failedNow);
      const links = reading.failedLinks
        .slice(0, 8)
        .map((f) => `- ${f.name}${f.url ? `: ${f.url}` : ''}`)
        .join('\n');
      return {
        settled,
        ...(settled && { tone: words.tone ?? (failedNow ? 'bad' : 'neutral') }),
        status:
          settled && !reading.complete
            ? `A check failed: ${reading.failedLinks
                .map((f) => f.name)
                .slice(0, 3)
                .join(', ')}`
            : words.status,
        parts: reading.parts.slice(0, 40),
        ...((runUrl ?? commitUrl) && { url: runUrl ?? commitUrl }),
        ...(hint && { hintMs: hint }),
        ...(settled && {
          summary: [
            `${settled && !reading.complete ? `A check failed on ${target.repo} ${target.label} while others still run.` : words.status} (${target.repo} ${target.label}).`,
            links && `Failed:\n${links}`,
            runUrl
              ? `Read the failing logs with \`gh run view ${target.run} --repo ${target.repo} --log-failed\`.`
              : target.sha
                ? `Read the failing logs with \`gh run list --repo ${target.repo} --commit ${target.sha}\`, then \`gh run view <id> --log-failed\`.`
                : '',
          ]
            .filter(Boolean)
            .join('\n'),
        }),
      };
    },
  };
}

// ── A page ───────────────────────────────────────────────────────────────────

function textOf(body: string, type: string): string {
  const html = /html/i.test(type) || /^\s*<!doctype html|^\s*<html/i.test(body);
  const text = html
    ? body
        .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
    : body;
  return text.replace(/\s+/g, ' ').trim();
}

export function urlWatcher(options: {
  url: URL;
  owner: string;
  fetcher: AppFetcher;
  /** Wait until the page says this; unset, until it changes at all. */
  contains?: string;
}): Watcher {
  const { url, fetcher } = options;
  let etag: string | undefined;
  let modified: string | undefined;
  let firstHash: string | undefined;
  let lastText = '';
  const title = `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`.slice(0, 120);
  return {
    kind: 'url',
    title,
    url: url.href,
    pace: { base: 30_000, max: 300_000 },
    async look(signal) {
      const response = await fetcher(
        { id: `wait-${options.owner}`, reaches: [url.hostname], perHour: 120 },
        {
          url: url.href,
          method: 'GET',
          headers: {
            accept: 'text/html, application/json, text/plain',
            ...(etag && { 'if-none-match': etag }),
            ...(modified && { 'if-modified-since': modified }),
          },
        },
        signal,
      );
      if (response.refused) return { settled: false, status: '', fatal: response.refused };
      const headers = Object.fromEntries(
        Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v]),
      );
      const retry = Number(headers['retry-after']);
      const hintMs = Number.isFinite(retry) && retry > 0 ? retry * 1000 : undefined;
      if (response.status === 304)
        return { settled: false, status: 'No change yet', ...(hintMs && { hintMs }) };
      if (!response.ok && response.status >= 500)
        return {
          settled: false,
          status: '',
          blip: `The site answered ${response.status}`,
          ...(hintMs && { hintMs }),
        };
      etag = headers.etag;
      modified = headers['last-modified'];
      const text = response.bodyBase64 ? '' : textOf(response.body, headers['content-type'] ?? '');
      const hash = createHash('sha256').update(`${response.status}\n${text}`).digest('hex');
      const said = text.slice(0, 400);
      if (options.contains) {
        const found = text.toLowerCase().includes(options.contains.toLowerCase());
        lastText = text;
        return found
          ? {
              settled: true,
              tone: 'good',
              status: `It says “${options.contains.slice(0, 60)}”`,
              summary: `${url.href} now says “${options.contains}”. It reads: “${said}”`,
            }
          : { settled: false, status: `Not yet “${options.contains.slice(0, 60)}”` };
      }
      if (firstHash === undefined) {
        firstHash = hash;
        lastText = text;
        return { settled: false, status: 'Watching for a change' };
      }
      if (hash === firstHash) return { settled: false, status: 'No change yet' };
      const before = lastText.slice(0, 200);
      return {
        settled: true,
        tone: 'neutral',
        status: 'The page changed',
        summary: `${url.href} changed${response.ok ? '' : ` (it answered ${response.status})`}. It now reads: “${said}”${before ? `\nBefore, it read: “${before}”` : ''}`,
      };
    },
  };
}

// ── A time ───────────────────────────────────────────────────────────────────

export function clockWords(at: number): string {
  return new Date(at)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(' AM', ' am')
    .replace(' PM', ' pm');
}

export function timeWatcher(options: { at: number; now?: () => number }): Watcher {
  const now = options.now ?? Date.now;
  const title = clockWords(options.at);
  return {
    kind: 'time',
    title,
    dueAt: options.at,
    pace: { base: 60_000, max: 60_000 },
    async look() {
      const left = options.at - now();
      if (left > 500) return { settled: false, status: `In ${span(left)}` };
      return {
        settled: true,
        tone: 'neutral',
        status: `It’s ${title}`,
        summary: `It’s ${title}, the time you were waiting for.`,
      };
    },
  };
}
