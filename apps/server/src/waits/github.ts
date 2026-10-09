/**
 * Reading CI on GitHub for a wait (ADR 0125), the cheapest way there is:
 *
 * - GitHub's own program (`gh api`), when it's installed and signed in: the
 *   person's own sign-in, which Conch never sees;
 * - else the token of the GitHub app the person connected in Apps, with
 *   conditional requests (an unchanged answer is a 304, which GitHub doesn't
 *   count against the hourly limit);
 * - else GitHub's public API, for a public repository, looked at slowly
 *   (60 requests an hour per address).
 *
 * The answers are only states and names: no logs, no code. The model reads
 * those itself, when it wakes, with the tools it already has.
 */
import { execFile } from 'node:child_process';

import type { WaitPart, WaitPartState } from '@conch/protocol';

import type { AppFetcher } from '../conchapps/types';

/** One answer from GitHub's REST API. */
export interface GitHubAnswer {
  status: number;
  json?: unknown;
  etag?: string;
  /** Don't ask again before this many ms (`x-poll-interval`, `retry-after`, the limit's reset). */
  waitMs?: number;
}

export interface GitHubClient {
  /** Which way it reads: says how often it may look. */
  via: 'gh' | 'token' | 'public';
  get(path: string, etag?: string, signal?: AbortSignal): Promise<GitHubAnswer>;
}

const API = 'https://api.github.com';

function hintOf(headers: Record<string, string>, status: number, now: number): number | undefined {
  const poll = Number(headers['x-poll-interval']);
  const retry = Number(headers['retry-after']);
  const hints: number[] = [];
  if (Number.isFinite(poll) && poll > 0) hints.push(poll * 1000);
  if (Number.isFinite(retry) && retry > 0) hints.push(retry * 1000);
  if ((status === 403 || status === 429) && headers['x-ratelimit-remaining'] === '0') {
    const reset = Number(headers['x-ratelimit-reset']) * 1000;
    if (Number.isFinite(reset) && reset > now) hints.push(reset - now);
  }
  return hints.length ? Math.max(...hints) : undefined;
}

function lower(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

/** The REST API through the gateway's guarded fetch: a token, or nobody's. */
export function fetchClient(
  fetcher: AppFetcher,
  owner: string,
  token?: string,
  now: () => number = Date.now,
): GitHubClient {
  return {
    via: token ? 'token' : 'public',
    async get(path, etag, signal) {
      const response = await fetcher(
        { id: `wait-${owner}`, reaches: ['api.github.com'], perHour: token ? 600 : 60 },
        {
          url: `${API}${path}`,
          method: 'GET',
          headers: {
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            ...(token && { authorization: `Bearer ${token}` }),
            ...(etag && { 'if-none-match': etag }),
          },
        },
        signal ?? new AbortController().signal,
      );
      if (response.refused) throw new Error(response.refused);
      const headers = lower(response.headers);
      let json: unknown;
      if (response.status !== 304 && response.body && !response.bodyBase64) {
        try {
          json = JSON.parse(response.body);
        } catch {
          json = undefined;
        }
      }
      const waitMs = hintOf(headers, response.status, now());
      return {
        status: response.status,
        ...(json !== undefined && { json }),
        ...(headers.etag && { etag: headers.etag }),
        ...(waitMs !== undefined && { waitMs }),
      };
    },
  };
}

/** Runs a program and gives back what it printed; rejects with its words when it fails. */
export type Run = (
  file: string,
  args: readonly string[],
  options: { cwd?: string; signal?: AbortSignal },
) => Promise<string>;

export const realRun: Run = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        ...(options.cwd && { cwd: options.cwd }),
        ...(options.signal && { signal: options.signal }),
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
      },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              String(stderr || error.message)
                .trim()
                .slice(0, 400),
            ),
          );
        else resolve(String(stdout));
      },
    );
  });

/** GitHub's own program: `gh api -i`, so the status and headers come back too. */
export function ghClient(
  gh: string,
  run: Run = realRun,
  now: () => number = Date.now,
): GitHubClient {
  return {
    via: 'gh',
    async get(path, etag, signal) {
      let text: string;
      try {
        text = await run(
          gh,
          [
            'api',
            '-i',
            '-H',
            'Accept: application/vnd.github+json',
            ...(etag ? ['-H', `If-None-Match: ${etag}`] : []),
            path.replace(/^\//, ''),
          ],
          { ...(signal && { signal }) },
        );
      } catch (error) {
        // `gh api` fails on any status from 300 up; a 304 is an answer, not a failure.
        const words = (error as Error).message;
        if (/HTTP 304/.test(words)) return { status: 304 };
        const status = Number(/HTTP (\d{3})/.exec(words)?.[1] ?? 0);
        if (status) return { status };
        throw error;
      }
      const split = text.indexOf('\r\n\r\n') >= 0 ? '\r\n\r\n' : '\n\n';
      const at = text.indexOf(split);
      const head = at >= 0 ? text.slice(0, at) : '';
      const body = at >= 0 ? text.slice(at + split.length) : text;
      const lines = head.split(/\r?\n/);
      const status = Number(/HTTP\/[\d.]+ (\d{3})/.exec(lines[0] ?? '')?.[1] ?? 200);
      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const colon = line.indexOf(':');
        if (colon > 0)
          headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
      }
      let json: unknown;
      try {
        json = body.trim() ? JSON.parse(body) : undefined;
      } catch {
        json = undefined;
      }
      const waitMs = hintOf(headers, status, now());
      return {
        status,
        ...(json !== undefined && { json }),
        ...(headers.etag && { etag: headers.etag }),
        ...(waitMs !== undefined && { waitMs }),
      };
    },
  };
}

