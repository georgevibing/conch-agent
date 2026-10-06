import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationEvent } from '@conch/protocol';
import { expect, it, vi } from 'vitest';

import { MockEngine } from '../engines/mock/engine';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager } from './manager';
import { ConversationStore } from './store';

it('keeps a concurrent title behind the durable signed-out completion in broadcast order', async () => {
  const home = await mkdtemp(join(tmpdir(), 'conch-broadcast-'));
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { autoTitle: false } });
  const store = new ConversationStore(join(home, 'conversations'));
  const engine = new MockEngine({ speed: 0 });
  const manager = new ConversationManager({
    store,
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
    context: async () => '',
  });
  let writing!: () => void;
  const startedWriting = new Promise<void>((resolve) => (writing = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const save = store.saveEvents.bind(store);
  let persisted = false;
  vi.spyOn(store, 'saveEvents').mockImplementation(async (id, events) => {
    if (events.some((event) => event.type === 'turn.completed')) {
      writing();
      await released;
      await save(id, events);
      persisted = true;
    } else await save(id, events);
  });
  const heard: ConversationEvent[] = [];
  const durableAtCompletion: boolean[] = [];
  manager.events.on((event) => {
    if (event.type !== 'conversation.event') return;
    heard.push(event.event);
    if (event.event.type === 'turn.completed') durableAtCompletion.push(persisted);
  });

  try {
    const chat = await manager.send({
      clientMessageId: 'signed-out',
      text: 'Please pretend you’re signed out',
    });
    await startedWriting;
    await manager.rename(chat.id, 'Sign in again');
    // A later event must not move the client's replay cursor past the closing
    // events while their disk write is still pending.
    expect(heard.some((event) => event.type === 'title')).toBe(false);
    expect(durableAtCompletion).toEqual([]);

    release();
    await vi.waitFor(() => expect(heard.at(-1)).toMatchObject({ type: 'title' }));
    const completion = heard.findIndex((event) => event.type === 'turn.completed');
    expect(heard[completion]).toMatchObject({ outcome: 'error', problem: 'signed-out' });
    expect(completion).toBeLessThan(heard.findIndex((event) => event.type === 'title'));
    expect(durableAtCompletion).toEqual([true]);
    expect(heard.map((event) => event.seq)).toEqual(
      [...new Set(heard.map((event) => event.seq))].sort((a, b) => a - b),
    );
  } finally {
    release();
    await manager.drain();
    vi.restoreAllMocks();
    await rm(home, { recursive: true, force: true });
  }
});
