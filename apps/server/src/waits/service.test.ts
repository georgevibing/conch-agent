import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WaitNote } from '@conch/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '../conversations/manager';
import type { AppFetcher, AppFetchResponse } from '../conchapps/types';
import type { ProcessPeek } from '../processes/service';

import {
  ciWords,
  fetchClient,
  ghClient,
  readChecks,
  readCiUrl,
  repoOfRemote,
  type GitHubAnswer,
  type GitHubClient,
} from './github';
import { GROWTH, nextGap, span } from './pace';
import { WaitService } from './service';

// ── Fakes ──────────────────────────────────────────────────────────────────

/** A pretend managed command: its output and status, and who's listening. */
function fakeProcesses() {
  const procs = new Map<string, ProcessPeek & { owner: string }>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    add(id: string, owner = 'chat', command = 'pnpm test') {
      procs.set(id, {
        owner,
        command,
        status: 'running',
        exitCode: null,
        output: '',
        start: 0,
        end: 0,
      });
    },
    print(id: string, text: string) {
      const p = procs.get(id);
      if (!p) return;
      p.output += text;
      p.end += text.length;
      for (const l of listeners.get(id) ?? []) l();
    },
    exit(id: string, code: number) {
      const p = procs.get(id);
      if (!p) return;
      p.status = 'exited';
      p.exitCode = code;
      for (const l of listeners.get(id) ?? []) l();
    },
    peek: (owner: string, id: string) => {
      const p = procs.get(id);
      return p && p.owner === owner ? { ...p } : undefined;
    },
    onChange: (id: string, listener: () => void) => {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(listener);
      return () => set.delete(listener);
    },
  };
}

const job = (name: string, status: string, conclusion: string | null = null) => ({
  name,
  status,
  conclusion,
  html_url: `https://github.com/o/conch/actions/runs/7/job/${name}`,
});

/** GitHub, scripted: each look at a path gets the next answer (the last one stays). */
function fakeGitHub(script: Record<string, GitHubAnswer[]>, via: GitHubClient['via'] = 'gh') {
  const calls: string[] = [];
  const client: GitHubClient = {
    via,
    async get(path) {
      calls.push(path);
      const key = Object.keys(script).find((k) => path.startsWith(k));
      const answers = (key && script[key]) || [];
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      return answer ?? { status: 404 };
    },
  };
  return { client, calls };
}

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'conch-waits-'));
});
const services: WaitService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) {
    service.close();
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
    await service.settled();
  }
  vi.useRealTimers();
  await new Promise((r) => setTimeout(r, 20));
  await rm(home, { recursive: true, force: true });
});

function setup(
  options: {
    github?: GitHubClient;
    fetcher?: AppFetcher;
    processes?: ReturnType<typeof fakeProcesses>;
  } = {},
) {
  const notes: WaitNote[] = [];
  const wakes: { id: string; prompt: string }[] = [];
  const told: string[] = [];
  const processes = options.processes ?? fakeProcesses();
  const service: WaitService = new WaitService({
    home,
    processes,
    fetcher: options.fetcher ?? (async () => ({ ok: false, status: 500, headers: {}, body: '' })),
    github: async () => options.github ?? fakeGitHub({}).client,
    git: async (_cwd, args) => {
      if (args.join(' ') === 'remote get-url origin') return 'git@github.com:o/conch.git\n';
      if (args.join(' ') === 'rev-parse HEAD') return 'a'.repeat(40);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'fix-ci';
      return '';
    },
    chat: {
      note: async (_id, event) => void notes.push(event.wait),
      wake: async (id, prompt) => void wakes.push({ id, prompt }),
    },
    tell: async (t) => void told.push(t.title),
    random: () => 0.5,
  });
  services.push(service);
  const turn = (extra: Partial<ToolContext> = {}) => {
    const abort = new AbortController();
    const appended: WaitNote[] = [];
    const ctx: ToolContext = {
      conversationId: 'chat',
      append: (event) => {
        if (event.type === 'wait') appended.push(event.wait);
      },
      engine: {} as never,
      permissionMode: 'default',
      ask: async () => 'allow',
      signal: abort.signal,
      workspace: async () => home,
      ...extra,
    };
    const [tool] = service.tools(ctx);
    if (!tool) throw new Error('wait_for is missing');
    return {
      ctx,
      abort,
      appended,
      call: (args: Record<string, unknown>) => tool.run(args as never) as Promise<string>,
    };
  };
  return { service, notes, wakes, told, processes, turn };
}

