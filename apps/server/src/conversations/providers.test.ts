import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, EngineId, EngineStatus, ServerEvent } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager, resolveOptions, upgrade } from './manager';
import { ConversationStore, type ConversationRecord } from './store';

/** A provider that answers "<label> heard: <last line>" and remembers what it was sent. */
class FakeEngine implements Engine {
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  #sessions = 0;

  constructor(
    readonly id: EngineId,
    readonly label: string,
  ) {}

  async detect(): Promise<EngineStatus> {
    return {
      engine: this.id,
      label: this.label,
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }

  async capabilities(): Promise<Capabilities> {
    return {
      engine: this.id,
      label: this.label,
      models: [],
      commands: [],
      permissionModes: ['default'],
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    yield {
      type: 'session',
      resumeId: input.resumeId ?? `${this.id}-session-${++this.#sessions}`,
      model: input.options.model ?? `${this.id}-default`,
    };
    const last = input.prompt.split('\n').at(-1) ?? '';
    yield { type: 'text', messageId: `m${Math.random()}`, delta: `${this.label} heard: ${last}` };
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-providers-'));
  const claude = new FakeEngine('claude-code', 'Claude Code');
  const router = new FakeEngine('openrouter', 'OpenRouter');
  const engines = new Map<EngineId, FakeEngine>([
    ['claude-code', claude],
    ['openrouter', router],
  ]);
  const settings = new SettingsStore(home);
  await settings.update({
    preferences: { engine: 'claude-code', model: 'opus', autoTitle: false },
  });
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: (id) => engines.get(id ?? 'claude-code') ?? claude,
  });
  const events: ServerEvent[] = [];
  manager.events.on((e) => events.push(e));
  return { manager, claude, router, events };
}

async function idle(manager: ConversationManager, id: string) {
  for (let i = 0; i < 200; i++) {
    const { conversation } = await manager.detail(id);
    if (conversation.status === 'idle' || conversation.status === 'error') return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

describe('every provider at once', () => {
  it('answers with the provider a conversation chose, and hands over what it missed', async () => {
    const { manager, claude, router } = await setup();

    const convo = await manager.send({ clientMessageId: 'u1', text: 'first, to claude' });
    await idle(manager, convo.id);
    expect(claude.turns).toHaveLength(1);
    // The default provider gets the default model; nothing to hand over yet.
    expect(claude.turns[0]?.options.model).toBe('opus');
    expect(claude.turns[0]?.prompt).toBe('first, to claude');

    // Switch this conversation to OpenRouter and one of its models.
    await manager.send({
      conversationId: convo.id,
      clientMessageId: 'u2',
      text: 'second, to openrouter',
      options: { engine: 'openrouter', model: 'qwen/qwen3' },
    });
    await idle(manager, convo.id);
    const joined = router.turns[0];
    expect(joined?.options.model).toBe('qwen/qwen3');
    expect(joined?.resumeId).toBeUndefined();
    expect(joined?.prompt).toContain('started before you joined it');
    expect(joined?.prompt).toContain('User: first, to claude');
    expect(joined?.prompt).toContain('Assistant: Claude Code heard: first, to claude');
    expect(joined?.prompt.endsWith('second, to openrouter')).toBe(true);

    // Back to Claude: its own session resumes, with only what it missed.
    await manager.send({
      conversationId: convo.id,
      clientMessageId: 'u3',
      text: 'third, back to claude',
      options: { engine: 'claude-code', model: 'sonnet' },
    });
    await idle(manager, convo.id);
    const back = claude.turns[1];
    expect(back?.resumeId).toBe('claude-code-session-1');
    expect(back?.options.model).toBe('sonnet');
    expect(back?.prompt).toContain('went on without you');
    expect(back?.prompt).toContain('User: second, to openrouter');
    expect(back?.prompt).toContain('OpenRouter heard: second, to openrouter');
    expect(back?.prompt).not.toContain('first, to claude');

    // And the next Claude turn has nothing to catch up on.
    await manager.send({ conversationId: convo.id, clientMessageId: 'u4', text: 'fourth' });
    await idle(manager, convo.id);
    expect(claude.turns[2]?.prompt).toBe('fourth');
    expect(claude.turns[2]?.resumeId).toBe('claude-code-session-1');

    // Each reply says who answered.
    const { events } = await manager.detail(convo.id);
    const answered = events.flatMap((e) =>
      e.type === 'turn.completed' ? [`${e.engine}:${e.model}`] : [],
    );
    expect(answered).toEqual([
      'claude-code:opus',
      'openrouter:qwen/qwen3',
      'claude-code:sonnet',
      'claude-code:sonnet',
    ]);
  });

  it('starts a new chat with the provider it names', async () => {
    const { manager, claude, router } = await setup();
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'hello',
      options: { engine: 'openrouter' },
    });
    await idle(manager, convo.id);
    expect(claude.turns).toHaveLength(0);
    // The default model belongs to the default provider, so OpenRouter uses its own.
    expect(router.turns[0]?.options.model).toBeUndefined();
    expect(convo.options.engine).toBe('openrouter');
  });
});

describe('resolveOptions', () => {
  const defaults = {
    engine: 'claude-code' as const,
    model: 'opus',
    effort: 'auto' as const,
    fastMode: false,
    permissionMode: 'default' as const,
  };

  it('uses the default model only for the default provider', () => {
    expect(resolveOptions({}, defaults, 'claude-code').model).toBe('opus');
    expect(resolveOptions({ engine: 'openrouter' }, defaults, 'openrouter').model).toBeUndefined();
  });

  it('never sends one provider’s model to another', () => {
    // A conversation that chose OpenRouter's model, answered by Claude Code (say, OpenRouter went away).
    expect(
      resolveOptions({ engine: 'openrouter', model: 'qwen/qwen3' }, defaults, 'claude-code').model,
    ).toBeUndefined();
    expect(
      resolveOptions({ engine: 'openrouter', model: 'qwen/qwen3' }, defaults, 'openrouter').model,
    ).toBe('qwen/qwen3');
  });
});

describe('upgrade', () => {
  it('reads a conversation from before ADR 0012 as the recorded provider’s session and model', () => {
    const record: ConversationRecord = {
      id: 'c1',
      title: 't',
      preview: '',
      createdAt: 0,
      updatedAt: 0,
      status: 'idle',
      options: { model: 'opus' },
      engine: 'claude-code',
      resumeId: 'abc',
    };
    expect(upgrade(record, 41)).toMatchObject({
      resumeId: undefined,
      sessions: { 'claude-code': { resumeId: 'abc', seq: 41 } },
      options: { model: 'opus', engine: 'claude-code' },
    });
  });
});
