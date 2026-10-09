import { currentTimeTool } from '../../lib/time-tool';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { deviceSealer, registerSealer, unregisterSealer } from '../../lib/sealed';
import { ProviderKeys } from '../../providers/keys';
import { SettingsStore } from '../../settings/store';
import { fakeCodexApp } from '../../test/fakeCodexApp';
import type { LoginState } from '@conch/protocol';
import type { EngineEvent, TurnInput } from '../types';
import { CodexEngine, codexPlan, codexProblem, codexUsage, escapes } from './app-engine';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const homes: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const home of homes.splice(0)) unregisterSealer(home);
});
async function setup(options: Parameters<typeof fakeCodexApp>[0] = {}) {
  const fake = await fakeCodexApp(options);
  const home = await mkdtemp(join(tmpdir(), 'conch-owned-'));
  homes.push(home);
  registerSealer(
    home,
    deviceSealer(async () => Buffer.alloc(32, 1)),
  );
  const settings = new SettingsStore(home);
  const engine = new CodexEngine(settings, new ProviderKeys(settings), fake.bin);
  const turn = (overrides: Partial<TurnInput> = {}): TurnInput => ({
    conversationId: 'c1',
    prompt: 'Help',
    systemAppend: 'Conch',
    cwd: home,
    tools: [],
    signal: new AbortController().signal,
    requestPermission: async () => 'allow',
    options: { effort: 'auto', fastMode: false, permissionMode: 'default' },
    ...overrides,
  });
  return { fake, home, engine, turn };
}
async function collect(stream: AsyncIterable<EngineEvent>) {
  const events: EngineEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
async function login(engine: CodexEngine) {
  const states: LoginState[] = [];
  await new Promise<void>((done) =>
    engine.login('subscription', (state) => {
      states.push(state);
      if (['done', 'failed', 'cancelled'].includes(state.phase)) done();
    }),
  );
  return states;
}

describe('why a Codex turn failed', () => {
  it('reads a refused connection by its status, so the chat offers the right next step', () => {
    expect(codexProblem('unauthorized')).toBe('signed-out');
    expect(codexProblem({ responseStreamDisconnected: { httpStatusCode: 401 } })).toBe(
      'signed-out',
    );
    expect(codexProblem({ responseStreamDisconnected: { httpStatusCode: 429 } })).toBe('limit');
    expect(codexProblem({ responseStreamDisconnected: { httpStatusCode: 502 } })).toBe(
      'unavailable',
    );
    expect(codexProblem('usageLimitExceeded')).toBe('limit');
    expect(codexProblem(undefined)).toBeUndefined();
  });
});

describe('how much of the ChatGPT plan is left', () => {
  it('reads the five-hour session and the week, as the usage meter shows them', async () => {
    const { engine } = await setup({ signedIn: true });
    expect(await engine.usage()).toEqual({
      kind: 'plan',
      source: 'ChatGPT Plus',
      windows: [
        {
          id: 'session',
          label: 'Current session',
          usedPercent: 85,
          resetsAt: 1791140000_000,
          severity: 'warning',
        },
        {
          id: 'weekly',
          label: 'This week',
          usedPercent: 20,
          resetsAt: 1791600000_000,
          severity: 'normal',
        },
      ],
    });
  });
  it('says so when Codex reports no windows, and takes the update a turn sends', () => {
    expect(codexUsage({ rateLimits: { primary: null, secondary: null } }, 'Codex')).toMatchObject({
      kind: 'unknown',
      source: 'Codex',
    });
    expect(
      codexUsage(
        { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300 }, planType: 'pro' } },
        'Codex',
      ),
    ).toMatchObject({
      kind: 'plan',
      source: 'ChatGPT Pro',
      windows: [{ id: 'session', usedPercent: 100, severity: 'exhausted' }],
    });
  });
});