// ── Pace ───────────────────────────────────────────────────────────────────

describe('the pace of looking', () => {
  const pace = { base: 15_000, max: 120_000 };
  it('starts soon, widens while nothing changes, and comes back after a change', () => {
    const mid = { random: () => 0.5 };
    let gap = nextGap(pace, undefined, false, mid);
    expect(gap).toBe(15_000);
    gap = nextGap(pace, gap, false, mid);
    expect(gap).toBe(15_000 * GROWTH);
    for (let i = 0; i < 10; i++) gap = nextGap(pace, gap, false, mid);
    expect(gap).toBe(120_000);
    expect(nextGap(pace, gap, true, mid)).toBe(15_000);
  });

  it('jitters a little, and a server’s own hint always wins', () => {
    expect(nextGap(pace, undefined, false, { random: () => 0 })).toBe(12_750);
    expect(nextGap(pace, undefined, false, { random: () => 1 })).toBe(17_250);
    expect(nextGap(pace, undefined, false, { random: () => 0.5, hint: 60_000 })).toBe(60_000);
  });

  it('says a span in words', () => {
    expect(span(40_000)).toBe('40 s');
    expect(span(120_000)).toBe('2 min');
    expect(span(65 * 60_000)).toBe('1 h 5 min');
  });
});

// ── GitHub ─────────────────────────────────────────────────────────────────

