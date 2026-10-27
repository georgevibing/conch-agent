import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderKeys } from '../../providers/keys';
import type { Options as SdkOptions } from '@anthropic-ai/claude-agent-sdk';
import type { SettingsStore } from '../../settings/store';
import type { TurnInput } from '../types';

interface Options {
  hooks?: SdkOptions['hooks'];
  permissionMode?: string;
  env?: Record<string, string>;
  allowDangerouslySkipPermissions?: boolean;
  abortController?: AbortController;
  canUseTool?: (
    name: string,
    input: Record<string, unknown>,
    extra: { signal: AbortSignal; toolUseID: string },
  ) => Promise<unknown>;
}

/** What Claude Code was started with, and the modes it was switched to. */
const started: Options[] = [];
const switched: string[] = [];
/** Each `setMcpServers` call's server names, and the errors each call answers with. */
const loaded: string[][] = [];
let answers: Record<string, string>[] = [];
/** Whether its models have Claude Code's own auto mode. */
const nativeAuto = true;

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
      setMcpServers: async (servers: Record<string, unknown>) => {
        loaded.push(Object.keys(servers));
        return { added: [], removed: [], errors: answers.shift() ?? {} };
      },
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

const linear = { type: 'http' as const, url: 'https://mcp.linear.app/mcp' };

beforeEach(() => {
  loaded.length = 0;
  answers = [];
});

describe('an app that didn’t start, on Claude Code (working agreement 11)', () => {
  it('is looked at once more and loaded again this turn, with a quiet note', async () => {
    answers = [{ linear: 'Connection closed' }, {}];
    const healed = vi.fn();
    const healMcp = vi.fn(async () => ({
      servers: { linear: { ...linear, headers: { authorization: 'Bearer renewed' } } },
      healed,
    }));
    await run(engineFor(), turn({ mcpServers: { linear }, healMcp }));
    await vi.waitFor(() => expect(healed).toHaveBeenCalledWith(['linear']));
    expect(healMcp).toHaveBeenCalledTimes(1);
    expect(loaded).toEqual([
      ['conch', 'linear'],
      ['conch', 'linear'],
    ]);
  });

  it('isn’t loaded again when one more look doesn’t fix it', async () => {
    answers = [{ linear: 'Connection closed' }];
    const healed = vi.fn();
    const healMcp = vi.fn(async () => ({ servers: {}, healed }));
    await run(engineFor(), turn({ mcpServers: { linear }, healMcp }));
    await vi.waitFor(() => expect(healMcp).toHaveBeenCalledTimes(1));
    expect(loaded).toHaveLength(1);
    expect(healed).not.toHaveBeenCalled();
  });
});
