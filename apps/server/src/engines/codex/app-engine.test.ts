import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { deviceSealer, registerSealer, unregisterSealer } from '../../lib/sealed';
import { ProviderKeys } from '../../providers/keys';
import { SettingsStore } from '../../settings/store';
import { fakeCodexApp } from '../../test/fakeCodexApp';
import type { LoginState } from '@conch/protocol';
import type { EngineEvent, TurnInput } from '../types';
import { CodexEngine, codexPlan, escapes } from './app-engine';

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

describe('Codex app-server parity', () => {
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
      tool: 'mcp__conch__remember',
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
      tool: 'mcp__conch__remember',
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
  it('never runs a denied tool, including in full trust', async () => {
    const { engine, turn } = await setup({
      signedIn: true,
      tool: 'mcp__conch__remember',
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
