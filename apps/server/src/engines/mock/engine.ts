import type {
  Capabilities,
  EngineState,
  EngineStatus,
  LoginMethod,
  LoginState,
} from '@conch/protocol';

import { newId } from '../../lib/ids';
import { installHints } from '../claude-code/detect';
import { severityFor } from '@conch/protocol';

import { Emitter } from '../../lib/emitter';
import type {
  Completion,
  CompletionInput,
  Engine,
  EngineEvent,
  EngineUsage,
  LimitSignal,
  LoginHandle,
  TurnInput,
} from '../types';

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/**
 * Split text the way real models deliver it: clumps of a few to a few dozen
 * characters with irregular pauses between them (deterministic, for tests).
 */
function bursts(text: string): { text: string; pause: number }[] {
  const out: { text: string; pause: number }[] = [];
  let seed = text.length;
  const next = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < text.length;) {
    const size = 4 + Math.floor(next() * 36);
    out.push({ text: text.slice(i, i + size), pause: 20 + Math.floor(next() * 140) });
    i += size;
  }
  return out;
}

const STOPWORDS = new Set(
  'the and for you your can could would should please with that this what how are about from into have just like need want me my our'.split(
    ' ',
  ),
);

/**
 * A scripted engine for UI development and end-to-end tests. It walks the
 * same paths as the real one — not installed, signed out, sign-in, streaming,
 * tools, permissions and memory — without spending a single token.
 *
 * `CONCH_MOCK_STATE` picks the starting state; `CONCH_MOCK_SPEED` scales delays;
 * `CONCH_MOCK_USAGE` (`plan` · `metered` · `exhausted`) picks how limits look.
 */
export class MockEngine implements Engine {
  readonly id = 'mock' as const;
  readonly label = 'Claude Code';
  #state: EngineState;
  #speed: number;
  #installAfter?: number;
  #checks = 0;
  #usageMode: 'plan' | 'metered' | 'exhausted';
  /** Share of the 5-hour window used; each turn spends a little of it. */
  #sessionUsed: number;
  #limits = new Emitter<LimitSignal>();

  /**
   * @param installAfter when starting `not-installed`, pretend the user installs
   *   Claude Code after this many forced re-checks (exercises auto-detection).
   */
  constructor(
    options: { state?: string; speed?: number; installAfter?: number; usage?: string } = {},
  ) {
    this.#state = (options.state as EngineState | undefined) ?? 'ready';
    this.#speed = options.speed ?? 1;
    this.#installAfter = options.installAfter;
    this.#usageMode =
      options.usage === 'metered' || options.usage === 'exhausted' ? options.usage : 'plan';
    this.#sessionUsed = this.#usageMode === 'exhausted' ? 100 : 38;
  }

