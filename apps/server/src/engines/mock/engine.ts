import type { EngineState, EngineStatus, LoginMethod, LoginState } from '@conch/protocol';

import { newId } from '../../lib/ids';
import { installHints } from '../claude-code/detect';
import type { Engine, EngineEvent, LoginHandle, TurnInput } from '../types';

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/**
 * A scripted engine for UI development and end-to-end tests. It walks the
 * same paths as the real one — not installed, signed out, sign-in, streaming,
 * tools, permissions and memory — without spending a single token.
 *
 * `CONCH_MOCK_STATE` picks the starting state; `CONCH_MOCK_SPEED` scales delays.
 */
export class MockEngine implements Engine {
  readonly id = 'mock' as const;
  readonly label = 'Claude Code';
  #state: EngineState;
  #speed: number;
  #installAfter?: number;
  #checks = 0;

  /**
   * @param installAfter when starting `not-installed`, pretend the user installs
   *   Claude Code after this many forced re-checks (exercises auto-detection).
   */
  constructor(options: { state?: string; speed?: number; installAfter?: number } = {}) {
    this.#state = (options.state as EngineState | undefined) ?? 'ready';
    this.#speed = options.speed ?? 1;
    this.#installAfter = options.installAfter;
  }

  async detect({ force = false } = {}): Promise<EngineStatus> {
    if (force && this.#installAfter !== undefined && ++this.#checks >= this.#installAfter) this.install();
    const base = {
      engine: 'claude-code' as const,
      label: 'Claude Code',
      install: installHints(),
      docsUrl: 'https://code.claude.com/docs/en/setup',
      canSignIn: true,
      checkedAt: Date.now(),
    };
    if (this.#state === 'not-installed') {
      return {
        ...base,
        state: 'not-installed',
        message: "Claude Code isn't installed on this computer yet.",
      };
    }
    if (this.#state === 'signed-out') return { ...base, state: 'signed-out', version: '2.1.284' };
    return {
      ...base,
      state: 'ready',
      version: '2.1.284',
      executablePath: '/usr/local/bin/claude',
      auth: { method: 'subscription', description: 'Claude Max · you@example.com' },
    };
  }

  /** Test hook: "install" Claude Code. */
  install() {
    if (this.#state === 'not-installed') this.#state = 'signed-out';
  }

  login(method: LoginMethod, onUpdate: (state: LoginState) => void): LoginHandle {
    const loginId = newId('login');
    let cancelled = false;
    const run = async () => {
      onUpdate({ loginId, phase: 'starting' });
      await sleep(400 * this.#speed);
      onUpdate({
        loginId,
        phase: 'waiting-for-browser',
        url: `https://claude.ai/oauth/authorize?mock=1&method=${method}`,
      });
      await sleep(2200 * this.#speed);
      if (cancelled) return;
      onUpdate({ loginId, phase: 'verifying' });
      await sleep(500 * this.#speed);
      if (cancelled) return;
      this.#state = 'ready';
      onUpdate({ loginId, phase: 'done', message: 'Signed in.' });
    };
    void run();
    return {
      submitCode: () => {},
      cancel: () => {
        cancelled = true;
        onUpdate({ loginId, phase: 'cancelled' });
      },
    };
  }

  async setApiKey(apiKey: string | undefined): Promise<void> {
    if (apiKey) this.#state = 'ready';
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const wait = (ms: number) => sleep(ms * this.#speed, input.signal);
    const messageId = newId('msg');
    try {
      yield { type: 'session', resumeId: input.resumeId ?? newId('mock-session'), model: 'mock' };
      await wait(700);
      yield { type: 'thinking', messageId, delta: 'Considering how best to help…' };
      await wait(500);

      const text = input.prompt.toLowerCase();
      const rememberMatch = /remember (?:that )?(.+)/i.exec(input.prompt);
      if (rememberMatch?.[1]) {
        const toolUseId = newId('tool');
        const args = { content: rememberMatch[1].replace(/[.!]$/, ''), kind: 'fact' as const };
        yield { type: 'tool-start', toolUseId, name: 'mcp__conch__remember', input: args };
        const memoryTool = input.tools.find((t) => t.name === 'remember');
        const output = memoryTool ? await memoryTool.run(args) : 'Saved.';
        yield { type: 'tool-end', toolUseId, status: 'success', output };
      }

      if (/\b(run|list|files?|test)\b/.test(text)) {
        const toolUseId = newId('tool');
        const command = /test/.test(text) ? 'npm test' : 'ls -la';
        const decision = await input.requestPermission(
          { toolName: 'Bash', toolUseId, input: { command, description: 'Inspect the workspace' } },
          input.signal,
        );
        yield { type: 'tool-start', toolUseId, name: 'Bash', input: { command } };
        await wait(900);
        yield decision === 'deny'
          ? {
              type: 'tool-end',
              toolUseId,
              status: 'error',
              output: 'The user declined this action.',
            }
          : {
              type: 'tool-end',
              toolUseId,
              status: 'success',
              output:
                'total 16\ndrwxr-xr-x  4 you  staff  128 notes\n-rw-r--r--  1 you  staff  412 todo.md',
            };
      }

      const reply = rememberMatch
        ? "Got it — I'll remember that. You can see and edit everything I remember in **Settings → Memory**."
        : [
            `Here's a thought on **"${input.prompt.slice(0, 60)}"**.`,
            '',
            "I'm the mock engine, so this reply is scripted — but it streams, formats and behaves exactly like the real thing:",
            '',
            '- Markdown renders beautifully',
            '- Code blocks get highlighting',
            '',
            '```ts',
            'const greeting = (name: string) => `Hello, ${name}!`;',
            '```',
            '',
            'Ask me to *remember* something, or to *list files*, to see memory and permissions in action.',
          ].join('\n');

      for (const chunk of reply.match(/.{1,6}/gs) ?? []) {
        await wait(18);
        yield { type: 'text', messageId, delta: chunk };
      }
      yield { type: 'message-done', messageId };
      yield {
        type: 'done',
        outcome: 'success',
        usage: { inputTokens: 1200, outputTokens: 180, costUsd: 0.0031, durationMs: 4200 },
      };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        yield { type: 'message-done', messageId };
        yield { type: 'done', outcome: 'interrupted' };
        return;
      }
      throw error;
    }
  }
}