describe('Codex app-server parity', () => {
  it('keeps JSON tool events intact while resource feedback reaches the model separately', async () => {
    const { engine, turn, fake } = await setup({
      signedIn: true,
      tool: 'conch__observe',
      args: {},
    });
    const raw = '{"status":"exited","exitCode":0}';
    const run = vi.fn(async () => raw);
    const events = await collect(
      engine.runTurn(
        turn({
          resourceFeedback: () => '[Conch resource update: wait]',
          tools: [{ name: 'observe', description: 'Observe', input: {}, run }],
        }),
      ),
    );
    expect(run).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      type: 'tool-end',
      toolUseId: 'tool1',
      status: 'success',
      output: raw,
    });
    expect((await fake.calls()).find((c) => c.id === 'call1')?.result).toMatchObject({
      success: true,
      contentItems: [
        { type: 'inputText', text: raw },
        { type: 'inputText', text: '[Conch resource update: wait]' },
      ],
    });
  });
  it('does not borrow ambient sign-ins or secret environment variables', async () => {
    vi.stubEnv('CODEX_HOME', '/not-conch');
    vi.stubEnv('OPENAI_API_KEY', 'must-not-leak');
    vi.stubEnv('OP_SERVICE_ACCOUNT_TOKEN', 'must-not-leak');
    const { engine, fake, home } = await setup();
    expect((await engine.detect()).state).toBe('signed-out');
    const spawned = (await fake.calls()).find((c) => c.spawn);
    expect(spawned?.secretLeaked).toBe(false);
    expect(String(spawned?.home)).toContain(home);
    expect(await readdir(join(home, 'codex-runtime'))).toEqual([]);
  });
  it('signs in remotely without a key, seals tokens, verifies the account, then disconnects', async () => {
    const { engine, home } = await setup();
    const states = await login(engine);
    expect(states.find((s) => s.phase === 'waiting-for-browser')).toMatchObject({
      url: 'https://auth.openai.com/codex/device',
      code: 'TEST-1234',
    });
    expect(states.at(-1)?.phase).toBe('done');
    const disk = await readFile(join(home, 'codex.secrets.json'), 'utf8');
    expect(disk).toContain('conch-sealed');
    expect(disk).not.toContain('test-only-token');
    expect((await engine.detect({ force: true })).state).toBe('ready');
    await engine.disconnect();
    expect((await engine.detect({ force: true })).state).toBe('signed-out');
  });
  it('reports declined authentication and refuses an unexpected verification origin', async () => {
    const refused = await setup({ loginFails: true });
    expect((await login(refused.engine)).at(-1)?.phase).toBe('failed');
    const hostile = await setup({ loginUrl: 'https://evil.example/code' });
    const states = await login(hostile.engine);
    expect(states.at(-1)?.phase).toBe('failed');
    expect(states.some((s) => s.url)).toBe(false);
  });
  it('runs Conch tools through schema validation and the guard, with normalized events', async () => {
    const { engine, turn, fake } = await setup({
      signedIn: true,
      tool: 'conch__remember',
      args: { text: 'tea' },
    });
    const run = vi.fn(async () => 'Saved.');
    const guard = vi.fn(async () => undefined);
    const events = await collect(
      engine.runTurn(
        turn({
          guard,
          tools: [{ name: 'remember', description: 'Remember', input: { text: z.string() }, run }],
        }),
      ),
    );
    expect(run).toHaveBeenCalledWith({ text: 'tea' });
    expect(guard).toHaveBeenCalledWith({
      toolName: 'mcp__conch__remember',
      toolUseId: 'tool1',
      input: { text: 'tea' },
    });
    expect(events).toContainEqual({
      type: 'tool-end',
      toolUseId: 'tool1',
      status: 'success',
      output: 'Saved.',
    });
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    expect((await fake.calls()).some((c) => c.method === 'thread/start')).toBe(true);
  });
  it('passes on what a host tool found for the person, beside the text the model reads', async () => {
    const { engine, turn } = await setup({
      signedIn: true,
      tool: 'conch__remember',
      args: { text: 'tea' },
    });
    const view = { kind: 'files' as const, items: [{ name: 'Tea notes' }] };
    const run = vi.fn(async () => ({ text: 'Saved.', view }));
    const events = await collect(
      engine.runTurn(
        turn({
          tools: [{ name: 'remember', description: 'Remember', input: { text: z.string() }, run }],
        }),
      ),
    );
    expect(events).toContainEqual({
      type: 'tool-end',
      toolUseId: 'tool1',
      status: 'success',
      output: 'Saved.',
      view,
    });
  });
  it('hands a tool’s screenshot back as an inputImage, for a model that sees (ADR 0070)', async () => {
    const { engine, turn, fake } = await setup({
      signedIn: true,
      tool: 'conch__browser_screenshot',
      args: {},
    });
    const run = vi.fn(async () => ({
      text: 'Screenshot of “Shop”.',
      images: [{ data: '/9j/AAAA', mimeType: 'image/jpeg' as const }],
    }));
    const describe = vi.fn(async () => ({ text: 'words' }));
    await collect(
      engine.runTurn(
        turn({
          describe,
          options: {
            model: 'account-model',
            effort: 'auto',
            fastMode: false,
            permissionMode: 'default',
          },
          tools: [{ name: 'browser_screenshot', description: 'Look', input: {}, run }],
        }),
      ),
    );
    const answered = (await fake.calls()).find((c) => c.id === 'call1')?.result as {
      contentItems?: unknown[];
    };
    expect(answered.contentItems).toEqual([
      { type: 'inputText', text: 'Screenshot of “Shop”.' },
      { type: 'inputImage', imageUrl: 'data:image/jpeg;base64,/9j/AAAA' },
    ]);
    expect(describe).not.toHaveBeenCalled();
  });
  it('finishes the turn when Codex echoes a 20 MB photo back', async () => {
    const { engine, turn } = await setup({ signedIn: true, echoBytes: 20_000_000 });
    const events = await collect(
      engine.runTurn(
        turn({ images: [{ name: 'me.jpg', mimeType: 'image/jpeg', data: '/9j/AAAA' }] }),
      ),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'done', outcome: 'success' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'text', delta: 'Finished.' }));
  }, 30_000);
  it('sends a photo on this computer by its path, not as base64', async () => {
    const { engine, turn, fake } = await setup({ signedIn: true });
    await collect(
      engine.runTurn(
        turn({
          images: [
            { name: 'me.jpg', mimeType: 'image/jpeg', data: '/9j/AAAA', path: '/photos/me.jpg' },
            { name: 'pasted.png', mimeType: 'image/png', data: 'iVBORw0K' },
          ],
        }),
      ),
    );
    const started = (await fake.calls()).find((c) => c.method === 'turn/start')?.params as {
      input: unknown[];
    };
    expect(started.input.slice(1)).toEqual([
      { type: 'localImage', path: '/photos/me.jpg' },
      { type: 'image', url: 'data:image/png;base64,iVBORw0K' },
    ]);
  });
  it('never runs a denied tool, including in full trust', async () => {
    const { engine, turn } = await setup({
      signedIn: true,
      tool: 'conch__remember',
      args: { text: 'tea' },
    });
    const run = vi.fn(async () => 'Saved.');
    const events = await collect(
      engine.runTurn(
        turn({
          guard: async () => ({ decision: 'deny', message: 'Not allowed.' }),
          options: { permissionMode: 'bypassPermissions', effort: 'auto', fastMode: false },
          tools: [{ name: 'remember', description: '', input: { text: z.string() }, run }],
        }),
      ),
    );
    expect(run).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'tool-end',
      toolUseId: 'tool1',
      status: 'error',
      output: 'Not allowed.',
    });
  });
  it('disables native environments on both thread and turn without removing isolation', async () => {
    const { engine, fake, turn } = await setup({ signedIn: true });
    await collect(engine.runTurn(turn()));
    const calls = await fake.calls();
    expect(calls.find((call) => call.method === 'thread/start')?.params).toMatchObject({
      environments: [],
      permissions: 'conch',
      ephemeral: false,
    });
    expect(calls.find((call) => call.method === 'turn/start')?.params).toMatchObject({
      environments: [],
    });
  });
  it('ends failed turns and malformed transport as errors, never success', async () => {
    for (const opts of [{ fail: true }, { malformed: true }]) {
      const { engine, turn } = await setup({ signedIn: true, ...opts });
      expect((await collect(engine.runTurn(turn()))).at(-1)).toMatchObject({
        type: 'done',
        outcome: 'error',
      });
    }
  });
  it('lets an independent read finish while a browser call waits', async () => {
    const { engine, turn } = await setup({
      signedIn: true,
      tools: [{ tool: 'conch__browser_open' }, { tool: 'conch__read_file' }],
    });
    const browser = deferred<string>();
    const read = vi.fn(async () => 'Read the file.');
    const guard = vi.fn(async () => undefined);
    const stream = collect(
      engine.runTurn(
        turn({
          guard,
          tools: [
            { name: 'browser_open', description: 'Browser', input: {}, run: () => browser.promise },
            { name: 'read_file', description: 'Read', input: {}, run: read },
          ],
        }),
      ),
    );
    try {
      await expect.poll(() => read.mock.calls.length, { timeout: 2_000 }).toBe(1);
    } finally {
      browser.resolve('Page read.');
      await stream;
    }
    const events = await stream;
    expect(guard).toHaveBeenCalledWith({
      toolName: 'mcp__conch__read_file',
      toolUseId: 'batch1',
      input: {},
    });
    expect(events.findIndex((e) => e.type === 'tool-end' && e.toolUseId === 'batch1')).toBeLessThan(
      events.findIndex((e) => e.type === 'tool-end' && e.toolUseId === 'batch0'),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
  });
  it('still applies a denied guard to a read that passes a waiting browser', async () => {
    const { engine, turn } = await setup({
      signedIn: true,
      tools: [{ tool: 'conch__browser_open' }, { tool: 'conch__read_file' }],
    });
    const browser = deferred<string>();
    const read = vi.fn(async () => 'Must not run.');
    const guarded = deferred<undefined>();
    const stream = collect(
      engine.runTurn(
        turn({
          guard: async (request) => {
            if (request.toolName !== 'mcp__conch__read_file') return undefined;
            guarded.resolve(undefined);
            return { decision: 'deny', message: 'Protected file.' };
          },
          tools: [
            { name: 'browser_open', description: 'Browser', input: {}, run: () => browser.promise },
            { name: 'read_file', description: 'Read', input: {}, run: read },
          ],
        }),
      ),
    );
    try {
      await guarded.promise;
      expect(read).not.toHaveBeenCalled();
    } finally {
      browser.resolve('Page read.');
      await stream;
    }
    expect(await stream).toContainEqual({
      type: 'tool-end',
      toolUseId: 'batch1',
      status: 'error',
      output: 'Protected file.',
    });
  });
  it('does not start a queued action after Stop, even when the browser finishes late', async () => {
    const { engine, turn } = await setup({
      signedIn: true,
      tools: [{ tool: 'conch__browser_open' }, { tool: 'conch__remember' }],
    });
    const browser = deferred<string>();
    const started = deferred<undefined>();
    const action = vi.fn(async () => 'Must not run.');
    const stop = new AbortController();
    const stream = collect(
      engine.runTurn(
        turn({
          signal: stop.signal,
          tools: [
            {
              name: 'browser_open',
              description: 'Browser',
              input: {},
              run: () => {
                started.resolve(undefined);
                return browser.promise;
              },
            },
            { name: 'remember', description: 'Save', input: {}, run: action },
          ],
        }),
      ),
    );
    try {
      await started.promise;
      stop.abort();
      expect((await stream).at(-1)).toMatchObject({ type: 'done', outcome: 'interrupted' });
    } finally {
      browser.resolve('Late result.');
      await stream;
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(action).not.toHaveBeenCalled();
    expect((await stream).some((e) => e.type === 'tool-start' && e.toolUseId === 'batch1')).toBe(
      false,
    );
  });
  it('can stop draining pending tools after the provider has already completed', async () => {
    const { engine, turn, home } = await setup({
      signedIn: true,
      tools: [{ tool: 'conch__browser_open' }],
      completeBeforeTools: true,
    });
    const browser = deferred<string>();
    const started = deferred<undefined>();
    const answered = deferred<undefined>();
    const stop = new AbortController();
    let finished = false;
    const stream = (async () => {
      const events: EngineEvent[] = [];
      for await (const event of engine.runTurn(
        turn({
          signal: stop.signal,
          tools: [
            {
              name: 'browser_open',
              description: 'Browser',
              input: {},
              run: () => {
                started.resolve(undefined);
                return browser.promise;
              },
            },
          ],
        }),
      )) {
        events.push(event);
        if (event.type === 'message-done') answered.resolve(undefined);
      }
      finished = true;
      return events;
    })();
    try {
      await Promise.all([started.promise, answered.promise]);
      stop.abort();
      await expect.poll(() => finished, { timeout: 2_000 }).toBe(true);
      expect((await stream).at(-1)).toMatchObject({ type: 'done', outcome: 'interrupted' });
      expect(await readdir(join(home, 'codex-runtime'))).toEqual([]);
    } finally {
      browser.resolve('Late result.');
      await stream;
    }
  });
  it('aborts a running turn, closes its process and removes temporary credentials', async () => {
    const { engine, turn, home } = await setup({ signedIn: true, hang: true });
    const abort = new AbortController();
    const stream = collect(engine.runTurn(turn({ signal: abort.signal })));
    setTimeout(() => abort.abort(), 300);
    expect((await stream).at(-1)).toMatchObject({ type: 'done', outcome: 'interrupted' });
    expect(await readdir(join(home, 'codex-runtime'))).toEqual([]);
  });
  it('draws its plan updates as the plan, and keeps no update_plan of Conch’s', async () => {
    const { engine, turn } = await setup({
      signedIn: true,
      plan: [
        { step: 'Read the code', status: 'completed' },
        { step: 'Fix it', status: 'inProgress' },
        { step: 'Test it', status: 'pending' },
      ],
    });
    expect(engine.plans).toBe('native');
    expect(await collect(engine.runTurn(turn()))).toContainEqual({
      type: 'plan',
      steps: [
        { title: 'Read the code', status: 'done' },
        { title: 'Fix it', status: 'active' },
        { title: 'Test it', status: 'pending' },
      ],
    });
  });
  it('says a plan update’s explanation as narration, and nothing when it gives none (ADR 0103)', async () => {
    const { engine, turn } = await setup({
      signedIn: true,
      plan: [{ step: 'Read the code', status: 'inProgress' }],
      explanation: 'Reading the code before changing it',
    });
    expect(engine.narration).toBe('provider');
    const events = await collect(engine.runTurn(turn()));
    expect(events).toContainEqual({
      type: 'narration',
      text: 'Reading the code before changing it',
    });
    const quiet = await setup({ signedIn: true, plan: [{ step: 'Fix it', status: 'pending' }] });
    expect(
      (await collect(quiet.engine.runTurn(quiet.turn()))).some((e) => e.type === 'narration'),
    ).toBe(false);
  });
  it('counts only this turn’s tokens, not the whole thread’s, with the cached part named', async () => {
    // A long chat: 1.9M already used before this turn. Its first request read 200k (150k cached).
    const { engine, turn } = await setup({
      signedIn: true,
      tokenUsage: [
        {
          total: { inputTokens: 2_100_000, cachedInputTokens: 1_800_000, outputTokens: 40_000 },
          last: { inputTokens: 200_000, cachedInputTokens: 150_000, outputTokens: 1_000 },
        },
        {
          total: { inputTokens: 2_300_000, cachedInputTokens: 2_000_000, outputTokens: 42_000 },
          last: {
            inputTokens: 200_000,
            cachedInputTokens: 200_000,
            outputTokens: 2_000,
            totalTokens: 202_000,
          },
          modelContextWindow: 272_000,
        },
      ],
    });
    const events = await collect(engine.runTurn(turn()));
    const usage = events.flatMap((e) => (e.type === 'usage' ? [e.usage] : []));
    expect(usage).toEqual([
      { inputTokens: 200_000, outputTokens: 1_000, cachedInputTokens: 150_000 },
      { inputTokens: 400_000, outputTokens: 3_000, cachedInputTokens: 350_000 },
    ]);
    // How full the thread is: its latest request, read and answered, of Codex's window.
    expect(events.flatMap((e) => (e.type === 'usage' ? [e.context] : []))).toEqual([
      { used: 201_000 },
      { used: 202_000, window: 272_000 },
    ]);
  });
  it('reads only real plan steps', () => {
    expect(codexPlan('nope')).toBeUndefined();
    expect(codexPlan([{ step: 'A', status: 'paused' }, { status: 'pending' }])).toBeUndefined();
  });
  it('publishes account-listed models with honest effective capabilities', async () => {
    const { engine } = await setup({ signedIn: true });
    const caps = await engine.capabilities();
    expect(caps.tools).toMatchObject({ host: true, files: true, approvals: true });
    expect(caps.models[0]).toMatchObject({ id: 'account-model', tools: true, efforts: ['high'] });
  });

  it('answers one short prompt in a thread of its own: no tools, nothing kept, light thinking (ADR 0103)', async () => {
    const { engine, fake } = await setup({
      signedIn: true,
      models: ['gpt-big', 'gpt-mini'],
      tokenUsage: [
        {
          total: { inputTokens: 120, outputTokens: 8 },
          last: { inputTokens: 120, outputTokens: 8 },
        },
      ],
    });
    const answer = await engine.complete({
      system: 'Say why',
      prompt: 'Why read the diary?',
      model: 'gpt-mini',
      signal: new AbortController().signal,
    });
    expect(answer).toEqual({ text: 'Finished.', usage: { inputTokens: 120, outputTokens: 8 } });
    const calls = await fake.calls();
    const thread = calls.find((c) => c.method === 'thread/start')?.params;
    expect(thread).toMatchObject({
      model: 'gpt-mini',
      developerInstructions: 'Say why',
      ephemeral: true,
      dynamicTools: [],
      approvalPolicy: 'untrusted',
    });
    expect(calls.find((c) => c.method === 'turn/start')?.params).toMatchObject({
      input: [{ type: 'text', text: 'Why read the diary?' }],
      effort: 'low',
    });
    // No files and no network for anything but the model.
    const argv = calls.filter((c) => c.spawn).at(-1)?.argv as string[];
    expect(argv.join(' ')).toContain('permissions.conch.network={enabled=false}');
    expect(argv.join(' ')).toContain('features.shell_tool=false');
  });

  it('says a failed short answer failed, and asks nothing of a Codex that isn’t signed in', async () => {
    const failing = await setup({ signedIn: true, fail: true });
    await expect(
      failing.engine.complete({ system: 's', prompt: 'p', signal: new AbortController().signal }),
    ).rejects.toThrow(/Codex couldn’t answer/);
    const out = await setup();
    await expect(
      out.engine.complete({ system: 's', prompt: 'p', signal: new AbortController().signal }),
    ).rejects.toThrow();
  });
});

