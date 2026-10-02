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
import { CodexEngine } from './app-engine';

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
      ephemeral: true,
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
  it('publishes account-listed models with honest effective capabilities', async () => {
    const { engine } = await setup({ signedIn: true });
    const caps = await engine.capabilities();
    expect(caps.tools).toMatchObject({ host: true, files: true, approvals: true });
    expect(caps.models[0]).toMatchObject({ id: 'account-model', tools: true, efforts: ['high'] });
  });
});
