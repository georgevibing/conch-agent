/**
 * A session keeps the system text it started with (ADR 0085): what changes
 * goes with the next message, once, so the provider's cached chat holds.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEvent, EngineStatus, Memory } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { instructionsFor, same, UPDATE_LEAD, type Part } from './instructions';
import { ConversationManager } from './manager';
import { ConversationStore } from './store';

const memory = (id: string, content: string) =>
  ({ id, content, kind: 'fact', source: 'user', createdAt: 0, updatedAt: 0 }) as unknown as Memory;

const parts = (health: string): Part[] => [
  { key: 'identity', text: 'You are Conch.' },
  { key: 'context:0', text: `## Apps\nGmail: ${health}` },
  { key: 'memory', text: '# Memory\nHow memory works.' },
];

describe('instructionsFor', () => {
  it('starts a new session with everything in its system text, and the memories with the message', () => {
    const told = instructionsFor({
      engine: 'e',
      resumeId: undefined,
      parts: parts('working'),
      memories: [memory('m1', 'Likes tea')],
      given: undefined,
    });
    expect(told.system).toBe(
      'You are Conch.\n\n## Apps\nGmail: working\n\n# Memory\nHow memory works.',
    );
    expect(told.update).toBeUndefined();
    expect(told.memories.map((m) => m.id)).toEqual(['m1']);
    expect(told.given(undefined, false)).toBeUndefined();
  });

  it('keeps the system text a session started with, and sends what changed once', () => {
    const first = instructionsFor({
      engine: 'e',
      resumeId: undefined,
      parts: parts('working'),
      memories: [memory('m1', 'Likes tea')],
      given: undefined,
    });
    const given = first.given('s1', false);
    const second = instructionsFor({
      engine: 'e',
      resumeId: 's1',
      parts: parts('needs signing in again'),
      memories: [memory('m1', 'Likes tea'), memory('m2', 'Has a cat')],
      given,
    });
    expect(second.system).toBe(first.system);
    expect(second.update).toContain(UPDATE_LEAD);
    expect(second.update).toContain('Gmail: needs signing in again');
    expect(second.update).not.toContain('You are Conch.');
    // Only the memory it wasn't told of yet.
    expect(second.memories.map((m) => m.id)).toEqual(['m2']);
    // A session that starts again from the log gets everything since the start.
    expect(second.fresh).toContain('Gmail: needs signing in again');
    expect(second.freshMemories.map((m) => m.id)).toEqual(['m1', 'm2']);

    // The same again: nothing new to say.
    const third = instructionsFor({
      engine: 'e',
      resumeId: 's1',
      parts: parts('needs signing in again'),
      memories: [memory('m2', 'Has a cat')],
      given: second.given('s1', false),
    });
    expect(third.system).toBe(first.system);
    expect(third.update).toBeUndefined();
    expect(third.memories).toEqual([]);
    // But a fresh session would still need to hear it changed since the start.
    expect(third.fresh).toContain('Gmail: needs signing in again');
  });

  it('starts the instructions again when a firm part changes or a part goes away', () => {
    const given = instructionsFor({
      engine: 'e',
      resumeId: undefined,
      parts: parts('working'),
      memories: [memory('m1', 'Likes tea')],
      given: undefined,
    }).given('s1', false);
    const firm = new Set(['identity']);
    const agent = instructionsFor({
      engine: 'e',
      resumeId: 's1',
      parts: [{ key: 'identity', text: 'You are Writer.' }, ...parts('working').slice(1)],
      memories: [memory('m1', 'Likes tea')],
      given,
      firm,
    });
    expect(agent.system).toContain('You are Writer.');
    expect(agent.update).toBeUndefined();
    // The session carries on: what it was told of is still in it.
    expect(agent.memories).toEqual([]);
    const gone = instructionsFor({
      engine: 'e',
      resumeId: 's1',
      parts: parts('working').filter((p) => p.key !== 'context:0'),
      memories: [],
      given,
      firm,
    });
    expect(gone.system).not.toContain('Gmail');
    expect(gone.update).toBeUndefined();
  });

  it('starts from nothing for another session or another provider', () => {
    const given = instructionsFor({
      engine: 'e',
      resumeId: undefined,
      parts: parts('working'),
      memories: [memory('m1', 'Likes tea')],
      given: undefined,
    }).given('s1', false);
    for (const [engine, resumeId] of [
      ['e', 's2'],
      ['other', 's1'],
    ] as const) {
      const told = instructionsFor({
        engine,
        resumeId,
        parts: parts('broken'),
        memories: [memory('m1', 'Likes tea')],
        given,
      });
      expect(told.system).toContain('Gmail: broken');
      expect(told.update).toBeUndefined();
      expect(told.memories.map((m) => m.id)).toEqual(['m1']);
    }
  });

  it('a session that restarted from the log forgets the memories it was told of', () => {
    const first = instructionsFor({
      engine: 'e',
      resumeId: undefined,
      parts: parts('working'),
      memories: [memory('m1', 'Likes tea')],
      given: undefined,
    });
    const second = instructionsFor({
      engine: 'e',
      resumeId: 's1',
      parts: parts('working'),
      memories: [memory('m2', 'Has a cat')],
      given: first.given('s1', false),
    });
    expect([...(second.given('s2', true)?.memories ?? [])]).toEqual(['m2']);
    expect([...(second.given('s1', false)?.memories ?? [])].sort()).toEqual(['m1', 'm2']);
  });

  it('reads a list in another order as the same part', () => {
    expect(same('## Map\n- Gmail\n- Notion', '## Map\n- Notion\n- Gmail')).toBe(true);
    expect(same('## Map\n- Gmail', '## Map\n- Gmail\n- Notion')).toBe(false);
  });
});

/** A provider that carries its one session on from turn to turn, like Claude Code. */
class Keeper implements Engine {
  readonly id = 'openrouter' as const;
  readonly label = 'Keeper';
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];

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
      models: [
        {
          id: 'm',
          label: 'M',
          description: '',
          efforts: [],
          supportsFastMode: false,
          supportsAutoMode: false,
        },
      ],
      commands: [],
      permissionModes: ['default', 'bypassPermissions'],
      tools: { host: true, files: true, shell: true, approvals: true },
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    yield { type: 'session', resumeId: input.resumeId ?? 'kept-session', model: 'm' };
    yield { type: 'text', messageId: `a${this.turns.length}`, delta: 'OK.' };
    yield { type: 'message-done', messageId: `a${this.turns.length}` };
    yield { type: 'done', outcome: 'success' };
  }
}

