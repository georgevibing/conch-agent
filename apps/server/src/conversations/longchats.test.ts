/**
 * A long chat, as the conversation sees it (ADR 0055): the engine says it
 * folded the start, and the chat shows where the model's memory starts,
 * learns what the person said there, and notes a healed refusal. `/compact`
 * asks the engine that keeps the transcript, and says plainly when there's
 * nothing to do.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEvent, EngineId, EngineStatus } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Compacted, Engine, EngineContext, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager } from './manager';
import { ConversationStore } from './store';

class LongEngine implements Engine {
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  /** What the next turn says about folding, if anything. */
  fold?: { healed?: boolean } & Partial<Compacted>;
  readonly compacts: Parameters<EngineContext['compact']>[0][] = [];
  next?: Compacted | Error;
  context?: EngineContext = {
    compact: async (input) => {
      this.compacts.push(input);
      if (this.next instanceof Error) throw this.next;
      return this.next;
    },
  };

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
    return { engine: this.id, label: this.label, models: [], commands: [], permissionModes: [] };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    yield { type: 'session', resumeId: input.resumeId ?? `${this.id}-s`, model: 'm' };
    if (this.fold) {
      yield {
        type: 'compacted',
        summary: 'They chose tomatoes.',
        turns: 2,
        model: 'Acme Large',
        ...this.fold,
      };
      this.fold = undefined;
    }
    yield { type: 'text', messageId: `m${this.turns.length}`, delta: 'ok' };
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup(options: { redact?: (text: string) => string } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-long-'));
  const api = new LongEngine('openrouter', 'OpenRouter');
  const own = new LongEngine('claude-code', 'Claude Code');
  own.context = undefined;
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'openrouter', autoTitle: false } });
  const learn = vi.fn(async () => undefined);
  const heal = vi.fn();
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: (id) => (id === 'claude-code' ? own : api),
    learn,
    heal,
    ...(options.redact && { redact: options.redact }),
  });
  return { manager, api, own, learn, heal };
}

async function idle(manager: ConversationManager, id: string) {
  for (let i = 0; i < 200; i++) {
    const { conversation } = await manager.detail(id);
    if (conversation.status === 'idle' || conversation.status === 'error') return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

async function say(manager: ConversationManager, text: string, id?: string, engine?: EngineId) {
  const convo = await manager.send({
    ...(id && { conversationId: id }),
    clientMessageId: `u-${text}`,
    text,
    ...(engine && { options: { engine } }),
  });
  await idle(manager, convo.id);
  return convo.id;
}

const compacted = (events: ConversationEvent[]) =>
  events.filter(
    (e): e is Extract<ConversationEvent, { type: 'context.compacted' }> =>
      e.type === 'context.compacted',
  );

describe('a long chat, in the chat', () => {
  it('tells the engine where each turn sits, so it can say where memory starts', async () => {
    const { manager, api } = await setup();
    const id = await say(manager, 'one');
    await say(manager, 'two', id);
    const { events } = await manager.detail(id);
    const asked = events.filter((e) => e.type === 'user.message').map((e) => e.seq);
    expect(api.turns.map((t) => t.seq)).toEqual(asked);
  });

  it('puts one quiet line where the model’s memory starts, and learns what was said before it', async () => {
    const { manager, api, learn, heal } = await setup();
    const id = await say(manager, 'first');
    await say(manager, 'second', id);
    const { events: before } = await manager.detail(id);
    const second = before.find((e) => e.type === 'user.message' && e.text === 'second');

    api.fold = { fromSeq: second?.seq ?? -1 };
    await say(manager, 'third', id);

    const { events } = await manager.detail(id);
    const [line] = compacted(events);
    expect(line).toMatchObject({
      summary: 'They chose tomatoes.',
      before: 'u-second',
      engine: 'openrouter',
      model: 'Acme Large',
      turns: 2,
    });
    expect(line?.asked).toBeUndefined();
    // The person's words from before that point are learned — the tidy-up's rules decide which.
    expect(learn).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: id, beforeSeq: second?.seq }),
    );
    expect(heal).not.toHaveBeenCalled();
  });

  it('says what it fixed when the provider had refused the chat as too long', async () => {
    const { manager, api, heal } = await setup();
    const id = await say(manager, 'first');
    api.fold = { healed: true };
    await say(manager, 'second', id);
    expect(heal).toHaveBeenCalledWith(
      'A chat had grown longer than Acme Large reads at once, so Conch summarised its start and sent your message again.',
    );
    // With no place given, the line goes before the message being answered.
    expect(compacted((await manager.detail(id)).events)[0]?.before).toBe('u-second');
  });

  it('keeps no secret it knows in the summary it logs', async () => {
    // The vault's redactor, as Services wires it.
    const { manager, api } = await setup({
      redact: (text) => text.replaceAll('hunter2-secret', '••••'),
    });
    const id = await say(manager, 'first');
    api.fold = { summary: 'The key is hunter2-secret.' };
    await say(manager, 'second', id);
    expect(compacted((await manager.detail(id)).events)[0]?.summary).toBe('The key is ••••.');
  });
});

describe('/compact', () => {
  it('asks the engine to fold the chat now, with the person’s focus, and marks the line as asked', async () => {
    const { manager, api, learn } = await setup();
    const id = await say(manager, 'first');
    await say(manager, 'second', id);
    api.next = { summary: 'Short.', turns: 1, model: 'Acme Large' };

    const result = await manager.compact(id, 'the compost');

    expect(result).toEqual({
      compacted: true,
      message: 'Acme Large now reads a summary of the earlier messages.',
    });
    expect(api.compacts[0]).toMatchObject({ resumeId: 'openrouter-s', focus: 'the compost' });
    const [line] = compacted((await manager.detail(id)).events);
    expect(line).toMatchObject({ asked: true, before: 'u-second', summary: 'Short.' });
    expect(learn).toHaveBeenCalled();
    // The chat is free again afterwards.
    await say(manager, 'third', id);
  });

  it('says there’s nothing to do in a short chat, or with a provider that keeps its own memory', async () => {
    const { manager, own } = await setup();
    const id = await say(manager, 'first');
    expect(await manager.compact(id)).toEqual({
      compacted: false,
      message: 'This chat is short: there’s nothing to summarise yet.',
    });

    const theirs = await say(manager, 'hello', undefined, 'claude-code');
    expect(own.turns).toHaveLength(1);
    expect(await manager.compact(theirs)).toEqual({
      compacted: false,
      message:
        'Claude Code keeps long chats in its own memory, so there’s nothing for Conch to summarise.',
    });
  });

  it('says so plainly when the summary couldn’t be written, and leaves the chat usable', async () => {
    const { manager, api } = await setup();
    const id = await say(manager, 'first');
    api.next = new Error('OpenRouter couldn’t write a summary just now, so the chat is as it was.');
    expect(await manager.compact(id)).toEqual({
      compacted: false,
      message: 'OpenRouter couldn’t write a summary just now, so the chat is as it was.',
    });
    expect(compacted((await manager.detail(id)).events)).toHaveLength(0);
    await say(manager, 'still here', id);
  });
});