  async detect({ force = false } = {}): Promise<EngineStatus> {
    if (force && this.#installAfter !== undefined && ++this.#checks >= this.#installAfter)
      this.install();
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

  async capabilities(): Promise<Capabilities> {
    const efforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
    return {
      engine: 'claude-code',
      label: 'Claude Code',
      models: [
        {
          id: 'default',
          label: 'Default',
          description: 'Use the default model (currently Opus 5.5)',
          efforts: [...efforts],
          supportsFastMode: true,
          supportsAutoMode: true,
        },
        {
          id: 'opus',
          label: 'Opus 5.5',
          description: 'Most capable for complex work',
          efforts: [...efforts],
          supportsFastMode: true,
          supportsAutoMode: true,
        },
        {
          id: 'sonnet',
          label: 'Sonnet 5.5',
          description: 'Fast and capable for everyday tasks',
          efforts: [...efforts],
          supportsFastMode: false,
          supportsAutoMode: true,
        },
        {
          id: 'haiku',
          label: 'Haiku 4.5',
          description: 'Quickest for simple questions',
          efforts: [],
          supportsFastMode: false,
          supportsAutoMode: false,
        },
      ],
      commands: [
        {
          name: 'compact',
          description: 'Summarise the conversation to free up context',
          argumentHint: '[instructions]',
        },
        { name: 'review', description: 'Review the current changes', argumentHint: '' },
        { name: 'init', description: 'Create a CLAUDE.md for this project', argumentHint: '' },
      ],
      permissionModes: ['default', 'auto', 'acceptEdits', 'plan', 'bypassPermissions'],
    };
  }

  async setApiKey(apiKey: string | undefined): Promise<void> {
    if (apiKey) this.#state = 'ready';
  }

  async usage(): Promise<EngineUsage> {
    if (this.#state !== 'ready') return { kind: 'unknown', source: this.label, windows: [] };
    if (this.#usageMode === 'metered')
      return { kind: 'metered', source: 'Amazon Bedrock', windows: [] };
    const now = Date.now();
    const hour = 3_600_000;
    return {
      kind: 'plan',
      source: 'Claude Max',
      windows: [
        {
          id: 'session',
          label: 'Current session',
          usedPercent: this.#sessionUsed,
          resetsAt: now + (this.#usageMode === 'exhausted' ? 0.6 : 2.2) * hour,
          severity: severityFor(this.#sessionUsed),
        },
        {
          id: 'weekly',
          label: 'This week',
          scope: 'all models',
          usedPercent: 61,
          resetsAt: now + 74 * hour,
          severity: severityFor(61),
        },
        {
          id: 'weekly-opus',
          label: 'This week',
          scope: 'Opus',
          usedPercent: 22,
          resetsAt: now + 74 * hour,
          severity: severityFor(22),
        },
      ],
    };
  }

  onLimits(listener: (signal: LimitSignal) => void): () => void {
    return this.#limits.on(listener);
  }

  /** Each mock turn uses a bit of the session window, so meters visibly move. */
  #spend() {
    if (this.#usageMode === 'metered') return;
    this.#sessionUsed = Math.min(100, this.#sessionUsed + 4);
    const status =
      this.#sessionUsed >= 100 ? 'rejected' : this.#sessionUsed >= 75 ? 'warning' : 'allowed';
    this.#limits.emit({ status, windowId: 'session', resetsAt: Date.now() + 2.2 * 3_600_000 });
  }

  /** Models asked to complete, most recent last (tests read this). */
  readonly completions: (string | undefined)[] = [];

  /**
   * Names a chat the way a small model would: greetings get a description,
   * anything else its key words. Say "untitled" to get a reply that fails the
   * quality check, or "title-fail" to make the request fail.
   */
  async complete(input: CompletionInput): Promise<Completion> {
    this.completions.push(input.model);
    await sleep(1400 * this.#speed, input.signal);
    const message = /<message>\n([\s\S]*)\n<\/message>/.exec(input.prompt)?.[1] ?? input.prompt;
    if (/title-fail/i.test(message)) throw new Error('Mock completion failed.');
    const usage = { inputTokens: 120, outputTokens: 8, costUsd: 0.0002 };
    if (/untitled/i.test(message)) return { text: 'Untitled', usage };
    if (/^\s*(hi|hello|hey|good (morning|afternoon|evening))\b/i.test(message)) {
      return { text: 'Friendly check-in', usage };
    }
    const words = message
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()))
      .slice(0, 5);
    return { text: words.join(' ').toLowerCase(), usage };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const wait = (ms: number) => sleep(ms * this.#speed, input.signal);
    const messageId = newId('msg');
    this.#spend();
    try {
      yield { type: 'session', resumeId: input.resumeId ?? newId('mock-session'), model: 'mock' };
      await wait(700);
      // Reasoning streams in uneven clumps, like the real thing.
      const thought = `The question is about "${input.prompt.slice(0, 48)}". Let me consider what they actually need, what they already know, and the clearest way to put it — starting with the essentials, then one concrete example.`;
      for (const chunk of bursts(thought)) {
        yield { type: 'thinking', messageId, delta: chunk.text };
        await wait(chunk.pause);
      }

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

      const { model = 'default', effort, fastMode, permissionMode } = input.options;
      const setup = `*${model} · ${effort} effort${fastMode ? ' · fast' : ''} · ${permissionMode}*`;
      if (/^\/\w/.test(input.prompt)) {
        yield {
          type: 'text',
          messageId,
          delta: `Ran \`${input.prompt.split(' ')[0]}\` — ${setup}`,
        };
        yield { type: 'message-done', messageId };
        yield { type: 'done', outcome: 'success' };
        return;
      }
      if (/retry/.test(text)) {
        yield {
          type: 'notice',
          code: 'retry',
          message: 'Claude is overloaded right now. Retrying in 2s (attempt 1 of 10).',
        };
        await wait(1500);
      }

      // Routines: draft one when asked for something recurring; report outcomes on runs.
      const createRoutine = input.tools.find((t) => t.name === 'create_routine');
      if (
        createRoutine &&
        /\b(every (morning|day|weekday|week)|each (morning|day)|remind me)\b/i.test(text)
      ) {
        const toolUseId = newId('tool');
        const args = {
          title: 'Morning briefing',
          summary: 'A short summary of today’s calendar and the weather.',
          prompt:
            'Look at my calendar for today and the local weather, then write a short, friendly briefing.',
          schedule: { type: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '07:30' },
        };
        yield { type: 'tool-start', toolUseId, name: 'mcp__conch__create_routine', input: args };
        const output = await createRoutine.run(args as never);
        yield { type: 'tool-end', toolUseId, status: 'success', output };
        const confirm =
          "I've drafted a **Morning briefing** for weekdays at 7:30. Turn it on from the card when you're happy with it.";
        for (const chunk of confirm.match(/.{1,6}/gs) ?? []) {
          await wait(12);
          yield { type: 'text', messageId, delta: chunk };
        }
        yield { type: 'message-done', messageId };
        yield { type: 'done', outcome: 'success' };
        return;
      }
      const report = input.tools.find((t) => t.name === 'report_outcome');
      if (report) {
        const nothing = /nothing/i.test(text);
        const brief = nothing
          ? 'Nothing new since last time.'
          : 'Good morning! You have **3 meetings** today and rain is expected after 4pm.';
        for (const chunk of brief.match(/.{1,6}/gs) ?? []) {
          await wait(12);
          yield { type: 'text', messageId, delta: chunk };
        }
        yield { type: 'message-done', messageId };
        await report.run({
          status: nothing ? 'nothing-to-do' : 'done',
          summary: nothing
            ? 'Nothing new to report'
            : 'Sent your briefing: 3 meetings and rain after 4pm',
        } as never);
        yield {
          type: 'done',
          outcome: 'success',
          usage: { inputTokens: 900, outputTokens: 120, costUsd: 0.002, durationMs: 2100 },
        };
        return;
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
            '',
            setup,
          ].join('\n');

      for (const chunk of bursts(reply)) {
        await wait(chunk.pause);
        yield { type: 'text', messageId, delta: chunk.text };
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