describe('reading GitHub', () => {
  it('knows a repository from its remote, and what an address points at', () => {
    expect(repoOfRemote('git@github.com:o/conch.git')).toBe('o/conch');
    expect(repoOfRemote('https://github.com/o/conch')).toBe('o/conch');
    expect(repoOfRemote('https://gitlab.com/o/conch.git')).toBeUndefined();
    expect(readCiUrl('https://github.com/o/conch/actions/runs/123/job/9')).toEqual({
      repo: 'o/conch',
      run: 123,
    });
    expect(readCiUrl('https://github.com/o/conch/pull/482/checks')).toEqual({
      repo: 'o/conch',
      pr: 482,
    });
    expect(readCiUrl('https://evil.example/o/conch/pull/1')).toBeUndefined();
  });

  it('sums checks up the way a person would say it', () => {
    const red = readChecks([
      job('e2e', 'completed', 'failure'),
      job('server unit', 'completed', 'timed_out'),
      job('lint', 'completed', 'success'),
    ]);
    expect(ciWords(red)).toEqual({
      status: 'CI finished: 2 failed — e2e, server unit; 1 passed',
      tone: 'bad',
    });
    const green = readChecks([
      job('lint', 'completed', 'success'),
      job('test', 'completed', 'success'),
    ]);
    expect(ciWords(green)).toEqual({ status: 'CI passed: all 2 checks are green', tone: 'good' });
    const going = readChecks([
      job('lint', 'completed', 'success'),
      job('test', 'in_progress'),
      job('e2e', 'queued'),
    ]);
    expect(going.complete).toBe(false);
    expect(ciWords(going).status).toBe('1 of 3 checks done');
    expect(going.parts.map((p) => p.state)).toEqual(['passed', 'running', 'waiting']);
  });

  it('keeps a check’s latest run only, and cleans its name', () => {
    const r = readChecks([
      job('e2e\u0007\n  x', 'completed', 'success'),
      job('e2e\u0007\n  x', 'completed', 'failure'),
    ]);
    expect(r.parts).toEqual([{ name: 'e2e x', state: 'passed' }]);
  });

  it('asks again with the ETag, and takes GitHub’s own hints about when', async () => {
    const seen: Record<string, string>[] = [];
    const fetcher: AppFetcher = async (_app, request): Promise<AppFetchResponse> => {
      seen.push(request.headers);
      return request.headers['if-none-match']
        ? { ok: false, status: 304, headers: { 'X-Poll-Interval': '60' }, body: '' }
        : { ok: true, status: 200, headers: { ETag: '"v1"' }, body: '{"status":"in_progress"}' };
    };
    const client = fetchClient(fetcher, 'chat', 'github_pat_' + 'x'.repeat(30));
    const first = await client.get('/repos/o/conch/actions/runs/1');
    expect(first).toMatchObject({ status: 200, etag: '"v1"', json: { status: 'in_progress' } });
    const second = await client.get('/repos/o/conch/actions/runs/1', first.etag);
    expect(second).toEqual({ status: 304, waitMs: 60_000 });
    expect(seen[0]?.authorization).toMatch(/^Bearer github_pat_/);
    expect(seen[1]?.['if-none-match']).toBe('"v1"');
  });

  it('waits out a spent hourly limit until it resets', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const fetcher: AppFetcher = async () => ({
      ok: false,
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      body: '{}',
    });
    const answer = await fetchClient(fetcher, 'chat').get('/x');
    expect(answer.waitMs).toBeGreaterThan(590_000);
  });

  it('reads `gh api -i`, a 304 included', async () => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes('If-None-Match: "e"')) throw new Error('gh: HTTP 304');
      return 'HTTP/2.0 200 OK\r\nEtag: "e"\r\nX-Poll-Interval: 30\r\n\r\n{"jobs":[]}';
    });
    const gh = ghClient('/usr/bin/gh', run);
    expect(await gh.get('/repos/o/c/actions/runs/1/jobs')).toEqual({
      status: 200,
      json: { jobs: [] },
      etag: '"e"',
      waitMs: 30_000,
    });
    expect(await gh.get('/repos/o/c/actions/runs/1/jobs', '"e"')).toEqual({ status: 304 });
    expect(run.mock.calls[0]?.[1]).toContain('repos/o/c/actions/runs/1/jobs');
  });
});

// ── The tool ───────────────────────────────────────────────────────────────

describe('wait_for a command', () => {
  it('sleeps until the command exits and says how it went, without anyone polling', async () => {
    const { processes, turn } = setup();
    processes.add('11111111-1111-4111-8111-111111111111');
    const t = turn();
    const result = t.call({ kind: 'process', process_id: '11111111-1111-4111-8111-111111111111' });
    await new Promise((r) => setTimeout(r, 20));
    expect(t.appended.at(-1)).toMatchObject({
      state: 'watching',
      kind: 'process',
      title: '`pnpm test`',
    });
    processes.print('11111111-1111-4111-8111-111111111111', 'ok 1\nFAIL routines.spec.ts\n');
    processes.exit('11111111-1111-4111-8111-111111111111', 1);
    const text = await result;
    expect(text).toMatch(/`pnpm test` failed with exit code 1 after/);
    expect(text).toMatch(/FAIL routines\.spec\.ts/);
    expect(t.appended.at(-1)).toMatchObject({ state: 'done', tone: 'bad' });
    // Live: no clock, so no "next look".
    expect(t.appended.every((n) => n.nextCheckAt === undefined)).toBe(true);
  });

  it('wakes when the command prints what it was waiting for', async () => {
    const { processes, turn } = setup();
    const id = '22222222-2222-4222-8222-222222222222';
    processes.add(id, 'chat', 'pnpm dev');
    const t = turn();
    const result = t.call({ kind: 'process', process_id: id, pattern: 'ready|listening' });
    await new Promise((r) => setTimeout(r, 20));
    processes.print(id, 'compiling…\n  ➜ Local: ready on http://localhost:5173\n');
    await expect(result).resolves.toMatch(/printed a line matching .*ready on http/);
  });

  it('stops when the turn stops', async () => {
    const { processes, turn, service } = setup();
    const id = '33333333-3333-4333-8333-333333333333';
    processes.add(id);
    const t = turn();
    const result = t.call({ kind: 'process', process_id: id });
    await new Promise((r) => setTimeout(r, 20));
    t.abort.abort();
    await expect(result).resolves.toMatch(/the turn was stopped/);
    expect(t.appended.at(-1)).toMatchObject({ state: 'stopped' });
    expect(service.list()).toEqual([]);
  });

  it('won’t watch another chat’s command', async () => {
    const { processes, turn } = setup();
    processes.add('44444444-4444-4444-8444-444444444444', 'someone-else');
    await expect(
      turn().call({ kind: 'process', process_id: '44444444-4444-4444-8444-444444444444' }),
    ).rejects.toThrow(/process_start/);
  });
});

