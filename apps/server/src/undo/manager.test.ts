import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEvent, EngineStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { Activity } from '../activity/service';
import { ConversationManager } from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { UndoService } from './service';
import { UndoStore } from './store';

/** A provider that really edits files, the way each kind does. */
class Editor implements Engine {
  readonly id = 'mock' as const;
  readonly label = 'Editor';
  readonly integrations = { mode: 'bridge' as const };
  script: ((input: TurnInput) => AsyncGenerator<EngineEvent>)[] = [];
  async detect(): Promise<EngineStatus> {
    return {
      engine: 'mock',
      label: 'Editor',
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }
  async capabilities(): Promise<Capabilities> {
    return {
      engine: 'mock',
      label: 'Editor',
      models: [],
      commands: [],
      permissionModes: ['default'],
    };
  }
  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const next = this.script.shift();
    if (next) yield* next(input);
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'conch-undo-chat-'));
  const work = join(root, 'work');
  mkdirSync(work);
  const settings = new SettingsStore(join(root, 'home'));
  await settings.update({ preferences: { engine: 'mock', autoTitle: false, workspace: work } });
  const engine = new Editor();
  const store = new ConversationStore(join(root, 'home', 'conversations'));
  // Undo tells the chat; the chat is made after Undo.
  const chat: { manager?: ConversationManager } = {};
  const undo = new UndoService({
    store: new UndoStore(join(root, 'home')),
    forbidden: () => false,
    restored: (set, direction, files) =>
      void chat.manager?.noteRestored(set.conversationId, {
        changeSetId: set.id,
        direction,
        files,
      }),
  });
  const manager = new ConversationManager({
    store,
    settings,
    memory: new MemoryStore(join(root, 'home', 'memory')),
    engine: () => engine,
    undo,
  });
  chat.manager = manager;
  const activity = new Activity({
    list: () => store.list(),
    events: (id) => store.events(id),
    undoState: (id) => undo.state(id),
  });
  return { manager, engine, undo, activity, work };
}

async function settle(
  manager: ConversationManager,
  id: string,
  until: (e: ConversationEvent[]) => boolean,
) {
  for (let i = 0; i < 2000; i++) {
    const { events } = await manager.detail(id);
    if (until(events)) return events;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never happened');
}

describe('Undo in a chat, end to end', () => {
  it('a file tool’s change and a command’s change are each a change set the chat and Activity can undo', async () => {
    const { manager, engine, undo, activity, work } = await setup();
    const note = join(work, 'note.md');
    writeFileSync(join(work, 'list.txt'), 'milk\n');
    engine.script.push(async function* (input) {
      const args = { file_path: note, content: '# Note\n' };
      await input.guard?.({ toolName: 'Write', toolUseId: 'w1', input: args });
      yield { type: 'tool-start', toolUseId: 'w1', name: 'Write', input: args };
      writeFileSync(note, '# Note\n');
      yield { type: 'tool-end', toolUseId: 'w1', status: 'success', output: 'ok' };
      const cmd = { command: 'echo eggs >> list.txt' };
      yield { type: 'tool-start', toolUseId: 'b1', name: 'Bash', input: cmd };
      writeFileSync(join(work, 'list.txt'), 'milk\neggs\n');
      yield { type: 'tool-end', toolUseId: 'b1', status: 'success', output: '' };
    });
    const convo = await manager.send({ clientMessageId: 'u1', text: 'go' });
    const events = await settle(manager, convo.id, (e) =>
      e.some((x) => x.type === 'turn.completed'),
    );
    const changed = events.filter((e) => e.type === 'files.changed');
    expect(changed).toMatchObject([
      { toolUseId: 'w1', label: 'Created note.md', files: [{ path: 'note.md', kind: 'created' }] },
      {
        toolUseId: 'b1',
        label: 'Ran `echo eggs >> list.txt`',
        files: [{ path: 'list.txt', kind: 'changed' }],
      },
    ]);

    // Activity reads the saved log, which lands just after the turn ends.
    const undoable = async (n: number, until: (titles: string[]) => boolean = () => true) => {
      for (let i = 0; i < 400; i++) {
        const page = await activity.page();
        if (
          page.entries.filter((e) => e.undo).length === n &&
          until(page.entries.map((e) => e.title))
        )
          return page;
        await new Promise((r) => setTimeout(r, 5));
      }
      return activity.page();
    };
    const page = await undoable(2);
    expect(page.entries.filter((e) => e.undo).map((e) => e.undo?.state)).toEqual([
      'applied',
      'applied',
    ]);

    // Undo everything this turn did.
    const ids = changed.flatMap((e) => (e.type === 'files.changed' ? [e.changeSetId] : []));
    await undo.apply(ids, 'undo');
    expect(readFileSync(join(work, 'list.txt'), 'utf8')).toBe('milk\n');
    const after = await settle(
      manager,
      convo.id,
      (e) => e.filter((x) => x.type === 'files.restored').length === 2,
    );
    expect(
      after
        .filter((e) => e.type === 'files.restored')
        .map((e) => e.type === 'files.restored' && e.direction),
    ).toEqual(['undo', 'undo']);
    // What the chat saved is what Activity reads.
    const again = await undoable(2, (titles) => Boolean(titles[0]?.startsWith('You undid')));
    expect(again.entries.filter((e) => e.undo).map((e) => e.undo?.state)).toEqual([
      'undone',
      'undone',
    ]);
    expect(again.entries[0]?.title).toMatch(/^You undid/);
  });
});
