import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type Capabilities,
  type ConversationEvent,
  type EngineId,
  type EngineStatus,
  type ModelInfo,
  type SwitchCandidate,
  switchCandidates,
} from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { ConversationManager, type ToolContext } from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import { chipTapped, previousModel } from '../conversations/switching';
import type { Engine, EngineEvent, HostTool, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { switchSection, switchTools, type SwitchDeps } from './tools';

const model = (id: string, label: string, more: Partial<ModelInfo> = {}): ModelInfo => ({
  id,
  label,
  description: '',
  efforts: [],
  supportsFastMode: false,
  supportsAutoMode: false,
  ...more,
});

/**
 * A provider that answers "<label> heard: <prompt>". When the prompt asks it
 * to (`switch:<words>[:carry]`), it calls `switch_model` first, as a model would.
 */
class FakeEngine implements Engine {
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  results: string[] = [];

  constructor(
    readonly id: EngineId,
    readonly label: string,
    readonly models: ModelInfo[],
    readonly method: 'subscription' | 'api-key' = 'subscription',
  ) {}

  async detect(): Promise<EngineStatus> {
    return {
      engine: this.id,
      label: this.label,
      state: 'ready',
      auth: { method: this.method, description: `${this.label} plan · you@example.com` },
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }

  async capabilities(): Promise<Capabilities> {
    return {
      engine: this.id,
      label: this.label,
      models: this.models,
      commands: [],
      permissionModes: ['default', 'auto'],
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    yield { type: 'session', resumeId: `${this.id}-s`, model: input.options.model ?? 'x' };
    // Carried on after a switch, it does the work: it was told not to switch again.
    const asked = input.prompt.includes("don't switch again")
      ? null
      : /switch:([^:\n]+)(:carry)?/.exec(input.prompt);
    if (asked?.[1]) {
      const tool = input.tools.find((t) => t.name === 'switch_model') as HostTool | undefined;
      const result = await tool?.run({ to: asked[1], carry_on: Boolean(asked[2]) });
      this.results.push(typeof result === 'string' ? result : (result?.text ?? 'no tool'));
    }
    yield {
      type: 'text',
      messageId: `m${Math.random()}`,
      delta: `${this.label} heard: ${input.prompt}`,
    };
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-switch-'));
  const codex = new FakeEngine('codex-agent', 'Codex', [model('gpt-5.5', 'GPT-5.5')]);
  const claude = new FakeEngine('claude-code', 'Claude Code', [
    model('opus', 'Opus 5.5'),
    model('sonnet', 'Sonnet 5.5'),
  ]);
  const anthropic = new FakeEngine(
    'anthropic-api',
    'Anthropic API',
    [model('claude-opus-5-5', 'Claude Opus 5.5')],
    'api-key',
  );
  const engines = new Map<EngineId, FakeEngine>([
    ['codex-agent', codex],
    ['claude-code', claude],
    ['anthropic-api', anthropic],
  ]);
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'codex-agent', autoTitle: false } });
  const candidates = async (): Promise<SwitchCandidate[]> => {
    const providers = await Promise.all(
      [...engines.values()].map(async (e) => ({
        ...(await e.capabilities()),
        local: false,
        billing: e.method === 'subscription' ? ('plan' as const) : ('metered' as const),
        ...(e.method === 'subscription' && { account: `${e.label} plan` }),
      })),
    );
    return switchCandidates({ providers });
  };
  const offerProvider = vi.fn(async () => true);
  const manager: ConversationManager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: (id) => engines.get(id ?? 'codex-agent') ?? codex,
    tools: (ctx: ToolContext) => switchTools(deps(), ctx),
  });
  const deps = (): SwitchDeps => ({
    candidates,
    chat: {
      switchContext: (id) => manager.switchContext(id),
      switchModel: (id, to, how) => manager.switchModel(id, to, how),
      modelChoices: (id, choices, carry) => manager.modelChoices(id, choices, carry),
    },
    offerProvider,
    providerName: (id) => (id === 'gemini-cli' ? 'Gemini CLI' : undefined),
  });
  return { manager, codex, claude, anthropic, offerProvider, candidates };
}