describe('Codex CLI: Codex with its own tools, asking through Conch (ADR 0066)', () => {
  async function agent(options: Parameters<typeof fakeCodexApp>[0]) {
    const base = await setup({ signedIn: true, ...options });
    const settings = new SettingsStore(base.home);
    const engine = new CodexEngine(
      settings,
      new ProviderKeys(settings),
      base.fake.bin,
      undefined,
      'agent',
    );
    return { ...base, engine };
  }
  const configOf = async (fake: Awaited<ReturnType<typeof fakeCodexApp>>) =>
    ((await fake.calls()).findLast((c) => c.spawn)?.argv as string[]).join(' ');
  const decisionOf = async (fake: Awaited<ReturnType<typeof fakeCodexApp>>) =>
    ((await fake.calls()).find((c) => c.id === 'approve1')?.result as { decision?: string })
      ?.decision;
  const mode = (permissionMode: TurnInput['options']['permissionMode']) => ({
    permissionMode,
    effort: 'auto' as const,
    fastMode: false,
  });

  it('is its own provider, sharing Codex’s sign-in, and keeps Codex’s own tools on', async () => {
    const { engine, fake, turn, home } = await agent({});
    expect(engine.id).toBe('codex-agent');
    expect(engine.label).toBe('Codex CLI');
    expect(engine.commandSandbox).toBeUndefined();
    await collect(
      engine.runTurn(
        turn({
          protectedPaths: [join(home, 'vault')],
          sandbox: { allowWrite: [join(home, 'cache')], denyRead: [join(home, '.ssh')] },
        }),
      ),
    );
    const config = await configOf(fake);
    // Its own shell and file edits: not switched off, not read-only.
    expect(config).not.toContain('features.shell_tool=false');
    // Its own sub-agents are: work is handed off as Conch's tasks (ADR 0033).
    expect(config).toContain('features.multi_agent=false');
    expect(config).toContain('features.multi_agent_v2=false');
    expect(config).not.toContain('sandbox_mode="read-only"');
    // Still asking for anything not plainly read-only, writing only where Conch allows,
    // reading nowhere secrets live, and no network.
    // Codex 0.159.1 refuses the old config key: the policy is the thread's, the profile the default.
    expect(config).not.toContain('approval_policy');
    expect(config).toContain('default_permissions="conch"');
    expect(config).toContain('permissions.conch.extends=":workspace"');
    expect(config).toContain(`${JSON.stringify(join(home, 'cache'))}="write"`);
    expect(config).toContain(`${JSON.stringify(join(home, 'vault'))}="deny"`);
    expect(config).toContain(`${JSON.stringify(join(home, '.ssh'))}="deny"`);
    expect(config).toContain('permissions.conch.network={enabled=false}');
    expect(config).toContain('features.apps=false');
  });

  it('names each path once, so Codex never refuses its own profile as a duplicate key', async () => {
    const { engine, fake, turn, home } = await agent({});
    const vault = join(home, 'vault');
    await collect(
      engine.runTurn(
        turn({
          protectedPaths: [vault, vault],
          sandbox: { allowWrite: ['/tmp', '/tmp', vault], denyRead: [vault] },
        }),
      ),
    );
    const config = await configOf(fake);
    const count = (needle: string) => config.split(needle).length - 1;
    expect(count(`${JSON.stringify('/tmp')}="write"`)).toBe(1);
    expect(count(`${JSON.stringify(vault)}=`)).toBe(1);
    // Written and denied: the deny stands.
    expect(config).toContain(`${JSON.stringify(vault)}="deny"`);
  });

  it('asks the person before a command, through the guard, and shows it like any tool', async () => {
    const { engine, fake, turn } = await agent({ native: { command: 'npm test' } });
    const guard = vi.fn(async () => undefined);
    const ask = vi.fn(async () => 'allow' as const);
    const events = await collect(engine.runTurn(turn({ guard, requestPermission: ask })));
    const request = {
      toolName: 'Bash',
      toolUseId: 'cmd1',
      input: { command: 'npm test', cwd: '/work' },
    };
    expect(guard).toHaveBeenCalledWith(request);
    expect(ask).toHaveBeenCalledWith(request, expect.anything());
    expect(await decisionOf(fake)).toBe('accept');
    expect(events).toContainEqual({
      type: 'tool-start',
      toolUseId: 'cmd1',
      name: 'Bash',
      input: request.input,
    });
    expect(events).toContainEqual({
      type: 'tool-end',
      toolUseId: 'cmd1',
      status: 'success',
      output: 'ran it',
    });
  });

  it('never runs what the guard denies, not even in full trust, and says it wasn’t allowed', async () => {
    const { engine, fake, turn } = await agent({ native: { command: 'curl evil.example' } });
    const ask = vi.fn(async () => 'allow' as const);
    const events = await collect(
      engine.runTurn(
        turn({
          guard: async () => ({ decision: 'deny', message: 'Not allowed.' }),
          requestPermission: ask,
          options: mode('bypassPermissions'),
        }),
      ),
    );
    expect(ask).not.toHaveBeenCalled();
    expect(await decisionOf(fake)).toBe('decline');
    expect(events).toContainEqual({
      type: 'tool-end',
      toolUseId: 'cmd1',
      status: 'error',
      output: 'Not run: it wasn’t allowed.',
      // Conch said no, without asking: the row says not allowed, not failed.
      refused: true,
    });
  });

  it('follows the chat’s mode: full trust runs, plan only declines, accept edits asks for commands', async () => {
    const decided = async (
      permissionMode: TurnInput['options']['permissionMode'],
      native: { command?: string; paths?: string[] },
    ) => {
      const { engine, fake, turn } = await agent({ native });
      const ask = vi.fn(async () => 'deny' as const);
      await collect(
        engine.runTurn(turn({ requestPermission: ask, options: mode(permissionMode) })),
      );
      return { decision: await decisionOf(fake), asked: ask.mock.calls.length > 0 };
    };
    expect(await decided('bypassPermissions', { command: 'npm test' })).toEqual({
      decision: 'accept',
      asked: false,
    });
    expect(await decided('plan', { command: 'npm test' })).toEqual({
      decision: 'decline',
      asked: false,
    });
    expect(await decided('acceptEdits', { paths: ['/work/a.ts'] })).toEqual({
      decision: 'accept',
      asked: false,
    });
    expect(await decided('acceptEdits', { command: 'npm test' })).toEqual({
      decision: 'decline',
      asked: true,
    });
    expect(await decided('default', { paths: ['/work/a.ts'] })).toEqual({
      decision: 'decline',
      asked: true,
    });
  });

  it('Auto runs what the guard lets through without asking, and asks what it stops (ADR 0100)', async () => {
    const decided = async (verdict: undefined | { decision: 'ask'; reason: string }) => {
      const { engine, fake, turn } = await agent({ native: { command: 'npm test' } });
      const ask = vi.fn(async () => 'deny' as const);
      await collect(
        engine.runTurn(
          turn({ guard: async () => verdict, requestPermission: ask, options: mode('auto') }),
        ),
      );
      return { decision: await decisionOf(fake), asked: ask.mock.calls.length > 0 };
    };
    expect(await decided(undefined)).toEqual({ decision: 'accept', asked: false });
    expect(await decided({ decision: 'ask', reason: 'This would force-push.' })).toEqual({
      decision: 'decline',
      asked: true,
    });
  });

  it('reaches as far as the mode: sealed, the network for Auto, your folders for Full trust', async () => {
    const configFor = async (reach: TurnInput['reach']) => {
      const { engine, fake, turn, home } = await agent({});
      await collect(
        engine.runTurn(
          turn({
            ...(reach && { reach }),
            protectedPaths: [join(home, 'vault')],
            sandbox: {
              allowWrite: [join(home, 'cache')],
              denyRead: [join(homedir(), '.ssh'), join(home, 'browser', 'profile')],
            },
          }),
        ),
      );
      return { config: await configOf(fake), home };
    };
    const sealed = await configFor(undefined);
    expect(sealed.config).toContain('permissions.conch.network={enabled=false}');
    expect(sealed.config).not.toContain(`${JSON.stringify(homedir())}="write"`);
    const auto = await configFor('network');
    expect(auto.config).toContain('permissions.conch.network={enabled=true}');
    expect(auto.config).toContain(`${JSON.stringify(join(homedir(), '.ssh'))}="deny"`);
    const full = await configFor('open');
    expect(full.config).toContain('permissions.conch.network={enabled=true}');
    expect(full.config).toContain(`${JSON.stringify(homedir())}="write"`);
    // Your keys are yours to use in Full trust (a push over SSH); Conch's own never are.
    expect(full.config).not.toContain(`${JSON.stringify(join(homedir(), '.ssh'))}="deny"`);
    expect(full.config).toContain(`${JSON.stringify(join(full.home, 'vault'))}="deny"`);
    expect(full.config).toContain(
      `${JSON.stringify(join(full.home, 'browser', 'profile'))}="deny"`,
    );
  });

  it('asks when the guard says so, even in full trust; a change names every file it touches', async () => {
    const { engine, turn } = await agent({ native: { paths: ['/work/a.ts', '/work/b.ts'] } });
    const guard = vi.fn(async () => ({ decision: 'ask' as const, reason: 'It read a web page.' }));
    const ask = vi.fn(async () => 'allow' as const);
    await collect(
      engine.runTurn(turn({ guard, requestPermission: ask, options: mode('bypassPermissions') })),
    );
    expect(guard).toHaveBeenCalledWith({
      toolName: 'Edit',
      toolUseId: 'fc1',
      input: { file_path: '/work/a.ts', paths: ['/work/a.ts', '/work/b.ts'] },
    });
    expect(ask).toHaveBeenCalledOnce();
  });

  it('never touches where passwords and keys live, whatever the mode', async () => {
    const vault = join(tmpdir(), 'conch-vault-here');
    const { engine, fake, turn } = await agent({ native: { command: `cat ${vault}/key` } });
    const ask = vi.fn(async () => 'allow' as const);
    await collect(
      engine.runTurn(
        turn({
          protectedPaths: [vault],
          requestPermission: ask,
          options: mode('bypassPermissions'),
        }),
      ),
    );
    expect(ask).not.toHaveBeenCalled();
    expect(await decisionOf(fake)).toBe('decline');
  });

  it('never grants a way out of the sandbox, in any mode: network, other folders, or a retry outside', () => {
    const command = 'item/commandExecution/requestApproval';
    const change = 'item/fileChange/requestApproval';
    const plain = { itemId: 'cmd1', command: 'npm test' };
    expect(escapes(command, plain, false)).toBeUndefined();
    expect(escapes(change, { itemId: 'fc1' }, false)).toBeUndefined();
    expect(escapes(command, plain, true)).toMatch(/outside its sandbox/);
    expect(
      escapes(
        command,
        { ...plain, networkApprovalContext: { host: 'x.example', protocol: 'https' } },
        false,
      ),
    ).toMatch(/network/);
    expect(
      escapes(
        command,
        { ...plain, proposedNetworkPolicyAmendments: [{ host: 'x.example' }] },
        false,
      ),
    ).toMatch(/network/);
    expect(
      escapes(command, { ...plain, reason: 'command failed; retry without sandbox?' }, false),
    ).toMatch(/outside its sandbox/);
    expect(escapes(change, { itemId: 'fc1', grantRoot: '/' }, false)).toMatch(
      /outside your work folder/,
    );
  });

  it('declines an escalation before asking anyone, and says why in the chat', async () => {
    const { engine, fake, turn } = await agent({ native: { command: 'npm test' } });
    const ask = vi.fn(async () => 'allow' as const);
    const guard = vi.fn(async () => undefined);
    // Full trust, and still: a request that names the network is turned down.
    const events = await collect(
      engine.runTurn(turn({ guard, requestPermission: ask, options: mode('bypassPermissions') })),
    );
    expect(await decisionOf(fake)).toBe('accept');
    expect(events.some((e) => e.type === 'notice')).toBe(false);
    const {
      engine: second,
      fake: other,
      turn: turn2,
    } = await agent({
      native: { command: 'npm test', network: true },
    });
    const events2 = await collect(
      second.runTurn(turn2({ guard, requestPermission: ask, options: mode('bypassPermissions') })),
    );
    expect(await decisionOf(other)).toBe('decline');
    expect(events2).toContainEqual({
      type: 'notice',
      code: 'sandbox',
      message: 'Codex asked to reach the network. Its commands have no network in Conch.',
    });
  });

  it('leaves Codex (Conch’s tools) as it was: its own tools off and every request declined', async () => {
    const { engine, fake, turn } = await setup({ signedIn: true, native: { command: 'npm test' } });
    const ask = vi.fn(async () => 'allow' as const);
    await collect(engine.runTurn(turn({ requestPermission: ask })));
    expect(ask).not.toHaveBeenCalled();
    expect(await decisionOf(fake)).toBe('decline');
    const config = await configOf(fake);
    expect(config).toContain('features.shell_tool=false');
    expect(config).toContain('permissions.conch.extends=":read-only"');
  });
});

