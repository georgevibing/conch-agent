import { describe, expect, it, vi } from 'vitest';

import type { ProviderKeys } from '../../providers/keys';
import type { SettingsStore } from '../../settings/store';
import type { TurnInput } from '../types';

/** What Claude Code was started with, turn by turn. */
const started: { disallowedTools?: string[]; permissionMode?: string }[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: () => ({ type: 'sdk', name: 'conch', instance: {} }),
  tool: (name: string) => ({ name }),
  query: ({ options }: { options: { disallowedTools?: string[]; permissionMode?: string } }) => {
    started.push(options);
    return {
      setPermissionMode: async () => undefined,
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

const { ClaudeCodeEngine, OWN_SUBAGENTS, OWN_WAITS } = await import('./engine');

function turn(over: Partial<TurnInput> = {}): TurnInput {
  return {
    conversationId: 'c1',
    prompt: 'hello',
    systemAppend: '',
    cwd: '/tmp',
    tools: [],
    requestPermission: async () => 'deny',
    signal: new AbortController().signal,
    options: { effort: 'auto', fastMode: false, permissionMode: 'default' },
    ...over,
  };
}

async function run(input: TurnInput) {
  const engine = new ClaudeCodeEngine(
    {} as SettingsStore,
    { value: async () => undefined } as unknown as ProviderKeys,
  );
  for await (const _ of engine.runTurn(input)) void _;
  return started.at(-1);
}

/**
 * Work is handed off as Conch's tasks (ADR 0033), never Claude Code's own
 * sub-agents: theirs run out of sight, outside the chat's cards, Stop and
 * spending, so they're off in every turn and every mode.
 */
describe('Claude Code’s own sub-agents', () => {
  it('are off in every mode, Full trust included', async () => {
    for (const permissionMode of ['default', 'plan', 'bypassPermissions'] as const) {
      const options = await run(
        turn({ options: { effort: 'auto', fastMode: false, permissionMode } }),
      );
      expect(options?.permissionMode).toBe(permissionMode);
      expect(options?.disallowedTools).toEqual(
        expect.arrayContaining(['Agent', 'Task', 'Workflow']),
      );
    }
  });

  it('stay off beside the tools you turned off, and leave its to-do list alone', async () => {
    const options = await run(turn({ disallowedTools: ['mcp__github__delete_repo'] }));
    expect(options?.disallowedTools).toEqual([
      ...OWN_SUBAGENTS,
      ...OWN_WAITS,
      'mcp__github__delete_repo',
    ]);
    expect(options?.disallowedTools).not.toContain('TaskCreate');
  });
});

/**
 * Waiting goes through Conch's `wait_for` (ADR 0124): Claude Code's own
 * wake-ups would fire inside a session whose turn has already ended.
 */
describe('Claude Code’s own wake-ups', () => {
  it('are off in every mode, and its background commands stay', async () => {
    for (const permissionMode of ['default', 'bypassPermissions'] as const) {
      const options = await run(
        turn({ options: { effort: 'auto', fastMode: false, permissionMode } }),
      );
      expect(options?.disallowedTools).toEqual(
        expect.arrayContaining(['ScheduleWakeup', 'Monitor', 'CronCreate']),
      );
      expect(options?.disallowedTools).not.toContain('Bash');
    }
  });
});