async function idle(manager: ConversationManager, id: string) {
  for (let i = 0; i < 2000; i++) {
    const { conversation } = await manager.detail(id);
    if (conversation.status === 'idle' || conversation.status === 'error') return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

const log = async (manager: ConversationManager, id: string): Promise<ConversationEvent[]> =>
  (await manager.detail(id)).events;

describe('switching models when asked (ADR 0132)', () => {
  it('on Codex, “use Opus 5.5” moves the chat to the Claude plan, with a line, from the next message', async () => {
    const { manager, codex, claude } = await setup();
    const chat = await manager.send({ clientMessageId: 'u1', text: 'switch:Opus 5.5' });
    await idle(manager, chat.id);
    expect(codex.results[0]).toMatch(/^Switched to Opus 5\.5 on Claude Code/);
    const events = await log(manager, chat.id);
    const line = events.find((e) => e.type === 'model.switched');
    expect(line).toMatchObject({
      from: 'codex-agent',
      to: 'claude-code',
      model: 'opus',
      by: 'assistant',
      message: 'Switched to Opus 5.5 on your Claude Code plan',
    });
    // The picker follows: the chat's options say so.
    expect((await manager.detail(chat.id)).conversation.options).toMatchObject({
      engine: 'claude-code',
      model: 'opus',
    });
    // Nothing more this turn; the next message goes to Opus, handed the chat so far.
    expect(claude.turns).toHaveLength(0);
    await manager.send({ conversationId: chat.id, clientMessageId: 'u2', text: 'hello' });
    await idle(manager, chat.id);
    expect(claude.turns).toHaveLength(1);
    expect(claude.turns[0]?.options.model).toBe('opus');
    expect(claude.turns[0]?.prompt).toContain('hello');
  });

  it('“try this with Claude” carries the request on to the new model in the same run', async () => {
    const { manager, codex, claude } = await setup();
    const chat = await manager.send({
      clientMessageId: 'u1',
      text: 'Write a haiku. switch:Claude:carry',
    });
    await idle(manager, chat.id);
    expect(codex.results[0]).toMatch(/carries on with the request/);
    expect(claude.turns).toHaveLength(1);
    const carried = claude.turns[0]?.prompt ?? '';
    expect(carried).toContain("it's done: don't switch again");
    expect(carried).toContain('Write a haiku. switch:Claude:carry');
    const events = await log(manager, chat.id);
    expect(events.filter((e) => e.type === 'turn.completed')).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'status', status: 'idle' });
  });

  it('says so when it’s the model answering already', async () => {
    const { manager, codex } = await setup();
    const chat = await manager.send({ clientMessageId: 'u1', text: 'switch:GPT-5.5' });
    await idle(manager, chat.id);
    expect(codex.results[0]).toMatch(/already answering with GPT-5\.5/);
    expect((await log(manager, chat.id)).some((e) => e.type === 'model.switched')).toBe(false);
  });

  it('offers the few that fit as chips, and a tap switches and carries on without a turn on the old model', async () => {
    const { manager, codex, claude, anthropic } = await setup();
    // Opus 4.1 isn't connected: the closest are offered, a plan's first.
    const chat = await manager.send({
      clientMessageId: 'u1',
      text: 'Fix it. switch:Opus 4.1:carry',
    });
    await idle(manager, chat.id);
    expect(codex.results[0]).toMatch(/isn’t connected; the closest are/);
    const events = await log(manager, chat.id);
    const choices = events.find((e) => e.type === 'model.choices');
    expect(choices?.type === 'model.choices' && choices.choices.map((c) => c.engine)).toEqual([
      'claude-code',
      'anthropic-api',
    ]);
    const replies = events.find((e) => e.type === 'replies');
    expect(replies).toMatchObject({ by: 'conch' });
    const chip = replies?.type === 'replies' ? replies.replies[1]?.text : undefined;
    expect(chip).toBe('Switch to Claude Opus 5.5 on Anthropic API');

    const turnsBefore = codex.turns.length;
    await manager.send({ conversationId: chat.id, clientMessageId: 'u2', text: chip ?? '' });
    await idle(manager, chat.id);
    expect(codex.turns).toHaveLength(turnsBefore);
    expect(claude.turns).toHaveLength(0);
    expect(anthropic.turns).toHaveLength(1);
    expect(anthropic.turns[0]?.prompt).toContain('Fix it. switch:Opus 4.1:carry');
    const after = await log(manager, chat.id);
    expect(after.filter((e) => e.type === 'model.switched').at(-1)).toMatchObject({
      by: 'person',
      to: 'anthropic-api',
      model: 'claude-opus-5-5',
      message: 'Switched to Claude Opus 5.5 on Anthropic API, pay per use',
    });
  });

  it('nothing connected fits: offers to connect the provider that would', async () => {
    const { manager, codex, offerProvider } = await setup();
    const chat = await manager.send({ clientMessageId: 'u1', text: 'switch:Gemini 2.5 Pro' });
    await idle(manager, chat.id);
    expect(offerProvider).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: chat.id }),
      'gemini-cli',
      'Gemini 2.5 Pro',
    );
    expect(codex.results[0]).toMatch(/A card to connect Gemini CLI is under your reply/);
  });

  it('a chat that read something untrusted asks the person to tap, instead of switching', async () => {
    const { manager, codex } = await setup();
    const chat = await manager.send({ clientMessageId: 'u1', text: 'first' });
    await idle(manager, chat.id);
    await manager.addTaint(chat.id, [{ kind: 'web', label: 'a page' }]);
    await manager.send({ conversationId: chat.id, clientMessageId: 'u2', text: 'switch:Opus 5.5' });
    await idle(manager, chat.id);
    expect(codex.results.at(-1)).toMatch(/the person confirms the switch/);
    const events = await log(manager, chat.id);
    expect(events.some((e) => e.type === 'model.switched')).toBe(false);
    expect(events.findLast((e) => e.type === 'replies')).toMatchObject({
      by: 'conch',
      replies: [{ text: 'Switch to Opus 5.5 on Claude Code' }],
    });
  });

  it('switching back goes to the model before, as the person', async () => {
    const { manager } = await setup();
    const chat = await manager.send({ clientMessageId: 'u1', text: 'switch:Sonnet' });
    await idle(manager, chat.id);
    const context = await manager.switchContext(chat.id);
    expect(context.current).toEqual({ engine: 'claude-code', model: 'sonnet' });
    // It began on the default with no model of its own: the provider's default is the one before.
    expect(context.previous).toEqual({ engine: 'codex-agent' });
    // Switch back names the model (`candidateOf` reads the provider's default as its lead).
    const back = await manager.switchModel(
      chat.id,
      { engine: 'codex-agent', model: 'gpt-5.5' },
      {
        by: 'person',
        label: 'GPT-5.5',
        message: 'Back to GPT-5.5 on your Codex plan',
      },
    );
    expect(back).toMatchObject({ switched: true, carrying: false });
    expect((await manager.detail(chat.id)).conversation.options).toMatchObject({
      engine: 'codex-agent',
      model: 'gpt-5.5',
    });
  });

  it('never moves a routine’s or a task’s run', () => {
    const ctx = {
      origin: { kind: 'routine', routineId: 'r', runId: 'x' },
    } as unknown as ToolContext;
    expect(
      switchTools({ candidates: async () => [], chat: {} as SwitchDeps['chat'] }, ctx),
    ).toEqual([]);
  });

  it('in a chat app, asks which in words: nothing to tap there', async () => {
    const { candidates } = await setup();
    const modelChoices = vi.fn(async () => undefined);
    const chips = vi.fn();
    const [tool] = switchTools(
      {
        candidates,
        chat: {
          switchContext: async () => ({
            current: { engine: 'codex-agent', model: 'gpt-5.5' },
            tainted: false,
          }),
          switchModel: vi.fn(),
          modelChoices,
        },
      },
      { conversationId: 'c', unattended: true, chips } as unknown as ToolContext,
    );
    const said = await tool?.run({ to: 'Opus 4.1' });
    expect(said).toMatch(/Ask which one they want, in a few words/);
    expect(chips).not.toHaveBeenCalled();
    expect(modelChoices).not.toHaveBeenCalled();
  });
});