describe('Codex carrying a chat on (ADR 0066 § Carrying on)', () => {
  const sessionOf = (events: EngineEvent[]) =>
    events.find((e): e is Extract<EngineEvent, { type: 'session' }> => e.type === 'session');
  const textOf = (call: Record<string, unknown> | undefined) =>
    ((call?.params as { input: { text?: string }[] }).input[0]?.text ?? '') as string;
  const remember = {
    name: 'remember',
    description: 'Remember',
    input: { text: z.string() },
    run: async () => 'Saved.',
  };

  it('resumes the same thread next turn, with only what it missed, kept in Conch’s home between runs', async () => {
    const { engine, fake, home, turn } = await setup({ signedIn: true });
    const first = await collect(
      engine.runTurn(turn({ prompt: 'My colour is teal', tools: [remember] })),
    );
    const session = sessionOf(first);
    expect(session?.resumeId).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{16}$/);
    expect(session?.restarted).toBeUndefined();
    const threadId = session?.resumeId.split('.')[0] ?? '';
    // Kept outside the run's home, which is gone.
    expect(await readdir(join(home, 'codex-sessions'))).toEqual(
      expect.arrayContaining([`${threadId}.jsonl`, `${threadId}.json`]),
    );
    expect(await readdir(join(home, 'codex-runtime'))).toEqual([]);

    const second = await collect(
      engine.runTurn(
        turn({
          prompt: 'What is my colour?',
          freshPrompt: 'EVERYTHING\n\nWhat is my colour?',
          resumeId: session?.resumeId,
          tools: [remember],
        }),
      ),
    );
    expect(sessionOf(second)?.resumeId).toBe(session?.resumeId);
    const calls = await fake.calls();
    expect(calls.filter((c) => c.method === 'thread/start')).toHaveLength(1);
    expect(calls.find((c) => c.method === 'thread/resume')?.params).toMatchObject({
      threadId,
      approvalPolicy: 'untrusted',
      permissions: 'conch',
    });
    expect(textOf(calls.filter((c) => c.method === 'turn/start').at(-1))).toBe(
      'What is my colour?',
    );
    // Both turns are in the thread Conch keeps.
    const kept = await readFile(join(home, 'codex-sessions', `${threadId}.jsonl`), 'utf8');
    expect(kept).toContain('My colour is teal');
    expect(kept).toContain('What is my colour?');
    expect(second.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
  });

  it('summarises the thread when asked (/compact), and says so on a thread just started', async () => {
    const { engine, fake, turn } = await setup({ signedIn: true });
    const fresh = await collect(engine.runTurn(turn({ prompt: '/compact' })));
    expect(fresh.some((e) => e.type === 'text' && e.delta.includes('nothing to summarise'))).toBe(
      true,
    );
    const resumeId = sessionOf(await collect(engine.runTurn(turn({ prompt: 'Hello' }))))?.resumeId;
    const compacted = await collect(engine.runTurn(turn({ prompt: '/compact', resumeId })));
    expect(compacted.some((e) => e.type === 'compacted')).toBe(true);
    expect(compacted.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    const calls = await fake.calls();
    expect(calls.filter((c) => c.method === 'thread/compact/start')).toHaveLength(1);
    // Asked to summarise, it doesn't take a turn as well.
    expect(calls.filter((c) => c.method === 'turn/start').map(textOf)).toEqual(['Hello']);
    expect((await engine.capabilities()).commands.map((c) => c.name)).toContain('compact');
  });

  it('tells a resumed thread Conch’s instructions again only when they changed', async () => {
    const { engine, fake, turn } = await setup({ signedIn: true });
    const resumeId = sessionOf(
      await collect(engine.runTurn(turn({ systemAppend: 'Conch v1' }))),
    )?.resumeId;
    await collect(engine.runTurn(turn({ resumeId, systemAppend: 'Conch v1' })));
    await collect(engine.runTurn(turn({ resumeId, systemAppend: 'Conch v2: likes tea' })));
    const turns = (await fake.calls()).filter((c) => c.method === 'turn/start');
    expect((turns[1]?.params as Record<string, unknown>).additionalContext).toBeUndefined();
    expect((turns[2]?.params as Record<string, unknown>).additionalContext).toEqual({
      conch: {
        kind: 'application',
        value: expect.stringContaining('Conch v2: likes tea'),
      },
    });
  });

  it('starts a new thread with the whole conversation when the chat’s tools changed', async () => {
    const { engine, fake, home, turn } = await setup({ signedIn: true });
    const old = sessionOf(await collect(engine.runTurn(turn())))?.resumeId ?? '';
    const events = await collect(
      engine.runTurn(
        turn({
          resumeId: old,
          prompt: 'next',
          freshPrompt: 'EVERYTHING\n\nnext',
          tools: [remember],
        }),
      ),
    );
    const now = sessionOf(events);
    expect(now?.resumeId).not.toBe(old);
    // Changed on purpose: nothing to heal.
    expect(now?.restarted).toBeUndefined();
    const calls = await fake.calls();
    expect(calls.some((c) => c.method === 'thread/resume')).toBe(false);
    expect(textOf(calls.filter((c) => c.method === 'turn/start').at(-1))).toBe(
      'EVERYTHING\n\nnext',
    );
    // The old thread isn't kept once it can't be carried on.
    expect(await readdir(join(home, 'codex-sessions'))).not.toContain(`${old.split('.')[0]}.jsonl`);
  });

  it('heals a thread Codex can’t read back: a new one, with the whole conversation, said quietly', async () => {
    const { engine, home, turn } = await setup({ signedIn: true });
    const old = sessionOf(await collect(engine.runTurn(turn())))?.resumeId;
    // The same Conch home, with a Codex that can't resume it.
    const broken = await fakeCodexApp({ signedIn: true, resumeFails: true });
    const settings = new SettingsStore(home);
    const again = new CodexEngine(settings, new ProviderKeys(settings), broken.bin);
    const events = await collect(
      again.runTurn(turn({ resumeId: old, prompt: 'next', freshPrompt: 'EVERYTHING\n\nnext' })),
    );
    expect(sessionOf(events)).toMatchObject({ restarted: 'lost' });
    expect(sessionOf(events)?.resumeId).not.toBe(old);
    const calls = await broken.calls();
    expect(calls.some((c) => c.method === 'thread/resume')).toBe(true);
    expect(textOf(calls.find((c) => c.method === 'turn/start'))).toBe('EVERYTHING\n\nnext');
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });

    // A thread whose file is gone (tidied, another computer), or an id from long ago: the same.
    for (const resumeId of [
      `00000000-0000-4000-8000-000000000000.${old?.split('.')[1]}`,
      'thread-from-codex-exec',
    ]) {
      const lost = await collect(
        engine.runTurn(turn({ resumeId, prompt: 'next', freshPrompt: 'EVERYTHING\n\nnext' })),
      );
      expect(sessionOf(lost)).toMatchObject({ restarted: 'lost' });
    }
  });

  it('lets go of the kept thread when the chat is deleted', async () => {
    const { engine, home, turn } = await setup({ signedIn: true });
    const resumeId = sessionOf(await collect(engine.runTurn(turn())))?.resumeId ?? '';
    await engine.forgetSession(resumeId);
    expect(await readdir(join(home, 'codex-sessions'))).toEqual([]);
    // Nothing that isn't a thread id becomes a path.
    await expect(engine.forgetSession('../../codex.secrets.json')).resolves.toBeUndefined();
  });
});