// ── What to watch ────────────────────────────────────────────────────────────

/** A repository and the CI to watch in it: one run, or every check on one commit. */
export interface CiTarget {
  repo: string;
  run?: number;
  sha?: string;
  /** For words: "#482", "main", "a1b2c3d". */
  label: string;
}

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** `owner/name` from a remote's address (https or ssh), when it's GitHub's. */
export function repoOfRemote(remote: string): string | undefined {
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(
      remote.trim(),
    );
  const repo = m?.[1];
  return repo && REPO.test(repo) ? repo : undefined;
}

/** What a GitHub address points at: a run (`/actions/runs/1`), a pull request, or a commit. */
export function readCiUrl(
  raw: string,
): { repo: string; run?: number; pr?: number; sha?: string } | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return undefined;
  const parts = url.pathname.split('/').filter(Boolean);
  const repo = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : '';
  if (!REPO.test(repo)) return undefined;
  const [, , kind, id, more] = parts;
  if (kind === 'actions' && id === 'runs' && more && /^\d+$/.test(more))
    return { repo, run: Number(more) };
  if (kind === 'pull' && id && /^\d+$/.test(id)) return { repo, pr: Number(id) };
  if (kind === 'commit' && id && /^[0-9a-f]{7,40}$/i.test(id)) return { repo, sha: id };
  return undefined;
}

export const isRepo = (repo: string): boolean => REPO.test(repo);

// ── Reading it ───────────────────────────────────────────────────────────────

interface CheckLike {
  name?: unknown;
  status?: unknown;
  conclusion?: unknown;
  html_url?: unknown;
}

const FAILED = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
  'stale',
]);

export function partState(check: CheckLike): WaitPartState {
  const status = String(check.status ?? '');
  if (status !== 'completed') return status === 'in_progress' ? 'running' : 'waiting';
  const conclusion = String(check.conclusion ?? '');
  if (conclusion === 'success') return 'passed';
  if (conclusion === 'neutral' || conclusion === 'skipped') return 'skipped';
  return FAILED.has(conclusion) ? 'failed' : 'skipped';
}

function cleanName(name: unknown): string {
  const text =
    typeof name === 'string'
      ? name
          // eslint-disable-next-line no-control-regex -- control characters are what it strips
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  return (text || 'A check').slice(0, 120);
}

export interface CiReading {
  parts: WaitPart[];
  /** Links to each failed part, for the model. */
  failedLinks: { name: string; url?: string }[];
  /** The run itself is completed (a run), else every check is. */
  complete: boolean;
  url?: string;
}

/** A run's jobs, or a commit's check runs, as parts. */
export function readChecks(list: readonly CheckLike[], complete?: boolean): CiReading {
  // A check re-run keeps its name: the latest one (GitHub lists newest first) counts.
  const seen = new Set<string>();
  const parts: WaitPart[] = [];
  const failedLinks: { name: string; url?: string }[] = [];
  for (const check of list) {
    const name = cleanName(check.name);
    if (seen.has(name)) continue;
    seen.add(name);
    const state = partState(check);
    parts.push({ name, state });
    if (state === 'failed')
      failedLinks.push({
        name,
        ...(typeof check.html_url === 'string' &&
          check.html_url.startsWith('https://github.com/') && { url: check.html_url }),
      });
  }
  const done = parts.every((p) => p.state !== 'waiting' && p.state !== 'running');
  return { parts, failedLinks, complete: complete ?? (parts.length > 0 && done) };
}

/** "CI finished: 2 failed — e2e, server unit; 5 passed" and its kin. */
export function ciWords(reading: CiReading): { status: string; tone?: 'good' | 'bad' | 'neutral' } {
  const n = (state: WaitPartState) => reading.parts.filter((p) => p.state === state).length;
  const total = reading.parts.length;
  const failed = reading.parts.filter((p) => p.state === 'failed');
  const passed = n('passed');
  if (!total) return { status: reading.complete ? 'CI finished with no checks' : 'No checks yet' };
  const names = (list: WaitPart[]) =>
    list
      .slice(0, 4)
      .map((p) => p.name)
      .join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '');
  if (reading.complete) {
    if (failed.length)
      return {
        status: `CI finished: ${failed.length} failed — ${names(failed)}${passed ? `; ${passed} passed` : ''}`,
        tone: 'bad',
      };
    return {
      status: passed
        ? `CI passed: ${total === 1 ? 'the check is' : `all ${total} checks are`} green`
        : 'CI finished: every check was skipped',
      tone: passed ? 'good' : 'neutral',
    };
  }
  const done = total - n('waiting') - n('running');
  return {
    status: `${done} of ${total} checks done${failed.length ? ` · ${failed.length} failed — ${names(failed)}` : ''}`,
  };
}
