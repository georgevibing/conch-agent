import type {
  Capabilities,
  EngineState,
  EngineStatus,
  LoginMethod,
  LoginState,
} from '@conch/protocol';

import { newId } from '../../lib/ids';
import { installHints } from '../claude-code/detect';
import { friendlyError } from '../claude-code/translate';
import { severityFor } from '@conch/protocol';

import { Emitter } from '../../lib/emitter';
import { hostToolText } from '../types';
import type {
  Completion,
  CompletionInput,
  Engine,
  EngineEvent,
  EngineIntegrations,
  EngineMcpStatus,
  EngineUsage,
  LimitSignal,
  LoginHandle,
  TurnInput,
} from '../types';

/**
 * A pause that ends early on Stop. A Stop that came while the engine was busy
 * between pauses counts too: the abort event has already fired by then, so it
 * must be read from the signal, not waited for.
 */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const aborted = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) return aborted();
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(t);
      aborted();
    };
    signal?.addEventListener('abort', stop, { once: true });
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
  /**
   * The mock is a "bridge" engine, like a plain model API would be: Conch
   * connects to the integrations and hands it their tools. That keeps the
   * bridge exercised end to end, while Claude Code covers the native path.
   */
  readonly integrations: EngineIntegrations = {
    mode: 'bridge',
    account: {
      label: 'your Claude account',
      url: 'https://claude.ai/settings/connectors',
      ready: () => ({ ready: true }),
    },
  };
  /** Sees images, can't open files: the degraded file path gets exercised too. */
  readonly attachments = { images: true, files: false };
  #state: EngineState;
  #signedOutOnce = false;
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
    // A skill to name and describe: answer in the shape Conch asks for.
    const skill = /<instructions>\n([\s\S]*)\n<\/instructions>/.exec(input.prompt)?.[1];
    if (skill !== undefined) {
      if (/draft-fail/i.test(skill)) throw new Error('Mock completion failed.');
      const [first = 'Tidy', second = 'things'] = skill
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOPWORDS.has(w.toLowerCase()));
      const title = `${first.charAt(0).toUpperCase()}${first.slice(1).toLowerCase()} ${second.toLowerCase()}`;
      return {
        text: JSON.stringify({
          title,
          does: `Handles ${title.toLowerCase()} the way you described`,
          when: `Use when you ask about ${second.toLowerCase()}`,
        }),
        usage: { inputTokens: 300, outputTokens: 40, costUsd: 0.0004 },
      };
    }
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

  /** Pretend Claude Code has a couple of servers of its own, one of them signed out. */
  async mcpStatus(): Promise<EngineMcpStatus[]> {
    if (process.env.CONCH_MOCK_EXTERNAL === 'none') return [];
    return [
      { name: 'Google Calendar', status: 'connected', source: 'account', toolCount: 7 },
      { name: 'Gmail', status: 'needs-auth', source: 'account', toolCount: 0 },
      { name: 'filesystem', status: 'connected', source: 'engine', toolCount: 11 },
    ];
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const wait = (ms: number) => sleep(ms * this.#speed, input.signal);
    const messageId = newId('msg');
    this.#spend();
    try {
      yield { type: 'session', resumeId: input.resumeId ?? newId('mock-session'), model: 'mock' };
      // Scripted for tests and demos: the sign-in ends in the middle of a chat
      // (once, so the message that goes again after signing in gets its reply).
      if (
        !this.#signedOutOnce &&
        /pretend (?:you(?:'|’)?re|to be) signed out/i.test(input.prompt)
      ) {
        this.#signedOutOnce = true;
        this.#state = 'signed-out';
        yield {
          type: 'done',
          outcome: 'error',
          error: friendlyError('authentication_failed'),
          problem: 'signed-out',
        };
        return;
      }
      await wait(700);
      // Reasoning streams in uneven clumps, like the real thing.
      // What the person typed, without the attachments block in front of it.
      const said = input.prompt.replace(/^<attachments>[\s\S]*?<\/attachments>\n*/, '');
      const attached = [...input.prompt.matchAll(/<attachment name="([^"]*)" type="([^"]*)"/g)].map(
        (m) => `${m[1]} (${m[2]})`,
      );
      const thought = `The question is about "${said.slice(0, 48)}". Let me consider what they actually need, what they already know, and the clearest way to put it — starting with the essentials, then one concrete example.`;
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
        const output = memoryTool ? hostToolText(await memoryTool.run(args)) : 'Saved.';
        yield { type: 'tool-end', toolUseId, status: 'success', output };
      }

      // Passwords (ADR 0025): asking for a credential, and reading one field with a yes.
      const vaultTool = async function* (name: string, args: Record<string, unknown>) {
        const tool = input.tools.find((t) => t.name === name);
        const toolUseId = newId('tool');
        yield { type: 'tool-start', toolUseId, name: `mcp__conch__${name}`, input: args } as const;
        const output = tool ? hostToolText(await tool.run(args as never)) : '';
        yield { type: 'tool-end', toolUseId, status: 'success', output } as const;
        return output;
      };
      const askFor = /\bask me for my ([a-z0-9.-]+) (login|password|key)\b/i.exec(input.prompt);
      const readField = /\bread the ([a-z ]+?) (?:of|from) ([\w ’'-]+?)[.?!]*$/i.exec(
        input.prompt.trim(),
      );
      if (askFor?.[1] || readField?.[2]) {
        let reply: string;
        if (askFor?.[1]) {
          const site = askFor[1];
          const out = yield* vaultTool('passwords_request', {
            title: site,
            type: askFor[2] === 'key' ? 'apiKey' : 'login',
            site,
            reason: `To sign in to ${site} for you`,
          });
          reply = /saved it/.test(out)
            ? `Thanks — it’s in your Passwords now. I never saw it, and I’ll use it to sign in to ${site}.`
            : 'No problem, I’ll do without it.';
        } else {
          const [, field = '', title = ''] = readField ?? [];
          const found = yield* vaultTool('passwords_find', { query: title });
          const id = /id=([A-Za-z0-9_-]+)/.exec(found)?.[1];
          const out = id
            ? yield* vaultTool('passwords_read', {
                item: id,
                field,
                reason: 'You asked me to use it',
              })
            : 'not found';
          reply = /said no/.test(out)
            ? 'Understood, I won’t use it.'
            : id
              ? `I have the ${field.toLowerCase()} now and will only use it for this.`
              : `I couldn’t find “${title}” in your Passwords.`;
        }
        for (const chunk of bursts(reply)) {
          await wait(chunk.pause);
          yield { type: 'text', messageId, delta: chunk.text };
        }
        yield { type: 'message-done', messageId };
        yield { type: 'done', outcome: 'success' };
        return;
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

      // Integrations (bridged, like a plain model API): mention one by name and
      // the mock really calls its tools through Conch — searching, or writing if asked.
      const servers = [
        ...new Set((input.bridgedTools ?? []).map((t) => t.name.split('__')[1] ?? '')),
      ];
      const server = servers.find((name) =>
        text.includes(name.replace(/-\d+$/, '').replace(/-/g, ' ')),
      );
      const write = /\b(create|add|make|write)\b/.test(text);
      const tool = server
        ? (input.bridgedTools ?? []).find(
            (t) => t.name === `mcp__${server}__${write ? 'create_page' : 'search'}`,
          )
        : undefined;
      if (tool) {
        const toolUseId = newId('tool');
        const args = write ? { title: 'Notes from Conch' } : { query: input.prompt.slice(0, 40) };
        yield { type: 'tool-start', toolUseId, name: tool.name, input: args };
        const result = await tool.run(args, toolUseId);
        yield {
          type: 'tool-end',
          toolUseId,
          status: result.isError ? 'error' : 'success',
          output: result.text,
        };
        const reply = result.isError
          ? 'No problem — I left it alone.'
          : write
            ? 'Done — I created **Notes from Conch** for you.'
            : `I found **3 results**. The most recent one is from yesterday.`;
        for (const chunk of reply.match(/.{1,6}/gs) ?? []) {
          await wait(12);
          yield { type: 'text', messageId, delta: chunk };
        }
        yield { type: 'message-done', messageId };
        yield { type: 'done', outcome: 'success' };
        return;
      }

      // Asked about an app that isn't connected (Conch offered to connect it):
      // say so, the way the prompt asks a real model to, instead of making it up.
      const unseen = /## Not connected yet\n(.+?) (?:isn’t|aren’t) connected/.exec(
        input.systemAppend,
      )?.[1];
      if (unseen) {
        const honest = `I can’t see your ${unseen} yet, so I won’t guess at what’s in it. Once ${unseen} is connected, I can look that up for you.`;
        for (const chunk of bursts(honest)) {
          await wait(chunk.pause);
          yield { type: 'text', messageId, delta: chunk.text };
        }
        yield { type: 'message-done', messageId };
        yield { type: 'done', outcome: 'success' };
        return;
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
        const output = hostToolText(await createRoutine.run(args as never));
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
      // The browser: open what was asked for, click what was named, hand over to sign in.
      const address =
        /\b(https?:\/\/[^\s)"”]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s)"”]*)?)/i.exec(
          input.prompt,
        )?.[1];
      const canBrowse = input.tools.some((t) => t.name === 'browser_open');
      if (
        canBrowse &&
        address &&
        /\b(browse|browser|website|web ?page|open|go to|look at)\b/.test(text)
      ) {
        const use = async function* (name: string, args: Record<string, unknown>) {
          const tool = input.tools.find((t) => t.name === name);
          const toolUseId = newId('tool');
          yield {
            type: 'tool-start',
            toolUseId,
            name: `mcp__conch__${name}`,
            input: args,
          } as const;
          const output = tool ? hostToolText(await tool.run(args as never)) : '';
          yield { type: 'tool-end', toolUseId, status: 'success', output } as const;
          return output;
        };
        let page = yield* use('browser_open', { url: address });
        const title = /^Page: (.*)$/m.exec(page)?.[1] ?? address;
        const done: string[] = [`opened **${title}**`];
        const target = /\bclick(?:s|ing)?\s+(?:on\s+)?[“"']([^”"']+)[”"']/i.exec(input.prompt)?.[1];
        if (target) {
          const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const ref = new RegExp(
            `(?:button|link)\\s+"${escaped}"[^\\n]*?\\[ref=([a-z0-9]+)\\]`,
            'i',
          ).exec(page)?.[1];
          if (ref) {
            page = yield* use('browser_click', { ref, element: target });
            done.push(
              /said no|doesn’t want|Plan only/.test(page)
                ? `didn’t click “${target}” (${page.split('\n')[0]})`
                : `clicked “${target}”`,
            );
          }
        }
        if (/\bsign(?:ed)? in\b|\blog ?in\b/.test(text)) {
          page = yield* use('browser_handoff', {
            reason: `Sign in to ${new URL(/^https?:/.test(address) ? address : `https://${address}`).host}, then hand the browser back.`,
          });
          done.push(
            /user is done/i.test(page) ? 'waited while you signed in' : 'asked you to sign in',
          );
        }
        const summary = `I ${done.join(', then ')}. You can watch it in the browser panel, and take over any time.`;
        for (const chunk of summary.match(/.{1,6}/gs) ?? []) {
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

      // "Take your time" writes until it's stopped (a minute at most), so a test
      // of Stop never races the end of a short scripted reply on a slow machine.
      if (/\btake your time\b/i.test(said)) {
        yield { type: 'text', messageId, delta: 'Let me think this through properly.' };
        for (let i = 0; i < 120; i++) {
          await sleep(500, input.signal);
          yield { type: 'text', messageId, delta: ' Still going…' };
        }
        yield { type: 'message-done', messageId };
        yield { type: 'done', outcome: 'success' };
        return;
      }

      const reply = rememberMatch
        ? "Got it — I'll remember that. You can see and edit everything I remember in **Settings → Memory**."
        : attached.length
          ? [
              `You attached ${attached.length === 1 ? 'one thing' : `${attached.length} things`}: ${attached.join(', ')}.`,
              ...(input.images?.length
                ? [
                    '',
                    `I can see ${input.images.length === 1 ? 'the image' : `${input.images.length} images`}.`,
                  ]
                : []),
              ...(said.trim() ? ['', `And you said: “${said.trim().slice(0, 80)}”.`] : []),
            ].join('\n')
          : [
              `Here's a thought on **"${said.slice(0, 60)}"**.`,
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