async function completed(manager: ConversationManager, id: string, n: number) {
  for (let i = 0; i < 400; i++) {
    const events: ConversationEvent[] = await manager.eventsAfter(id);
    if (events.filter((e) => e.type === 'turn.completed').length >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('the turn never finished');
}

describe('a chat whose provider keeps its session', () => {
  it('sends the same system text every turn, and what changed with the message', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-instructions-'));
    const engine = new Keeper();
    const settings = new SettingsStore(home);
    await settings.update({ preferences: { autoTitle: false } });
    const memories = new MemoryStore(join(home, 'memory'));
    await memories.add({ content: 'Ada keeps bees', source: 'user' });
    let health = 'working';
    const manager = new ConversationManager({
      store: new ConversationStore(join(home, 'conversations')),
      settings,
      memory: memories,
      engine: () => engine,
      context: async () => ['## Routines\nMorning brief.', `## Apps\nGmail: ${health}.`],
    });
    const chat = await manager.send({ clientMessageId: 'u1', text: 'hi' });
    await completed(manager, chat.id, 1);
    health = 'needs signing in again';
    await manager.send({ conversationId: chat.id, clientMessageId: 'u2', text: 'and now?' });
    await completed(manager, chat.id, 2);
    await manager.send({ conversationId: chat.id, clientMessageId: 'u3', text: 'thanks' });
    await completed(manager, chat.id, 3);

    const [first, second, third] = engine.turns;
    expect(first?.systemAppend).toContain('Gmail: working.');
    expect(first?.systemAppend).not.toContain('Ada keeps bees');
    expect(first?.prompt).toContain('Ada keeps bees');
    // The same system text, so the provider's cache holds.
    expect(second?.systemAppend).toBe(first?.systemAppend);
    expect(third?.systemAppend).toBe(first?.systemAppend);
    // What changed goes once, with the message; the memory isn't said again.
    expect(second?.prompt).toContain('Gmail: needs signing in again.');
    expect(second?.prompt).not.toContain('Morning brief');
    expect(second?.prompt).not.toContain('Ada keeps bees');
    expect(second?.prompt?.endsWith('and now?')).toBe(true);
    expect(third?.prompt).toBe('thanks');
    // A session that had to start again from the log would hear all of it.
    expect(second?.freshPrompt).toContain('Gmail: needs signing in again.');
    expect(second?.freshPrompt).toContain('Ada keeps bees');
  });
});
