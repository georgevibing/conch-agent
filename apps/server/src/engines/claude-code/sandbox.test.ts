import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderKeys } from '../../providers/keys';
import type { SettingsStore } from '../../settings/store';
import type { TurnInput } from '../types';

/** What Claude Code was started with. */
const started: Options[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: () => ({ type: 'sdk', name: 'conch', instance: {} }),
  tool: (name: string) => ({ name }),
  query: ({ options }: { options: Options }) => {
    started.push(options);
    return {
      supportedModels: async () => [],
      supportedCommands: async () => [],
      close: () => undefined,
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

const { ClaudeCodeEngine } = await import('./engine');

async function run(over: Partial<TurnInput>) {
  const engine = new ClaudeCodeEngine(
    { workspace: async () => '/tmp' } as unknown as SettingsStore,
    { value: async () => undefined } as unknown as ProviderKeys,
  );
  const input: TurnInput = {
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
  for await (const _ of engine.runTurn(input)) void _;
  return started.at(-1);
}

describe('Claude Code’s sealed box (ADR 0028, ADR 0148)', () => {
  it('reaches the registries, code hosts and the folder’s own remotes without a question', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'conch-cc-'));
    execFileSync('git', ['-C', cwd, 'init', '-q']);
    execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin', 'https://git.example.org/a.git']);
    const options = await run({ cwd, sandbox: { allowWrite: [cwd], denyRead: ['/keys'] } });
    expect(options?.sandbox?.network?.allowedDomains).toEqual(
      expect.arrayContaining([
        'registry.npmjs.org:443',
        'pypi.org:443',
        'github.com:443',
        'git.example.org:443',
      ]),
    );
    // Any other host still asks Conch, as before: nothing it reached is refused now.
    expect(options?.sandbox?.network?.strictAllowlist).toBeUndefined();
    expect(options?.sandbox?.network?.deniedDomains).toBeUndefined();
    expect(options?.sandbox?.filesystem).toEqual({ allowWrite: [cwd], denyRead: ['/keys'] });
    expect(options?.sandbox).toMatchObject({ enabled: true, allowUnsandboxedCommands: true });
  });

  it('has no box where this computer can’t make one', async () => {
    const options = await run({});
    expect(options?.sandbox).toBeUndefined();
  });
});
