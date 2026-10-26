import { describe, expect, it, vi } from 'vitest';

import type { ProviderKeys } from '../../providers/keys';
import type { SettingsStore } from '../../settings/store';
import { Spares } from './spares';

interface Started {
  options: Record<string, unknown>;
  how: 'query' | 'startup';
  prompts: unknown[];
  closed: boolean;
}

const sdk = vi.hoisted(() => ({
  runs: [] as Started[],
  /** What the next answers do: answer, fail, or die before answering (a spare that died). */
  next: [] as ('answer' | 'fail' | 'dead')[],
  auth: undefined as { method: string } | undefined,
}));

function answers(run: Started, prompt: unknown) {
  run.prompts.push(prompt);
  const what = sdk.next.shift() ?? 'answer';
  return {
    close: () => void (run.closed = true),
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      if (what === 'dead') throw new Error('Claude Code exited.');
      yield {
        type: 'result',
        subtype: what === 'fail' ? 'error_during_execution' : 'success',
        is_error: what === 'fail',
        result: '{"ok":true}',
        usage: { input_tokens: 10, output_tokens: 3 },
        total_cost_usd: 0,
      };
    },
  };
}

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: () => ({ type: 'sdk', name: 'conch', instance: {} }),
  tool: (name: string) => ({ name }),
  query: ({ prompt, options }: { prompt: unknown; options: Record<string, unknown> }) => {
    const run: Started = { options, how: 'query', prompts: [], closed: false };
    sdk.runs.push(run);
    return answers(run, prompt);
  },
  startup: async ({ options }: { options: Record<string, unknown> }) => {
    const run: Started = { options, how: 'startup', prompts: [], closed: false };
    sdk.runs.push(run);
    let used = false;
    return {
      query: (prompt: unknown) => {
        if (used) throw new Error('A warm query answers once.');
        used = true;
        return answers(run, prompt);
      },
      close: () => void (run.closed = true),
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
    ...(sdk.auth && { auth: sdk.auth }),
  }),
}));

const { ClaudeCodeEngine, spareKey } = await import('./engine');

function engine() {
  return new ClaudeCodeEngine(
    { workspace: async () => '/tmp/work' } as unknown as SettingsStore,
    { value: async () => undefined } as unknown as ProviderKeys,
  );
}

const review = (over: { warm?: boolean; system?: string; signal?: AbortSignal } = {}) => ({
  system: over.system ?? 'Judge the action.',
  prompt: 'The action is between the fences.',
  model: 'haiku',
  signal: over.signal ?? new AbortController().signal,
  ...(over.warm !== undefined && { warm: over.warm }),
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Claude Code’s fast reviewer (ADR 0147)', () => {
  it('declares Haiku, by the alias Claude Code takes on every sign-in', async () => {
    expect(await engine().reviewModel()).toBe('haiku');
  });
});

