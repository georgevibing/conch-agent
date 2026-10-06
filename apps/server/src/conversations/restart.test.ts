/**
 * Conch stopping under a running chat (an update, a crash, memory running out):
 * the chat says so, carries on by itself a couple of times, and a tab that had
 * seen more of the lost run is told to start over.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEvent, EngineStatus } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager } from './manager';
import { ConversationStore } from './store';

class Scripted implements Engine {
  readonly id = 'openrouter' as const;
  readonly label = 'Scripted';
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  constructor(private readonly script: (input: TurnInput) => AsyncIterable<EngineEvent>) {}
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
  runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    return this.script(input);
  }
}

async function open(
  home: string,
  engine: Scripted,
  recovery?: { allowed: () => boolean; intervalMs?: number },
) {
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'openrouter', autoTitle: false } });
  return new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
    context: async () => '',
    recovery,
  });
}

const hangs = () =>
  new Scripted(async function* () {
    yield { type: 'text', messageId: 'm1', delta: 'Working…' };
    await new Promise(() => undefined);
  });

async function until(
  manager: ConversationManager,
  id: string,
  done: (e: ConversationEvent[]) => boolean,
) {
  for (let i = 0; i < 400; i++) {
    const { events } = await manager.detail(id);
    if (done(events)) return events;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never happened');
}

describe('Conch restarting under a running chat', () => {
  it('says so, then carries on by itself', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-restart-'));
    const before = await open(home, hangs());
    const convo = await before.send({ clientMessageId: 'u1', text: 'Pull the codebase' });
    await until(before, convo.id, (e) => e.some((x) => x.type === 'assistant.delta'));

    // Conch comes back up: the same folder, a new gateway.
    const engine = new Scripted(async function* () {
      yield { type: 'text', messageId: 'm2', delta: 'Done.' };
      yield { type: 'done', outcome: 'success' };
    });
    const after = await open(home, engine);
    expect(await after.recoverInterrupted()).toBe(1);
    const events = await until(after, convo.id, (e) =>
      e.some((x) => x.type === 'turn.completed' && x.outcome === 'success'),
    );

    expect(events.find((e) => e.type === 'turn.completed')).toMatchObject({
      outcome: 'interrupted',
      restarted: { resumed: true },
    });
    expect(engine.turns[0]?.prompt).toMatch(/Conch restarted/);
    expect((await after.list()).find((c) => c.id === convo.id)?.status).toBe('idle');
  });

  it('stops carrying on after two restarts in a row, and says why', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-restart-'));
    let manager = await open(home, hangs());
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Do the thing' });
    await until(manager, convo.id, (e) => e.some((x) => x.type === 'assistant.delta'));
    for (let round = 0; round < 3; round++) {
      manager = await open(home, hangs());
      await manager.recoverInterrupted();
      await until(
        manager,
        convo.id,
        (e) => e.filter((x) => x.type === 'turn.completed').length === round + 1,
      );
      // Whatever it started again is mid-turn when Conch goes down again.
      await new Promise((r) => setTimeout(r, 30));
    }
    const { events } = await manager.detail(convo.id);
    const ends = events.flatMap((e) =>
      e.type === 'turn.completed' && e.restarted ? [e.restarted.resumed] : [],
    );
    expect(ends).toEqual([true, true, false]);
  });
  it('saves in-flight progress and refuses new work while draining', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-drain-'));
    const manager = await open(home, hangs());
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Work' });
    await until(manager, convo.id, (e) => e.some((x) => x.type === 'assistant.delta'));
    await manager.drain();
    await expect(manager.send({ clientMessageId: 'u2', text: 'More' })).rejects.toThrow(
      /saving your progress/,
    );
    const store = new ConversationStore(join(home, 'conversations'));
    expect((await store.events(convo.id)).some((e) => e.type === 'assistant.delta')).toBe(true);
    expect((await store.events(convo.id)).some((e) => e.type === 'turn.completed')).toBe(false);
  });

  it('records a changing tool before dispatch and never automatically repeats an uncertain action', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-uncertain-'));
    let durable = false;
    const before = await open(
      home,
      new Scripted(async function* (input) {
        await input.guard?.({
          toolName: 'Bash',
          toolUseId: 'send-1',
          input: { command: 'send-payment' },
        });
        const store = new ConversationStore(join(home, 'conversations'));
        durable = (await store.list())[0]?.pendingToolCalls?.includes('send-1') ?? false;
        yield { type: 'text', messageId: 'm1', delta: 'Sending' };
        await new Promise(() => undefined);
      }),
    );
    const convo = await before.send({ clientMessageId: 'u1', text: 'Send once' });
    await until(before, convo.id, (e) => e.some((x) => x.type === 'assistant.delta'));
    expect(durable).toBe(true);
    await before.drain();
    const engine = hangs();
    const after = await open(home, engine);
    expect(await after.recoverInterrupted()).toBe(0);
    expect(engine.turns).toHaveLength(0);
    expect(
      (await after.detail(convo.id)).events.findLast((e) => e.type === 'turn.completed'),
    ).toMatchObject({
      restarted: { resumed: false },
      error: expect.stringMatching(/action may have finished/),
    });
  });

  it('waits for resources, then resumes only one chat while the first is running', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-gradual-'));
    const before = await open(home, hangs());
    await before.send({ clientMessageId: 'u1', text: 'First' });
    await before.send({ clientMessageId: 'u2', text: 'Second' });
    await before.drain();
    let allowed = false;
    const engine = hangs();
    const after = await open(home, engine, { allowed: () => allowed, intervalMs: 10 });
    expect(await after.recoverInterrupted()).toBe(0);
    expect(engine.turns).toHaveLength(0);
    allowed = true;
    expect(await after.recoverInterrupted()).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.turns).toHaveLength(1);
    await after.drain();
  });
  it.each(['success', 'error'] as const)(
    'only releases durable mutation admission for a recorded success (%s)',
    async (status) => {
      const home = await mkdtemp(join(tmpdir(), 'conch-tool-result-'));
      const before = await open(
        home,
        new Scripted(async function* (input) {
          await input.guard?.({ toolName: 'Bash', toolUseId: 't1', input: { command: 'update' } });
          yield { type: 'tool-start', toolUseId: 't1', name: 'Bash', input: { command: 'update' } };
          yield { type: 'tool-end', toolUseId: 't1', status, output: 'Result' };
          yield { type: 'text', messageId: 'm1', delta: 'Next step' };
          await new Promise(() => undefined);
        }),
      );
      const chat = await before.send({ clientMessageId: 'u1', text: 'Work' });
      await until(before, chat.id, (events) => events.some((e) => e.type === 'assistant.delta'));
      await before.drain();
      const after = await open(home, hangs());
      expect(await after.recoverInterrupted()).toBe(status === 'success' ? 1 : 0);
      await after.drain();
    },
  );

  it('keeps deferred recovery durable across another restart and unrelated index writes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-deferred-'));
    const before = await open(home, hangs());
    const chat = await before.send({ clientMessageId: 'u1', text: 'Work' });
    await before.drain();
    const store = new ConversationStore(join(home, 'conversations'));
    const record = (await store.list())[0];
    if (!record) throw new Error('missing chat');
    expect(record.recoveryPending).toBe(true);
    await store.upsert({ ...record, title: 'Renamed while recovering' });
    const after = await open(home, hangs());
    expect(await after.recoverInterrupted()).toBe(1);
    expect((await after.detail(chat.id)).conversation.title).toBe('Renamed while recovering');
    await after.drain();
  });
  it('fails closed when saved mutation safety metadata is damaged', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-damaged-admission-'));
    const before = await open(home, hangs());
    await before.send({ clientMessageId: 'u1', text: 'Work' });
    await before.drain();
    const index = join(home, 'conversations', 'index.json');
    const records = JSON.parse(await readFile(index, 'utf8'));
    records[0].pendingToolCalls = 'damaged';
    await writeFile(index, JSON.stringify(records));
    const engine = hangs();
    const after = await open(home, engine);
    expect(await after.recoverInterrupted()).toBe(0);
    expect(engine.turns).toHaveLength(0);
  });
  it.each([false, true])(
    'waits for a managed command to actually exit successfully (confirmed: %s)',
    async (confirmed) => {
      const home = await mkdtemp(join(tmpdir(), 'conch-command-recovery-'));
      const before = await open(
        home,
        new Scripted(async function* (input) {
          await input.guard?.({
            toolName: 'mcp__conch__process_start',
            toolUseId: 'start1',
            input: { command: 'deploy' },
          });
          yield {
            type: 'tool-start',
            toolUseId: 'start1',
            name: 'mcp__conch__process_start',
            input: { command: 'deploy' },
          };
          yield {
            type: 'tool-end',
            toolUseId: 'start1',
            status: 'success',
            output: JSON.stringify({ id: 'process1', status: 'running' }),
          };
          if (confirmed) {
            await input.guard?.({
              toolName: 'mcp__conch__process_read',
              toolUseId: 'read1',
              input: { id: 'process1' },
            });
            yield {
              type: 'tool-start',
              toolUseId: 'read1',
              name: 'mcp__conch__process_read',
              input: { id: 'process1' },
            };
            yield {
              type: 'tool-end',
              toolUseId: 'read1',
              status: 'success',
              output: JSON.stringify({ id: 'process1', status: 'exited', exitCode: 0 }),
            };
          }
          yield { type: 'text', messageId: 'm1', delta: 'Next' };
          await new Promise(() => undefined);
        }),
      );
      const chat = await before.send({ clientMessageId: 'u1', text: 'Deploy once' });
      await until(before, chat.id, (events) => events.some((e) => e.type === 'assistant.delta'));
      await before.drain();
      const after = await open(home, hangs());
      expect(await after.recoverInterrupted()).toBe(confirmed ? 1 : 0);
      await after.drain();
    },
  );
  it('keeps an announced recovery queued if admission fails, without spending another retry', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-recovery-admission-'));
    const before = await open(home, hangs());
    const chat = await before.send({ clientMessageId: 'u1', text: 'Work' });
    await before.drain();
    const after = await open(home, hangs());
    vi.spyOn(after, 'release').mockResolvedValueOnce(false);
    expect(await after.recoverInterrupted()).toBe(0);
    const stored = await new ConversationStore(join(home, 'conversations')).get(chat.id);
    expect(stored?.recoveryQueued).toBe(true);
    expect(await after.recoverInterrupted()).toBe(1);
    expect(
      (await after.detail(chat.id)).events.filter((e) => e.type === 'turn.completed'),
    ).toHaveLength(1);
    await after.drain();
  });
  it('clears admission when the person definitively refuses the action before dispatch', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-denied-recovery-'));
    const before = await open(
      home,
      new Scripted(async function* (input) {
        const request = { toolName: 'Bash', toolUseId: 'denied1', input: { command: 'send' } };
        await input.guard?.(request);
        expect(await input.requestPermission(request, input.signal)).toBe('deny');
        yield { type: 'text', messageId: 'm1', delta: 'Not sent' };
        await new Promise(() => undefined);
      }),
    );
    const chat = await before.send({ clientMessageId: 'u1', text: 'Check first' });
    const events = await until(before, chat.id, (log) =>
      log.some((e) => e.type === 'permission.requested'),
    );
    const permission = events.find((e) => e.type === 'permission.requested');
    if (permission?.type !== 'permission.requested') throw new Error('missing permission');
    await before.respond(chat.id, permission.permissionId, 'deny');
    await until(before, chat.id, (log) => log.some((e) => e.type === 'assistant.delta'));
    await before.drain();
    const after = await open(home, hangs());
    expect(await after.recoverInterrupted()).toBe(1);
    await after.drain();
  });
});
