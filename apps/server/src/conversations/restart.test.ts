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

import type { Engine, EngineEvent, HostTool, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager } from './manager';
import { ConversationStore } from './store';
import type { WorkloadPace } from '../recovery/pace';
import type { Room } from '../recovery/gateway';

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
  recovery?: {
    allowed: () => boolean;
    allowedPlanned?: () => boolean;
    intervalMs?: number;
    workload?: () => WorkloadPace;
    room?: () => Room;
  },
  tools: HostTool[] = [],
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
    tools: () => tools,
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

  it('a page that saw more of the lost run than was saved starts over, and misses nothing new', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-restart-'));
    const before = await open(home, hangs());
    const convo = await before.send({ clientMessageId: 'u1', text: 'Pull the codebase' });
    const streamed = await until(before, convo.id, (e) =>
      e.some((x) => x.type === 'assistant.delta'),
    );
    // The page saw further than the log on disk got: deltas a run streams but never saves.
    const seen = (streamed.at(-1)?.seq ?? 0) + 12;

    const engine = new Scripted(async function* () {
      yield { type: 'text', messageId: 'm2', delta: 'Done.' };
      yield { type: 'done', outcome: 'success' };
    });
    const after = await open(home, engine);
    // Recovery writes its mark before the page is back.
    await after.recoverInterrupted();
    const events = await until(after, convo.id, (e) =>
      e.some((x) => x.type === 'turn.completed' && x.outcome === 'success'),
    );
    const mark = events.find((e) => e.type === 'turn.completed' && e.restarted);
    expect(mark).toBeDefined();
    // Asked to carry on from what it saw, the page is told to start over…
    expect(await after.seenUnsaved(convo.id, seen)).toBe(true);
    // …because everything this run wrote is numbered past it, so nothing would be skipped.
    expect(mark?.seq ?? 0).toBeGreaterThan(seen);
    // A page that has seen this run's own events just carries on.
    expect(await after.seenUnsaved(convo.id, events.at(-1)?.seq ?? 0)).toBe(false);
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
  it.each([false, true])(
    'only settles mutation success observed before Stop (before: %s)',
    async (beforeStop) => {
      const home = await mkdtemp(join(tmpdir(), 'conch-stop-admission-'));
      const manager = await open(
        home,
        new Scripted(async function* (input) {
          const call = { toolName: 'Bash', toolUseId: 'changing1', input: { command: 'send' } };
          await input.guard?.(call);
          yield {
            type: 'tool-start',
            toolUseId: call.toolUseId,
            name: call.toolName,
            input: call.input,
          };
          if (beforeStop)
            yield {
              type: 'tool-end',
              toolUseId: call.toolUseId,
              status: 'success',
              output: 'Sent.',
            };
          const stopped = new Promise<void>((resolve) =>
            input.signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          yield { type: 'text', messageId: 'm1', delta: 'Waiting' };
          await stopped;
          if (!beforeStop)
            yield {
              type: 'tool-end',
              toolUseId: call.toolUseId,
              status: 'success',
              output: 'Stopped.',
            };
          yield { type: 'done', outcome: 'interrupted' };
        }),
      );
      const chat = await manager.send({ clientMessageId: 'u1', text: 'Send once' });
      await until(manager, chat.id, (events) => events.some((e) => e.type === 'assistant.delta'));
      await manager.interrupt(chat.id);
      await until(manager, chat.id, (events) => events.some((e) => e.type === 'turn.completed'));
      await manager.drain();
      const record = await new ConversationStore(join(home, 'conversations')).get(chat.id);
      expect(record?.pendingToolCalls?.includes('changing1') ?? false).toBe(!beforeStop);
    },
  );
});