describe('what the assistant is told', () => {
  it('lists the models it can switch to, compactly, the one answering marked', async () => {
    const { candidates } = await setup();
    const section = switchSection(await candidates(), { engine: 'codex-agent', model: 'gpt-5.5' });
    expect(section).toContain('## Models you can switch to');
    expect(section).toContain('call `switch_model` with their words');
    expect(section).toContain('- Codex (your Codex plan): GPT-5.5 [strongest, answering now]');
    expect(section).toContain(
      '- Anthropic API (Anthropic API, pay per use): Claude Opus 5.5 [strongest]',
    );
    expect(section.length).toBeLessThan(1200);
    expect(switchSection([], undefined)).toBe('');
  });
});

describe('reading the log', () => {
  const at = (n: number) => ({ conversationId: 'c', seq: n, at: n });
  it('finds the model before the one now', () => {
    const events = [
      { ...at(1), type: 'options', options: { engine: 'codex-agent', model: 'gpt-5.5' } },
      { ...at(2), type: 'options', options: { engine: 'claude-code', model: 'opus' } },
    ] as ConversationEvent[];
    expect(previousModel(events, { engine: 'claude-code', model: 'opus' })).toEqual({
      engine: 'codex-agent',
      model: 'gpt-5.5',
    });
    expect(previousModel([], { engine: 'claude-code' })).toBeUndefined();
  });

  it('finds the model the chat started on, which wrote no choice of its own', () => {
    const events = [
      { ...at(1), type: 'user.message', text: 'hi' },
      { ...at(2), type: 'turn.completed', engine: 'claude-code', model: 'opus' },
      { ...at(3), type: 'options', options: { engine: 'codex-agent', model: 'gpt-5.5' } },
      { ...at(4), type: 'turn.completed', engine: 'codex-agent', model: 'gpt-5.5-2026-09' },
    ] as ConversationEvent[];
    expect(previousModel(events, { engine: 'codex-agent', model: 'gpt-5.5' })).toEqual({
      engine: 'claude-code',
      model: 'opus',
    });
    // A turn since the change is the model now, however the provider named it.
    expect(previousModel(events.slice(3), { engine: 'codex-agent', model: 'gpt-5.5' })).toBe(
      undefined,
    );
  });

  it('knows a tapped chip only until the person says something else', () => {
    const choices = {
      ...at(3),
      type: 'model.choices',
      choices: [
        {
          engine: 'claude-code',
          model: 'opus',
          text: 'Switch to Opus 5.5 on Claude Code',
          label: 'Opus 5.5',
          line: 'x',
        },
      ],
      request: 'Fix it',
    } as ConversationEvent;
    expect(chipTapped([choices], 'Switch to Opus 5.5 on Claude Code')).toMatchObject({
      choice: { engine: 'claude-code' },
      request: 'Fix it',
    });
    expect(chipTapped([choices], 'something else')).toBeUndefined();
    const later = {
      ...at(4),
      type: 'user.message',
      messageId: 'u',
      text: 'hi',
    } as ConversationEvent;
    expect(chipTapped([choices, later], 'Switch to Opus 5.5 on Claude Code')).toBeUndefined();
  });
});