describe('observed provider utilities', () => {
  it('routes native clock requests through the guarded Conch tool and records both events', async () => {
    const { engine, turn, fake } = await setup({ signedIn: true, clock: 'read' });
    const guard = vi.fn(async () => undefined);
    const sample = vi.fn(() => Date.parse('2026-10-07T16:00:00Z'));
    const events = await collect(engine.runTurn(turn({ tools: [currentTimeTool(sample)], guard })));
    expect(sample).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'mcp__conch__current_time' }),
    );
    expect(events.filter((e) => e.type === 'tool-start')).toEqual([
      expect.objectContaining({ name: 'mcp__conch__current_time' }),
    ]);
    expect(events.filter((e) => e.type === 'tool-end')).toEqual([
      expect.objectContaining({ status: 'success', output: expect.stringContaining('1791388800') }),
    ]);
    expect((await fake.calls()).find((c) => c.id === 'clock1')).toMatchObject({
      result: { currentTimeAt: 1791388800 },
    });
  });
  it('does not sample a clock for a stale thread or a refused guard', async () => {
    for (const wrongThread of [true, false]) {
      const { engine, turn, fake } = await setup({
        signedIn: true,
        clock: wrongThread ? 'wrong-thread' : 'read',
      });
      const sample = vi.fn(() => 1);
      const events = await collect(
        engine.runTurn(
          turn({
            tools: [currentTimeTool(sample)],
            guard: async () => ({ decision: 'deny', message: 'Blocked' }),
          }),
        ),
      );
      expect(sample).not.toHaveBeenCalled();
      expect((await fake.calls()).find((c) => c.id === 'clock1')).toHaveProperty('error');
      expect(events.filter((e) => e.type === 'tool-end' && e.status === 'success')).toHaveLength(0);
    }
  });
  it('surfaces MCP and provider utility events even in the tools-only provider', async () => {
    const { engine, turn } = await setup({
      signedIn: true,
      providerItems: [
        {
          type: 'mcpToolCall',
          id: 'mcp1',
          server: 'clock',
          tool: 'curr_time',
          arguments: {},
          status: 'completed',
          result: { content: [{ type: 'text', text: '16:00 UTC' }] },
        },
        {
          type: 'dynamicToolCall',
          id: 'native1',
          namespace: 'clock',
          tool: 'curr_time',
          arguments: {},
          status: 'failed',
          success: false,
          contentItems: [{ type: 'inputText', text: 'Unavailable' }],
        },
      ],
    });
    const events = await collect(engine.runTurn(turn()));
    expect(events.filter((e) => e.type === 'tool-start').map((e) => e.name)).toEqual([
      'mcp__clock__curr_time',
      'provider__clock__curr_time',
    ]);
    expect(events.filter((e) => e.type === 'tool-end').map((e) => e.status)).toEqual([
      'success',
      'error',
    ]);
  });
});

describe('a picture on the ChatGPT plan, through the app server', () => {
  it('reads a multi-megabyte picture sent whole in one message', async () => {
    // 4 MB of picture is about 5.6 MB of base64: past what a chat's connection reads.
    const { engine } = await setup({ signedIn: true, picture: 4_000_000 });
    const made = await engine.pictures.make({
      prompt: 'A fox',
      signal: new AbortController().signal,
    });
    expect(made.bytes.length).toBe(4_000_000);
    expect(made.bytes.subarray(0, 4).toString('latin1')).toBe('\x89PNG');
    expect(made.bytes[4_000_000 - 1]).toBe((4_000_000 - 1) % 251);
  }, 30_000);
});