describe('native commands share resource admission', () => {
  it('guides an ongoing chat before pressure becomes critical and refreshes context next turn', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-live-resource-'));
    let state: WorkloadPace = {
      phase: 'normal',
      cause: 'recovery',
      concurrency: 4,
      critical: false,
    };
    const heard: (string | undefined)[] = [];
    const engine = new Scripted(async function* (input) {
      // That it has room stays in the system text; how busy it is goes with the message (ADR 0085).
      heard.push(`${input.systemAppend}\n\n${input.prompt}`);
      state = { phase: 'constrained', cause: 'memory', concurrency: 1, critical: false };
      // The provider's next safe boundary reads a live signal; no new turn is sent.
      heard.push(input.resourceFeedback?.());
      expect(
        await input.guard?.({
          toolName: 'Bash',
          toolUseId: 'wait',
          input: { command: 'echo large-build' },
        }),
      ).toMatchObject({ decision: 'deny' });
      expect(
        await input.guard?.({ toolName: 'Read', input: { file_path: join(home, 'file') } }),
      ).toBeUndefined();
      yield { type: 'done', outcome: 'success' };
    });
    const manager = await open(home, engine, {
      allowed: () => state.phase === 'normal',
      workload: () => state,
    });
    try {
      const chat = await manager.send({
        clientMessageId: 'u1',
        text: 'Continue the original task',
      });
      await until(manager, chat.id, (events) => events.some((e) => e.type === 'turn.completed'));
      expect(heard[0]).toContain('currently has room');
      expect(heard[1]).toContain('approaching its memory budget');
      state = { phase: 'normal', cause: 'recovery', concurrency: 4, critical: false };
      await manager.send({ conversationId: chat.id, clientMessageId: 'u2', text: 'Carry on' });
      await until(
        manager,
        chat.id,
        (events) => events.filter((e) => e.type === 'turn.completed').length === 2,
      );
      expect(heard[2]).toContain('currently has room');
      expect(engine.turns).toHaveLength(2);
      const record = await new ConversationStore(join(home, 'conversations')).get(chat.id);
      expect(record?.pendingToolCalls ?? []).not.toContain('wait');
    } finally {
      await manager.drain();
    }
  });
  it.each(['Bash', 'PowerShell'])(
    'holds %s under pressure without blocking reads or creating an uncertain action',
    async (toolName) => {
      const home = await mkdtemp(join(tmpdir(), 'conch-command-admission-'));
      const guarded: unknown[] = [];
      let allowed = false;
      const engine = new Scripted(async function* (input) {
        guarded.push(
          await input.guard?.({
            toolName,
            toolUseId: 'held-command',
            input: { command: 'echo hello' },
          }),
        );
        guarded.push(
          await input.guard?.({
            toolName: 'Read',
            toolUseId: 'read',
            input: { file_path: join(home, 'example.txt') },
          }),
        );
        allowed = true;
        guarded.push(
          await input.guard?.({
            toolName,
            toolUseId: 'admitted-command',
            input: { command: 'echo hello' },
          }),
        );
        yield { type: 'done', outcome: 'success' };
      });
      const manager = await open(home, engine, { allowed: () => allowed });
      const conversation = await manager.send({ clientMessageId: 'u1', text: 'Run a command' });
      await until(manager, conversation.id, (events) =>
        events.some((e) => e.type === 'turn.completed'),
      );
      // It says it never ran, and gives no advice this turn can't follow.
      expect(guarded[0]).toMatchObject({
        decision: 'deny',
        message: expect.stringContaining('before it ran, so nothing happened'),
      });
      expect(guarded[0]).toMatchObject({
        message: expect.not.stringContaining('process_start'),
      });
      expect(guarded[1]).not.toEqual(expect.objectContaining({ decision: 'deny' }));
      expect(guarded[2]).not.toEqual(expect.objectContaining({ decision: 'deny' }));
      const record = await new ConversationStore(join(home, 'conversations')).get(conversation.id);
      expect(record?.pendingToolCalls ?? []).not.toContain('held-command');
      await manager.drain();
    },
  );
});

describe('a held command says why, and what it waits for', () => {
  it('names the reason, when it lets commands run again, and the queue when there is one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-held-why-'));
    const said: unknown[] = [];
    const engine = new Scripted(async function* (input) {
      said.push(
        await input.guard?.({ toolName: 'Bash', toolUseId: 'b1', input: { command: 'ls' } }),
      );
      said.push(
        await input.guard?.({ toolName: 'Bash', toolUseId: 'b2', input: { command: 'ls' } }),
      );
      yield { type: 'done', outcome: 'success' };
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const start: HostTool = {
      name: 'process_start',
      description: 'Start a managed command',
      input: {},
      run: async () => 'Started.',
    };
    const manager = await open(
      home,
      engine,
      {
        allowed: () => false,
        room: () => ({
          room: false,
          reason: 'cpu',
          why: 'the processor is busy',
          until: 'once the processor has been calm for about half a minute',
        }),
      },
      [start],
    );
    try {
      const chat = await manager.send({ clientMessageId: 'u1', text: 'List the files' });
      await until(manager, chat.id, (events) => events.some((e) => e.type === 'turn.completed'));
      const message = (said[0] as { message: string }).message;
      expect(message).toContain('the processor is busy');
      expect(message).toContain('once the processor has been calm for about half a minute');
      expect(message).toContain('process_start');
      expect(message).not.toContain('ls');
      // Logged once a turn per reason, with no command in it.
      const lines = warn.mock.calls.filter((call) => String(call[0]).includes('[recovery]'));
      expect(lines).toHaveLength(1);
      expect(String(lines[0]?.[0])).not.toMatch(/\bls\b/);
    } finally {
      warn.mockRestore();
      await manager.drain();
    }
  });
});

