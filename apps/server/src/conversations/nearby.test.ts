/**
 * Preferences near the question (ADR 0087 § 7): the turn's prompt carries
 * them just before the person's words; the chat's log and the system prompt
 * never do, and a guest never gets them. A chat marked "Don't learn from this
 * chat" remembers only when asked.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEvent, EngineStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager } from './manager';
import { ConversationStore } from './store';

const BLOCK =
  '<conch-nearby>\nFrom memory, what the user prefers that bears on this message:\n- Prefers TypeScript\n</conch-nearby>';

class Recorder implements Engine {
  readonly id = 'openrouter' as const;
  readonly label = 'Recorder';
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
      permissionModes: ['default'],
      tools: { host: true, files: true, shell: true, approvals: true },
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    yield { type: 'text', messageId: 'a1', delta: 'Sure.' };
    yield { type: 'message-done', messageId: 'a1' };
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup(quiet = false) {
  const home = await mkdtemp(join(tmpdir(), 'conch-nearby-'));
  const engine = new Recorder();
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { autoTitle: false } });
  const asked: string[] = [];
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
    learning: {
      nearby: async (said) => {
        asked.push(said);
        return BLOCK;
      },
      isQuiet: async () => quiet,
      refuses: async () => false,
    },
  });
  return { manager, engine, asked };
}

async function finished(manager: ConversationManager, id: string): Promise<ConversationEvent[]> {
  for (let i = 0; i < 400; i++) {
    const events = await manager.eventsAfter(id);
    if (events.some((e) => e.type === 'turn.completed')) return events;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('the turn never finished');
}

describe('preferences near the question (ADR 0087)', () => {
  it('go just before your words in the turn, never in the log or the system prompt', async () => {
    const { manager, engine, asked } = await setup();
    const chat = await manager.send({ clientMessageId: 'u1', text: 'Write me a script' });
    const events = await finished(manager, chat.id);
    const turn = engine.turns[0];
    expect(turn?.prompt).toBe(`${BLOCK}\n\nWrite me a script`);
    expect(turn?.systemAppend).not.toContain('conch-nearby');
    expect(asked).toEqual(['Write me a script']);
    const said = events.find((e) => e.type === 'user.message');
    expect(said?.type === 'user.message' && said.text).toBe('Write me a script');
    expect(JSON.stringify(events)).not.toContain('conch-nearby');
  });

  it('a guest never gets them', async () => {
    const { manager, engine, asked } = await setup();
    const chat = await manager.send({
      clientMessageId: 'u1',
      text: 'hello',
      origin: { kind: 'channel', channelId: 'ch1', channel: 'telegram', guest: true },
    });
    await finished(manager, chat.id);
    expect(engine.turns[0]?.prompt).toBe('hello');
    expect(asked).toEqual([]);
  });

  it('a chat marked not to learn from remembers only when asked', async () => {
    const quiet = await setup(true);
    const a = await quiet.manager.send({ clientMessageId: 'u1', text: 'hi' });
    await finished(quiet.manager, a.id);
    expect(quiet.engine.turns[0]?.systemAppend).toContain(
      'Only use the remember tool when the user explicitly asks',
    );
    const open = await setup(false);
    const b = await open.manager.send({ clientMessageId: 'u1', text: 'hi' });
    await finished(open.manager, b.id);
    expect(open.engine.turns[0]?.systemAppend).toContain(
      'Use the remember tool when the user shares',
    );
  });
});