describe('wait_for CI', () => {
  const going = { status: 200, json: { status: 'in_progress' } };
  const runs = (states: GitHubAnswer[], run: GitHubAnswer[] = [going]) => ({
    '/repos/o/conch/actions/runs/7/jobs': states,
    '/repos/o/conch/actions/runs/7': run,
  });

  it('in a task, holds the turn, looks further apart while nothing changes, and calls no model', async () => {
    vi.useFakeTimers();
    const still = {
      status: 200,
      json: { jobs: [job('lint', 'completed', 'success'), job('e2e', 'in_progress')] },
    };
    const { client, calls } = fakeGitHub({
      ...runs(
        [
          still,
          still,
          still,
          still,
          {
            status: 200,
            json: {
              jobs: [job('lint', 'completed', 'success'), job('e2e', 'completed', 'failure')],
            },
          },
        ],
        [going, going, going, going, { status: 200, json: { status: 'completed' } }],
      ),
    });
    const { turn, wakes } = setup({ github: client });
    const t = turn({ unattended: true });
    const result = t.call({ kind: 'ci', url: 'https://github.com/o/conch/actions/runs/7' });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const text = await result;
    expect(text).toMatch(/1 failed — e2e/);
    expect(text).toMatch(/gh run view 7 --repo o\/conch --log-failed/);
    expect(text).toMatch(/e2e: https:\/\/github\.com\//);
    // Two requests a look, five looks: nothing in between.
    expect(calls.length).toBe(10);
    // Gaps between looks widen while nothing changes.
    const gaps = t.appended
      .filter((n) => n.nextCheckAt)
      .map((n, i, all) => (i ? (n.nextCheckAt ?? 0) - (all[i - 1]?.nextCheckAt ?? 0) : 0))
      .slice(1);
    expect(gaps[1] ?? 0).toBeGreaterThan(gaps[0] ?? 0);
    expect(t.appended.at(-1)).toMatchObject({
      state: 'done',
      tone: 'bad',
      parts: [
        { name: 'lint', state: 'passed' },
        { name: 'e2e', state: 'failed' },
      ],
    });
    // A held wait never wakes the chat: its answer is the tool's result.
    expect(wakes).toEqual([]);
  });

  it('in a chat, lets go of the turn and wakes the chat once, with what changed', async () => {
    vi.useFakeTimers();
    const { client, calls } = fakeGitHub({
      [`/repos/o/conch/commits/${'a'.repeat(40)}/check-runs`]: [
        { status: 200, json: { check_runs: [job('lint', 'queued')] } },
        { status: 200, json: { check_runs: [job('lint', 'in_progress')] } },
        { status: 200, json: { check_runs: [job('lint', 'completed', 'success')] } },
      ],
    });
    const { turn, wakes, notes, told, service } = setup({ github: client });
    const t = turn();
    const text = await t.call({ kind: 'ci', tell_me: true });
    expect(text).toMatch(/^Waiting for CI for conch fix-ci/);
    expect(text).toMatch(/End your turn now/);
    expect(wakes).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.length).toBe(3);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.prompt).toMatch(/A wait you started has ended/);
    expect(wakes[0]?.prompt).toMatch(/CI passed: the check is green/);
    expect(notes[0]).toMatchObject({ state: 'watching', wakes: true, tell: true });
    expect(notes.at(-1)).toMatchObject({ state: 'done', tone: 'good' });
    expect(told).toEqual(['CI for conch fix-ci is done']);
    // Nothing is left to pick up after a restart.
    await service.settled();
    expect(JSON.parse(await readFile(join(home, 'waits.json'), 'utf8'))).toEqual({ waits: [] });
  });

  it('answers at once when CI is already over', async () => {
    const { client } = fakeGitHub({
      '/repos/o/conch/pulls/482': [{ status: 200, json: { head: { sha: 'b'.repeat(40) } } }],
      '/repos/o/conch/commits/': [
        { status: 200, json: { check_runs: [job('lint', 'completed', 'success')] } },
      ],
    });
    const { turn, wakes, service } = setup({ github: client });
    await expect(turn().call({ kind: 'ci', repo: 'o/conch', ref: '#482' })).resolves.toMatch(
      /CI passed/,
    );
    expect(wakes).toEqual([]);
    expect(service.list()).toEqual([]);
  });

  it('Stop waiting ends it without waking anyone', async () => {
    vi.useFakeTimers();
    const { client } = fakeGitHub(
      runs([{ status: 200, json: { jobs: [job('e2e', 'in_progress')] } }]),
    );
    const { turn, wakes, notes, service } = setup({ github: client });
    await turn().call({ kind: 'ci', url: 'https://github.com/o/conch/actions/runs/7' });
    const waitId = notes[0]?.waitId ?? '';
    expect(service.check('chat', waitId)).toBe(true);
    expect(service.stop('other-chat', waitId)).toBe(false);
    expect(service.stop('chat', waitId)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(notes.at(-1)).toMatchObject({ state: 'stopped', status: 'You stopped waiting' });
    expect(wakes).toEqual([]);
  });

  it('gives up at the deadline, and says so to the model', async () => {
    vi.useFakeTimers();
    const { client } = fakeGitHub(
      runs([{ status: 200, json: { jobs: [job('e2e', 'in_progress')] } }]),
    );
    const { turn, wakes } = setup({ github: client });
    await turn().call({
      kind: 'ci',
      url: 'https://github.com/o/conch/actions/runs/7',
      timeout_minutes: 5,
    });
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.prompt).toMatch(/Stopped waiting for CI for conch run 7 after 5 min/);
    expect(wakes[0]?.prompt).toMatch(/longer timeout_minutes/);
  });

  it('a private repository it can’t see is said once, as something to do', async () => {
    const { client } = fakeGitHub({ '/repos/o/conch/actions/runs/7': [{ status: 404 }] });
    const { turn } = setup({ github: client });
    await expect(
      turn().call({ kind: 'ci', url: 'https://github.com/o/conch/actions/runs/7' }),
    ).rejects.toThrow(/gh auth login/);
  });

  it('picks up a wait that outlived its turn after a restart', async () => {
    vi.useFakeTimers();
    await writeFile(
      join(home, 'waits.json'),
      JSON.stringify({
        waits: [
          {
            waitId: 'wait_1',
            conversationId: 'chat',
            spec: { kind: 'ci', target: { repo: 'o/conch', run: 7, label: 'run 7' } },
            startedAt: Date.now(),
            deadline: Date.now() + 3_600_000,
          },
        ],
      }),
    );
    const { client } = fakeGitHub(
      runs([{ status: 200, json: { jobs: [job('e2e', 'completed', 'success')] } }]),
    );
    const { service, wakes } = setup({ github: client });
    // The run says it's still going; its jobs say done: the run's word counts.
    expect(await service.start()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(service.list()).toHaveLength(1);
    service.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(wakes).toEqual([]);
    // Closing keeps it for the next start.
    expect(JSON.parse(await readFile(join(home, 'waits.json'), 'utf8')).waits).toHaveLength(1);
  });

  it('at most four waits in one chat', async () => {
    vi.useFakeTimers();
    const { client } = fakeGitHub({
      '/repos/o/conch/actions/runs/': [
        { status: 200, json: { status: 'in_progress', jobs: [job('e2e', 'in_progress')] } },
      ],
    });
    const { turn } = setup({ github: client });
    for (const run of [1, 2, 3, 4])
      await turn().call({ kind: 'ci', url: `https://github.com/o/conch/actions/runs/${run}` });
    await expect(
      turn().call({ kind: 'ci', url: 'https://github.com/o/conch/actions/runs/5' }),
    ).rejects.toThrow(/already waits for 4/);
    // The same thing again is the same wait.
    await expect(
      turn().call({ kind: 'ci', url: 'https://github.com/o/conch/actions/runs/1' }),
    ).resolves.toMatch(/Already waiting/);
  });
});