describe('Conch pausing a chat for its own update', () => {
  it('carries it on while the computer is only busy; a crash still waits for room', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-update-busy-'));
    const first = await open(home, hangs());
    const paused = await first.send({ clientMessageId: 'u1', text: 'Fix the CI' });
    await until(first, paused.id, (e) => e.some((x) => x.type === 'assistant.delta'));
    expect(await first.pause('update', { waitMs: 50 })).toBe(1);
    await first.drain();

    // Busy (a CI runner, a build): no room for a crash's recovery, but an update's pause goes on.
    const engine = hangs();
    const after = await open(home, engine, {
      allowed: () => false,
      allowedPlanned: () => true,
      intervalMs: 20,
    });
    expect(await after.recoverInterrupted()).toBe(1);
    await vi.waitFor(() =>
      expect(engine.turns[0]?.prompt).toMatch(/paused this work at a safe point to update itself/),
    );
    await after.drain();

    // A chat a crash cut off waits for room, busy or not.
    const crashHome = await mkdtemp(join(tmpdir(), 'conch-crash-busy-'));
    const crashed = await open(crashHome, hangs());
    const cut = await crashed.send({ clientMessageId: 'u1', text: 'Pull the codebase' });
    await until(crashed, cut.id, (e) => e.some((x) => x.type === 'assistant.delta'));
    const waiting = hangs();
    const back = await open(crashHome, waiting, {
      allowed: () => false,
      allowedPlanned: () => true,
      intervalMs: 20,
    });
    expect(await back.recoverInterrupted()).toBe(0);
    expect(waiting.turns).toHaveLength(0);
    await back.drain();
  });

  it('stops it at a safe point, then carries it on after the restart, without spending the crash budget', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-update-pause-'));
    let manager = await open(home, hangs());
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Fix the CI' });
    await until(manager, convo.id, (e) => e.some((x) => x.type === 'assistant.delta'));
    expect(manager.working()).toEqual([{ id: convo.id, title: expect.any(String) }]);
    // Three updates in a row: each one pauses and carries on (a crash would stop at two).
    for (let round = 0; round < 3; round++) {
      expect(await manager.pause('update', { waitMs: 50 })).toBe(1);
      await manager.drain();
      const engine = hangs();
      manager = await open(home, engine);
      expect(await manager.recoverInterrupted()).toBe(1);
      await vi.waitFor(() =>
        expect(engine.turns[0]?.prompt).toMatch(
          /paused this work at a safe point to update itself/,
        ),
      );
      await until(
        manager,
        convo.id,
        (e) => e.filter((x) => x.type === 'turn.completed').length === round + 1,
      );
      await new Promise((r) => setTimeout(r, 20));
    }
    const { events } = await manager.detail(convo.id);
    expect(
      events.flatMap((e) => (e.type === 'turn.completed' && e.restarted ? [e.restarted] : [])),
    ).toEqual([
      { resumed: true, reason: 'update' },
      { resumed: true, reason: 'update' },
      { resumed: true, reason: 'update' },
    ]);
    await manager.drain();
  });

  it('lets a step already running finish first, and holds a new one unrun until after the restart', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-update-safe-point-'));
    let finishStep = () => {};
    const stepDone = new Promise<void>((resolve) => (finishStep = resolve));
    let secondGuarded = false;
    const before = await open(
      home,
      new Scripted(async function* (input) {
        await input.guard?.({ toolName: 'Bash', toolUseId: 't1', input: { command: 'npm test' } });
        yield { type: 'tool-start', toolUseId: 't1', name: 'Bash', input: { command: 'npm test' } };
        await stepDone;
        yield { type: 'tool-end', toolUseId: 't1', status: 'success', output: 'ok' };
        // The next step meets the pause: it waits here and never runs.
        await input.guard?.({ toolName: 'Bash', toolUseId: 't2', input: { command: 'git push' } });
        secondGuarded = true;
        yield { type: 'tool-start', toolUseId: 't2', name: 'Bash', input: { command: 'git push' } };
        yield { type: 'tool-end', toolUseId: 't2', status: 'success', output: 'pushed' };
      }),
    );
    const convo = await before.send({ clientMessageId: 'u1', text: 'Test, then push' });
    await until(before, convo.id, (e) => e.some((x) => x.type === 'tool.started'));
    let paused = false;
    const pausing = before.pause('update', { waitMs: 5_000, pollMs: 5 }).then((n) => {
      paused = true;
      return n;
    });
    await new Promise((r) => setTimeout(r, 40));
    // The running step hasn't finished: the pause waits for it.
    expect(paused).toBe(false);
    finishStep();
    expect(await pausing).toBe(1);
    // The next step reaches the pause in its own time (a model decides it after
    // the first ends): wait until it's held there, never for a fixed moment.
    await expect
      .poll(async () => new ConversationStore(join(home, 'conversations')).get(convo.id), {
        timeout: 5_000,
      })
      .toMatchObject({ pausedFor: 'update', pausedTools: ['t2'] });
    expect(secondGuarded).toBe(false);
    await before.drain();

    const engine = hangs();
    const after = await open(home, engine);
    // Nothing is uncertain: t1 finished, t2 never ran. It carries on by itself.
    expect(await after.recoverInterrupted()).toBe(1);
    const { events } = await after.detail(convo.id);
    expect(events.findLast((e) => e.type === 'turn.completed')).toMatchObject({
      restarted: { resumed: true, reason: 'update' },
    });
    expect(events.some((e) => e.type === 'tool.finished' && e.toolUseId === 't2')).toBe(false);
    await after.drain();
  });

  it('asks a waiting approval again after the update, instead of leaving it stuck', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-update-approval-'));
    const before = await open(
      home,
      new Scripted(async function* (input) {
        await input.guard?.({
          toolName: 'Bash',
          toolUseId: 'p1',
          input: { command: 'rm -rf build' },
        });
        yield {
          type: 'tool-start',
          toolUseId: 'p1',
          name: 'Bash',
          input: { command: 'rm -rf build' },
        };
        await input.requestPermission(
          { toolName: 'Bash', toolUseId: 'p1', input: { command: 'rm -rf build' } },
          input.signal,
        );
        await new Promise(() => undefined);
      }),
    );
    const convo = await before.send({ clientMessageId: 'u1', text: 'Clean the build' });
    await until(before, convo.id, (e) => e.some((x) => x.type === 'permission.requested'));
    // Waiting for an approval is a safe point: the pause doesn't wait for it.
    expect(await before.pause('update', { waitMs: 5_000 })).toBe(1);
    await before.drain();

    const engine = hangs();
    const after = await open(home, engine);
    expect(await after.recoverInterrupted()).toBe(1);
    await vi.waitFor(() =>
      expect(engine.turns[0]?.prompt).toMatch(/waiting for my approval.*was not run/),
    );
    const { events } = await after.detail(convo.id);
    expect(events.find((e) => e.type === 'tool.finished' && e.toolUseId === 'p1')).toMatchObject({
      status: 'error',
      output: expect.stringMatching(/^Not run/),
    });
    const stored = await new ConversationStore(join(home, 'conversations')).get(convo.id);
    expect(stored?.pendingToolCalls ?? []).not.toContain('p1');
    await after.drain();
  });

  it('a crash after a pause that never came is still a crash', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-update-unpause-'));
    const before = await open(home, hangs());
    const convo = await before.send({ clientMessageId: 'u1', text: 'Work' });
    await until(before, convo.id, (e) => e.some((x) => x.type === 'assistant.delta'));
    await before.pause('update', { waitMs: 10 });
    // The restart didn't happen: everything goes on, unmarked.
    before.unpause();
    await before.drain();
    const after = await open(home, hangs());
    expect(await after.recoverInterrupted()).toBe(1);
    expect(
      (await after.detail(convo.id)).events.findLast((e) => e.type === 'turn.completed'),
    ).toMatchObject({ restarted: { resumed: true } });
    expect(
      (await after.detail(convo.id)).events.findLast((e) => e.type === 'turn.completed'),
    ).not.toMatchObject({ restarted: { reason: 'update' } });
    await after.drain();
  });
});