describe('Claude Code’s short answers, warm (ADR 0147)', () => {
  it('starts the next review’s process ahead, and the next review takes it', async () => {
    sdk.runs.length = 0;
    const cc = engine();
    expect((await cc.complete(review({ warm: true }))).text).toBe('{"ok":true}');
    await settle();
    // The first answer started cold, and a spare for the same options now waits.
    expect(sdk.runs.map((r) => r.how).sort()).toEqual(['query', 'startup']);
    const spare = sdk.runs.find((r) => r.how === 'startup');
    expect(spare?.options).toMatchObject({
      tools: [],
      mcpServers: {},
      maxTurns: 1,
      persistSession: false,
      thinking: { type: 'disabled' },
      model: 'haiku',
      systemPrompt: 'Judge the action.',
    });

    await cc.complete(review({ warm: true }));
    await settle();
    // The second answer was the spare's one prompt; another spare starts for the next.
    expect(spare?.prompts).toEqual(['The action is between the fences.']);
    expect(sdk.runs.filter((r) => r.how === 'startup')).toHaveLength(2);
    expect(sdk.runs.filter((r) => r.how === 'query')).toHaveLength(1);
  });

  it('never gives one process two answers, and never a spare made for other options', async () => {
    sdk.runs.length = 0;
    const cc = engine();
    await cc.complete(review({ warm: true }));
    await settle();
    await cc.complete(review({ warm: true, system: 'Another reviewer.' }));
    await settle();
    const used = sdk.runs.filter((r) => r.prompts.length);
    for (const run of used) expect(run.prompts).toHaveLength(1);
    // The second system prompt found no spare of its own: it started cold.
    expect(sdk.runs.filter((r) => r.how === 'query')).toHaveLength(2);
  });

  it('keeps nothing ready for a request that isn’t warm', async () => {
    sdk.runs.length = 0;
    const cc = engine();
    await cc.complete(review());
    await cc.complete(review());
    await settle();
    expect(sdk.runs.map((r) => r.how)).toEqual(['query', 'query']);
  });

  it('answers anew when the spare died while it waited', async () => {
    sdk.runs.length = 0;
    const cc = engine();
    await cc.complete(review({ warm: true }));
    await settle();
    sdk.next.push('dead');
    expect((await cc.complete(review({ warm: true }))).text).toBe('{"ok":true}');
    await settle();
    const dead = sdk.runs.find((r) => r.how === 'startup');
    expect(dead?.prompts).toHaveLength(1);
    expect(dead?.closed).toBe(true);
    expect(sdk.runs.filter((r) => r.how === 'query')).toHaveLength(2);
  });

  it('lets every spare go when the sign-in changes', async () => {
    sdk.runs.length = 0;
    const cc = engine();
    await cc.complete(review({ warm: true }));
    await settle();
    await cc.setApiKey();
    await settle();
    expect(sdk.runs.find((r) => r.how === 'startup')?.closed).toBe(true);
  });

  it('tries the lighter way first on a subscription, and the usual way only if it fails', async () => {
    sdk.runs.length = 0;
    sdk.auth = { method: 'subscription' };
    try {
      const cc = engine();
      sdk.next.push('fail');
      await cc.complete(review());
      expect(sdk.runs.map((r) => r.options.settingSources)).toEqual([[], ['user']]);
    } finally {
      sdk.auth = undefined;
    }
  });

  it('keeps secrets in the environment out of the key a spare is found by', () => {
    const key = spareKey({ env: { ANTHROPIC_API_KEY: 'sk-ant-' + 'secret' }, model: 'haiku' });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('secret');
    expect(spareKey({ env: { ANTHROPIC_API_KEY: 'sk-ant-' + 'other' }, model: 'haiku' })).not.toBe(
      key,
    );
    // The stop button isn't part of what the process was started with.
    expect(spareKey({ model: 'haiku', abortController: new AbortController() })).toBe(
      spareKey({ model: 'haiku' }),
    );
  });
});

describe('spares waiting for a prompt', () => {
  it('lets one nobody took go after a while, and keeps no more than a few', async () => {
    vi.useFakeTimers();
    try {
      const released: string[] = [];
      const spares = new Spares<string>((s) => void released.push(s), { waitMs: 1_000, max: 2 });
      spares.keep('a', async () => 'A');
      spares.keep('a', async () => 'A2');
      expect(spares.size).toBe(1);
      spares.keep('b', async () => 'B');
      spares.keep('c', async () => 'C');
      await vi.advanceTimersByTimeAsync(0);
      // The oldest went first.
      expect(released).toEqual(['A']);
      expect(await spares.take('b')).toBe('B');
      expect(spares.take('b')).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(released).toEqual(['A', 'C']);
      expect(spares.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets one that couldn’t start', async () => {
    const spares = new Spares<string>(() => undefined);
    spares.keep('a', async () => {
      throw new Error('no Claude Code');
    });
    await settle();
    expect(spares.take('a')).toBeUndefined();
  });
});