describe('wait_for a page and a time', () => {
  it('wakes when the page changes, asking with its ETag between', async () => {
    vi.useFakeTimers();
    let version = 1;
    const seen: (string | undefined)[] = [];
    const fetcher: AppFetcher = async (app, request): Promise<AppFetchResponse> => {
      expect(app.reaches).toEqual(['status.example.com']);
      seen.push(request.headers['if-none-match']);
      if (request.headers['if-none-match'] === `"${version}"`)
        return { ok: false, status: 304, headers: {}, body: '' };
      return {
        ok: true,
        status: 200,
        headers: { etag: `"${version}"`, 'content-type': 'text/html' },
        body: `<p>Deploy ${version === 1 ? 'running' : 'done'}</p>`,
      };
    };
    const { turn, wakes } = setup({ fetcher });
    const text = await turn().call({ kind: 'url', url: 'https://status.example.com/deploy' });
    expect(text).toMatch(/Waiting for status\.example\.com\/deploy/);
    await vi.advanceTimersByTimeAsync(31_000);
    version = 2;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(seen).toContain('"1"');
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.prompt).toMatch(/now reads: “Deploy done”/);
  });

  it('a time a minute away is held in the turn; one an hour away lets go', async () => {
    vi.useFakeTimers();
    const { turn, wakes } = setup();
    const soon = turn().call({ kind: 'time', minutes: 1 });
    await vi.advanceTimersByTimeAsync(61_000);
    await expect(soon).resolves.toMatch(/the time you were waiting for/);
    await expect(turn().call({ kind: 'time', minutes: 60 })).resolves.toMatch(/End your turn now/);
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 1000);
    expect(wakes).toHaveLength(1);
  });

  it('a chat app or a routine never lets go: nobody would be woken', async () => {
    vi.useFakeTimers();
    const { turn, wakes } = setup();
    const held = turn({ origin: { kind: 'routine' } as never }).call({ kind: 'time', minutes: 10 });
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1000);
    await expect(held).resolves.toMatch(/the time you were waiting for/);
    expect(wakes).toEqual([]);
  });
});

describe('Repair', () => {
  it('stops waits whose chats are gone', async () => {
    vi.useFakeTimers();
    const { turn, service } = setup();
    await turn().call({ kind: 'time', minutes: 30 });
    const check = service.doctorCheck(async () => false);
    expect(
      (await check.run({ repair: false, signal: new AbortController().signal }))[0],
    ).toMatchObject({
      state: 'warning',
      repairable: true,
    });
    expect(
      (await check.run({ repair: true, signal: new AbortController().signal }))[0],
    ).toMatchObject({ state: 'fixed' });
    await vi.advanceTimersByTimeAsync(10);
    expect(service.list()).toEqual([]);
  });
});
