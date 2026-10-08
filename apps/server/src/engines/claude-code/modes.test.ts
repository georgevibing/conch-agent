import { describe, expect, it, vi } from 'vitest';

import type { ProviderKeys } from '../../providers/keys';
import type { SettingsStore } from '../../settings/store';
import type { PermissionRequest, TurnInput } from '../types';

interface Options {
  permissionMode?: string;
  env?: Record<string, string>;
  allowDangerouslySkipPermissions?: boolean;
  canUseTool?: (
    name: string,
    input: Record<string, unknown>,
    extra: { signal: AbortSignal; toolUseID: string },
  ) => Promise<unknown>;
}

/** What Claude Code was started with, and the modes it was switched to. */
const started: Options[] = [];
const switched: string[] = [];
/** Whether its models have Claude Code's own auto mode. */
let nativeAuto = true;

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: () => ({ type: 'sdk', name: 'conch', instance: {} }),
  tool: (name: string) => ({ name }),
  query: ({ options }: { options: Options }) => {
    started.push(options);
    return {
      supportedModels: async () => [
        { value: 'default', displayName: 'Default', description: '', supportsAutoMode: nativeAuto },
        { value: 'haiku', displayName: 'Haiku', description: '', supportsAutoMode: false },
      ],
      supportedCommands: async () => [],
      close: () => undefined,
      setPermissionMode: async (mode: string) => void switched.push(mode),
      setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
      async *[Symbol.asyncIterator]() {},
    };
  },
}));

vi.mock('./detect', () => ({
  detectClaude: async () => ({
    engine: 'claude-code',
    label: 'Claude Code',
    state: 'ready',
    install: [],
    canSignIn: true,
    checkedAt: Date.now(),
    executablePath: '/usr/local/bin/claude',
  }),
}));

const { ClaudeCodeEngine } = await import('./engine');

const engineFor = () =>
  new ClaudeCodeEngine(
    { workspace: async () => '/tmp' } as unknown as SettingsStore,
    { value: async () => undefined } as unknown as ProviderKeys,
  );

function turn(over: Partial<TurnInput> = {}): TurnInput {
  return {
    conversationId: 'c1',
    prompt: 'hello',
    systemAppend: '',
    cwd: '/tmp',
    tools: [],
    requestPermission: async () => 'allow',
    signal: new AbortController().signal,
    options: { effort: 'auto', fastMode: false, permissionMode: 'auto' },
    ...over,
  };
}

async function run(engine: InstanceType<typeof ClaudeCodeEngine>, input: TurnInput) {
  for await (const _ of engine.runTurn(input)) void _;
  return started.at(-1);
}

describe('Claude Code’s permission modes (ADR 0100)', () => {
  it('offers every mode, with or without its own auto mode', async () => {
    for (const auto of [true, false]) {
      nativeAuto = auto;
      const caps = await engineFor().capabilities({ force: true });
      expect(caps.permissionModes).toEqual([
        'default',
        'plan',
        'acceptEdits',
        'auto',
        'bypassPermissions',
      ]);
    }
    nativeAuto = true;
  });

  it('runs Auto as its own auto mode where the model has it, and says when its classifier wants a person', async () => {
    nativeAuto = true;
    const engine = engineFor();
    await engine.capabilities({ force: true });
    const asked: PermissionRequest[] = [];
    const options = await run(
      engine,
      turn({
        requestPermission: async (request) => {
          asked.push(request);
          return 'allow';
        },
      }),
    );
    expect(options?.permissionMode).toBe('auto');
    expect(options?.allowDangerouslySkipPermissions).toBeUndefined();
    await options?.canUseTool?.(
      'Bash',
      { command: 'ls' },
      {
        signal: new AbortController().signal,
        toolUseID: 't1',
      },
    );
    expect(asked).toEqual([
      { toolName: 'Bash', toolUseId: 't1', input: { command: 'ls' }, escalated: true },
    ]);
  });

  it('runs Auto as Ask first, answered by Conch, for a model without it', async () => {
    nativeAuto = true;
    const engine = engineFor();
    await engine.capabilities({ force: true });
    const asked: PermissionRequest[] = [];
    const options = await run(
      engine,
      turn({
        options: { effort: 'auto', fastMode: false, permissionMode: 'auto', model: 'haiku' },
        requestPermission: async (request) => {
          asked.push(request);
          return 'allow';
        },
      }),
    );
    expect(options?.permissionMode).toBe('default');
    await options?.canUseTool?.(
      'Bash',
      { command: 'ls' },
      {
        signal: new AbortController().signal,
        toolUseID: 't1',
      },
    );
    expect(asked[0]?.escalated).toBeUndefined();
    // Not probed yet: Conch's own Auto, never a mode Claude Code might not have.
    expect((await run(engineFor(), turn()))?.permissionMode).toBe('default');
  });

  it('Full trust is bypassPermissions; Auto picked mid-turn follows the model', async () => {
    nativeAuto = true;
    const engine = engineFor();
    await engine.capabilities({ force: true });
    const full = await run(
      engine,
      turn({ options: { effort: 'auto', fastMode: false, permissionMode: 'bypassPermissions' } }),
    );
    expect(full).toMatchObject({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    });
    let change: ((mode: 'auto' | 'bypassPermissions') => void) | undefined;
    switched.length = 0;
    await run(
      engine,
      turn({
        options: { effort: 'auto', fastMode: false, permissionMode: 'default' },
        onModeChange: (listener) => {
          change = listener;
        },
      }),
    );
    change?.('auto');
    // Full trust picked mid-turn runs as Ask, with Conch answering (ADR 0028).
    change?.('bypassPermissions');
    await new Promise((r) => setTimeout(r, 0));
    expect(switched).toEqual(['auto', 'default']);
  });
});

describe('Claude Code’s notes on each round of steps (ADR 0103)', () => {
  it('asks for its tool-use summaries only when small-model naming is on', async () => {
    const engine = engineFor();
    await engine.capabilities({ force: true });
    const on = await run(engine, turn({ narrate: true }));
    expect(on?.env?.['CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES']).toBe('1');
    const off = await run(engine, turn());
    expect(off?.env?.['CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES']).toBe(
      process.env['CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES'],
    );
  });
});
