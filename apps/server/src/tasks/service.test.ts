import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  Capabilities,
  EngineId,
  EngineStatus,
  PermissionMode,
  ServerEvent,
  Task,
} from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { ConversationManager, type ToolProvider } from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { merged, noMoreThan, TASKS_PROMPT, TaskService } from './service';
import { TaskStore } from './store';

/**
 * A provider whose answers are scripted by what it's asked: "slow" waits to
 * be stopped, "ask" asks permission, "limit" runs out, "read the web" reads a
 * page, "edit" changes a file in its folder. Otherwise it reports a result.
 */
class Scripted implements Engine {
  readonly label: string;
  readonly integrations = { mode: 'bridge' as const };
  readonly smallModel = 'small-model';
  readonly turns: TurnInput[] = [];
  release?: () => void;
  /** The modes it honours (a test that needs Full trust widens it). */
  modes: PermissionMode[] = ['default'];

  constructor(readonly id: EngineId) {
    this.label = id === 'mock' ? 'Scripted' : 'Other';
  }

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
      permissionModes: this.modes,
    };
  }
  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    const said = input.prompt;
    if (/slow/.test(said)) {
      await new Promise<void>((resolve) => {
        this.release = resolve;
        input.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (input.signal.aborted) {
        yield { type: 'done', outcome: 'interrupted' };
        return;
      }
    }
    if (/limit/.test(said) && this.id === 'mock') {
      yield { type: 'done', outcome: 'error', error: 'You reached your limit.', problem: 'limit' };
      return;
    }
    if (/^ask(?:\s|$)/.test(said)) {
      yield {
        type: 'tool-start',
        toolUseId: 't-ask',
        name: 'Bash',
        input: { command: 'npm test' },
      };
      const decision = await input.requestPermission(
        { toolName: 'Bash', toolUseId: 't-ask', input: { command: 'npm test' } },
        input.signal,
      );
      yield {
        type: 'tool-end',
        toolUseId: 't-ask',
        status: decision === 'deny' ? 'error' : 'success',
      };
    }
    if (/read the web/.test(said)) {
      yield {
        type: 'tool-start',
        toolUseId: 't-web',
        name: 'WebFetch',
        input: { url: 'https://evil.example' },
      };
      yield { type: 'tool-end', toolUseId: 't-web', status: 'success', output: 'page' };
    }
    if (/edit/.test(said)) writeFileSync(join(input.cwd, 'changed.txt'), 'hi');
    if (/trusted workflow/.test(said))
      await input.tools.find((tool) => tool.name === 'fixture_read')?.run({});
    const report = input.tools.find((t) => t.name === 'report_result');
    await report?.run({ summary: `${this.label} did: ${said.slice(0, 40)}` } as never);
    yield { type: 'text', messageId: 'm', delta: 'All done.' };
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup(
  options: {
    home?: string;
    background?: number;
    allowed?: () => boolean;
    helpers?: number;
    overBudget?: boolean;
    tools?: ToolProvider;
    integrations?: ConstructorParameters<typeof ConversationManager>[0]['integrations'];
  } = {},
) {
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'conch-tasks-'));
  const engines = new Map<EngineId, Scripted>([
    ['mock', new Scripted('mock')],
    ['openrouter', new Scripted('openrouter')],
  ]);
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'mock', autoTitle: false } });
  const events: ServerEvent[] = [];
  const conversations = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    tools: options.tools,
    integrations: options.integrations,
    engine: (id) => engines.get(id ?? 'mock') ?? (engines.get('mock') as Scripted),
  });
  const make = () =>
    new TaskService({
      store: new TaskStore(home),
      conversations,
      engine: (id) => engines.get(id ?? 'mock') ?? (engines.get('mock') as Scripted),
      settings,
      emit: (event) => events.push(event),
      home,
      overBudget: async () => Boolean(options.overBudget),
      ready: async () => [...engines.values()],
      background: options.background,
      allowed: options.allowed,
      helpers: options.helpers,
    });
  const tasks = make();
  conversations.events.on((event) => tasks.onEvent(event));
  await tasks.start();
  return { home, tasks, conversations, settings, engines, events, make };
}

async function until<T>(get: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 2000; i++) {
    const value = await get();
    if (ok(value)) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never happened');
}

const status = (tasks: TaskService, id: string) => tasks.get(id).then((t) => t.status);

describe('a task sent to the background', () => {
  it('keeps queued work saved when resources are unavailable and refuses to pump after close', async () => {
    let allowed = false;
    const { tasks, engines } = await setup({ allowed: () => allowed });
    const first = await tasks.create({ kind: 'background', text: 'first' });
    await new Promise((r) => setTimeout(r, 30));
    expect((await tasks.get(first.id)).status).toBe('queued');
    expect(engines.get('mock')?.turns).toHaveLength(0);
    allowed = true;
    await tasks.create({ kind: 'background', text: 'second' });
    await until(
      () => tasks.get(first.id),
      (task) => task.status === 'unverified',
    );
    tasks.close();
    const last = await tasks.create({ kind: 'background', text: 'last' });
    await new Promise((r) => setTimeout(r, 30));
    expect((await tasks.get(last.id)).status).toBe('queued');
  });

  it('sent from no chat, its own chat is one of your chats', async () => {
    const { tasks, conversations } = await setup();
    const task = await tasks.create({ kind: 'background', text: 'draft the weekly note' });
    const done = await until(
      () => tasks.get(task.id),
      (t) => t.status === 'unverified',
    );
    const { conversation } = await conversations.detail(done.conversationId ?? '');
    expect(conversation.origin).toEqual({ kind: 'task', taskId: task.id, standalone: true });
  });

  it('runs on its own, and its result comes back to the chat it came from', async () => {
    const { tasks, conversations } = await setup();
    const chat = await conversations.send({ clientMessageId: 'u1', text: 'hello' });
    await until(
      () => conversations.detail(chat.id),
      (d) => d.conversation.status === 'idle',
    );
    const task = await tasks.create({
      kind: 'background',
      text: 'tidy the README',
      parentConversationId: chat.id,
    });
    const done = await until(
      () => tasks.get(task.id),
      (t) => t.status === 'unverified',
    );
    expect(done.summary).toBe('Scripted did: tidy the README');
    expect(done.conversationId).toBeDefined();
    const { conversation } = await conversations.detail(done.conversationId ?? '');
    expect(conversation.origin).toEqual({ kind: 'task', taskId: task.id });
    const cards = (await conversations.detail(chat.id)).events.filter((e) => e.type === 'task');
    expect(cards.map((e) => (e.type === 'task' ? e.state : ''))).toEqual([
      'queued',
      'running',
      'unverified',
    ]);
    expect(cards.at(-1)).toMatchObject({ summary: 'Scripted did: tidy the README' });
  });

  it('a few at a time: the rest wait their turn', async () => {
    const { tasks, engines } = await setup({ background: 1 });
    const first = await tasks.create({ kind: 'background', text: 'slow one' });
    const second = await tasks.create({ kind: 'background', text: 'quick one' });
    await until(
      () => status(tasks, first.id),
      (s) => s === 'running',
    );
    expect(await status(tasks, second.id)).toBe('queued');
    await until(async () => engines.get('mock')?.release, Boolean);
    engines.get('mock')?.release?.();
    await until(
      () => status(tasks, second.id),
      (s) => s === 'unverified',
    );
    expect(await status(tasks, first.id)).toBe('unverified');
  });

  it('waits for your OK without holding up the others', async () => {
    const { tasks, conversations } = await setup({ background: 2 });
    const asking = await tasks.create({ kind: 'background', text: 'ask before testing' });
    const other = await tasks.create({ kind: 'background', text: 'just do it' });
    await until(
      () => status(tasks, asking.id),
      (s) => s === 'needs-you',
    );
    await until(
      () => status(tasks, other.id),
      (s) => s === 'unverified',
    );
    const conversationId = (await tasks.get(asking.id)).conversationId ?? '';
    const request = (await conversations.detail(conversationId)).events.find(
      (e) => e.type === 'permission.requested',
    );
    if (request?.type !== 'permission.requested') throw new Error('no question');
    await conversations.respond(conversationId, request.permissionId, 'allow');
    const done = await until(
      () => tasks.get(asking.id),
      (t) => t.status === 'unverified',
    );
    expect(done.steps.map((s) => s.label)).toContain('Tool returned: Run `npm test`');
  });

  it('stops when you stop it, queued or running', async () => {
    const { tasks } = await setup({ background: 1 });
    const running = await tasks.create({ kind: 'background', text: 'slow one' });
    const waiting = await tasks.create({ kind: 'background', text: 'next' });
    await until(
      () => status(tasks, running.id),
      (s) => s === 'running',
    );
    expect((await tasks.stop(waiting.id)).status).toBe('stopped');
    await tasks.stop(running.id);
    await until(
      () => status(tasks, running.id),
      (s) => s === 'stopped',
    );
  });

  it('late tool results cannot clear uncertainty after the stopped turn has closed', async () => {
    let release = () => {};
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    let pending: Promise<unknown> | undefined;
    const reconcile = vi.fn(async () => ({
      state: 'confirmed' as const,
      receipt: { provider: 'fixture', id: 'late', label: 'Late result' },
    }));
    const { tasks, engines } = await setup({
      tools: () => [
        {
          name: 'late_write',
          description: 'Fixture',
          input: {},
          run: async () => {
            started = true;
            await response;
            return 'saved';
          },
          verification: {
            effect: 'write',
            scope: async () => ({
              account: 'fixture',
              authorization: 'fixture',
              expiresAt: Number.MAX_SAFE_INTEGER,
            }),
            reconcile,
          },
        },
      ],
    });
    const engine = engines.get('mock');
    if (!engine) throw new Error('Missing mock');
    vi.spyOn(engine, 'runTurn').mockImplementation(
      async function* (input): AsyncIterable<EngineEvent> {
        pending = input.tools
          .find((tool) => tool.name === 'late_write')
          ?.run({})
          .catch((error: unknown) => error);
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        yield { type: 'done', outcome: 'interrupted' };
      },
    );
    const task = await tasks.create({ kind: 'background', text: 'late tool' });
    await until(async () => started, Boolean);
    await tasks.stop(task.id);
    await until(
      () => status(tasks, task.id),
      (s) => s === 'stopped',
    );
    release();
    await pending;
    expect((await tasks.get(task.id)).operations?.[0]).toMatchObject({ state: 'running' });
    expect((await tasks.get(task.id)).operations?.[0]?.execution).toBeUndefined();
    expect((await tasks.get(task.id)).operations?.[0]?.receipt).toBeUndefined();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('after a crash, says it stopped, and runs again with one press', async () => {
    const { tasks, make, conversations } = await setup();
    const task = await tasks.create({ kind: 'background', text: 'slow one' });
    await until(
      () => status(tasks, task.id),
      (s) => s === 'running',
    );
    // Conch stops; a new one starts from the same files.
    const again = make();
    conversations.events.on((event) => again.onEvent(event));
    await again.start();
    const after = await again.get(task.id);
    expect(after).toMatchObject({
      status: 'interrupted',
      error: expect.stringMatching(/Conch stopped/),
    });
    await again.retry(task.id);
    expect(['queued', 'running']).toContain(await status(again, task.id));
  });

  it('reports a provider startup exception instead of leaving a task running forever', async () => {
    const { tasks, engines } = await setup();
    vi.spyOn(engines.get('mock') as Scripted, 'detect').mockImplementation(() => {
      throw new Error('Fixture provider could not start');
    });
    const task = await tasks.create({ kind: 'background', text: 'start a task' });
    const [done] = await tasks.waitFor([task.id]);
    expect(done).toMatchObject({ status: 'failed', error: 'Fixture provider could not start' });
    tasks.close();
  });

  it('shutdown during provider detection admits no new turn', async () => {
    const { tasks, engines, make } = await setup();
    const engine = engines.get('mock');
    if (!engine) throw new Error('Missing engine');
    let release = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const detect = engine.detect.bind(engine);
    vi.spyOn(engine, 'detect').mockImplementation(async () => {
      await wait;
      return detect();
    });
    const task = await tasks.create({ kind: 'background', text: 'detect then start' });
    await until(async () => vi.mocked(engine.detect).mock.calls.length, Boolean);
    tasks.close();
    release();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(engine.turns).toHaveLength(0);
    const again = make();
    await again.start();
    expect((await again.get(task.id)).status).toBe('interrupted');
    again.close();
  });

  it('restart clears old approval cards, preserves queued work, and waits for explicit resume', async () => {
    const first = await setup({ background: 1 });
    const asking = await first.tasks.create({ kind: 'background', text: 'ask before testing' });
    await until(
      () => first.tasks.get(asking.id),
      (t) => !!t.asking,
    );
    const queued = await first.tasks.create({ kind: 'background', text: 'queued before restart' });
    first.tasks.close();
    await first.conversations.drain();
    const second = await setup({ home: first.home });
    const recovered = await second.tasks.get(asking.id);
    expect(recovered).toMatchObject({ status: 'interrupted', modelCompleted: false });
    expect(recovered.asking).toBeUndefined();
    expect((await second.tasks.get(queued.id)).status).toBe('interrupted');
    expect(second.engines.get('mock')?.turns).toHaveLength(0);
    await second.tasks.retry(queued.id);
    const [done] = await second.tasks.waitFor([queued.id]);
    expect(done?.status).toBe('unverified');
    expect((await second.tasks.get(asking.id)).status).toBe('interrupted');
    second.tasks.close();
  });

  it('a pending host approval is asked afresh after restart and an old answer cannot release it', async () => {
    let writes = 0;
    const tools: ToolProvider = () => [
      {
        name: 'fixture_write',
        description: 'Write fixture',
        input: {},
        run: async () => {
          writes++;
          return 'saved';
        },
      },
    ];
    const script = async function* (input: TurnInput): AsyncIterable<EngineEvent> {
      const decision = await input.requestPermission(
        { toolName: 'fixture_write', toolUseId: 'write', input: {} },
        input.signal,
      );
      if (decision !== 'deny')
        await input.tools.find((tool) => tool.name === 'fixture_write')?.run({});
      yield { type: 'done', outcome: 'success' };
    };
    const first = await setup({ tools });
    vi.spyOn(first.engines.get('mock') as Scripted, 'runTurn').mockImplementation(script);
    const task = await first.tasks.create({ kind: 'background', text: 'write with approval' });
    const waiting = await until(
      () => first.tasks.get(task.id),
      (t) => !!t.asking,
    );
    first.tasks.close();
    await first.conversations.drain();
    const second = await setup({ home: first.home, tools });
    vi.spyOn(second.engines.get('mock') as Scripted, 'runTurn').mockImplementation(script);
    await second.tasks.retry(task.id);
    const fresh = await until(
      () => second.tasks.get(task.id),
      (t) => !!t.asking && t.status === 'needs-you',
    );
    expect(fresh.conversationId).toBe(waiting.conversationId);
    expect(fresh.asking?.permissionId).not.toBe(waiting.asking?.permissionId);
    await second.conversations.respond(
      fresh.conversationId ?? '',
      waiting.asking?.permissionId ?? '',
      'allow',
    );
    expect(writes).toBe(0);
    expect((await second.tasks.get(task.id)).status).toBe('needs-you');
    await second.conversations.respond(
      fresh.conversationId ?? '',
      fresh.asking?.permissionId ?? '',
      'allow',
    );
    await second.tasks.waitFor([task.id]);
    expect(writes).toBe(1);
    second.tasks.close();
  });

  it('a resumed task keeps its original folder and takes the parent’s stricter current permissions', async () => {
    const first = await setup();
    const workspace = await first.settings.workspace();
    const parent = await first.conversations.send({
      clientMessageId: 'parent',
      text: 'hi',
      options: { permissionMode: 'bypassPermissions' },
    });
    await until(
      () => first.conversations.detail(parent.id),
      (d) => d.conversation.status === 'idle',
    );
    const task = await first.tasks.create({
      kind: 'background',
      text: 'inspect files',
      parentConversationId: parent.id,
    });
    const [before] = await first.tasks.waitFor([task.id]);
    first.tasks.close();
    await first.conversations.drain();
    const second = await setup({ home: first.home });
    await second.settings.update({
      preferences: { workspace: mkdtempSync(join(tmpdir(), 'conch-new-workspace-')) },
    });
    await second.conversations.configure(parent.id, { permissionMode: 'plan' });
    await second.conversations.addTaint(parent.id, [{ kind: 'web', label: 'untrusted.example' }]);
    await second.conversations.addHolds(
      parent.id,
      [
        {
          skillId: 'read-only-review',
          name: 'read-only-review',
          title: 'Read only review',
          permissions: { declared: true, capabilities: [], words: ['read files'] },
          seq: 0,
        },
      ],
      'source-chat',
    );
    await second.tasks.retry(task.id);
    const [done] = await second.tasks.waitFor([task.id]);
    expect(done?.conversationId).toBe(before?.conversationId);
    expect(done?.options.permissionMode).toBe('plan');
    expect(second.engines.get('mock')?.turns.at(-1)?.cwd).toBe(workspace);
    expect(await second.conversations.taintOf(done?.conversationId ?? '')).toContainEqual({
      kind: 'web',
      label: 'untrusted.example',
    });
    expect(await second.conversations.holdsOf(done?.conversationId ?? '')).toMatchObject([
      { skillId: 'read-only-review', from: parent.id },
    ]);
    second.tasks.close();
  });

  it('at a provider’s limit, carries on with your fallback provider, and says so', async () => {
    const { tasks, settings } = await setup();
    await settings.update({ preferences: { limitFallback: 'openrouter' } });
    const task = await tasks.create({ kind: 'background', text: 'hit the limit' });
    const done = await until(
      () => tasks.get(task.id),
      (t) => t.status === 'unverified' || t.status === 'failed',
    );
    expect(done).toMatchObject({
      status: 'unverified',
      summary: expect.stringContaining('Other did:'),
      note: 'Scripted reached its limit, so Other carried on.',
    });
  });

  it('without a fallback, a limit is a failure that says why', async () => {
    const { tasks } = await setup();
    const task = await tasks.create({ kind: 'background', text: 'hit the limit' });
    const done = await until(
      () => tasks.get(task.id),
      (t) => t.status === 'failed',
    );
    expect(done.error).toMatch(/limit/);
  });
});

describe('safe continuation and bounded workflow requests', () => {
  it('reuses the existing conversation and confirmed progress, rejecting simultaneous retry', async () => {
    const { tasks, conversations } = await setup();
    const first = await tasks.create({ kind: 'background', text: 'research this topic' });
    const before = await until(
      () => tasks.get(first.id),
      (task) => task.status === 'unverified',
    );
    const retries = await Promise.allSettled([tasks.retry(first.id), tasks.retry(first.id)]);
    expect(retries.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const after = await until(
      () => tasks.get(first.id),
      (task) => task.status === 'unverified',
    );
    expect(after.conversationId).toBe(before.conversationId);
    const chat = await conversations.detail(after.conversationId ?? '');
    expect(chat.events.filter((event) => event.type === 'user.message')).toHaveLength(2);
    expect(
      chat.events.some(
        (event) => event.type === 'user.message' && event.text.includes('Confirmed progress'),
      ),
    ).toBe(true);
  });

  it('HTTP retry/double click is idempotent, while altered scope with the same key is rejected', async () => {
    const { tasks } = await setup({ background: 0 });
    const input = {
      kind: 'background' as const,
      text: 'draft only',
      requestKey: 'one-click',
      workflow: 'followups' as const,
      toolScope: { names: ['draft'], accountId: 'account_1' },
    };
    const [first, duplicate] = await Promise.all([tasks.create(input), tasks.create(input)]);
    expect(duplicate.id).toBe(first.id);
    expect((await tasks.list()).tasks).toHaveLength(1);
    await expect(tasks.create({ ...input, toolScope: { names: ['Bash'] } })).rejects.toThrow(
      /different work/,
    );
    await tasks.remove(first.id);
    expect((await tasks.list()).tasks).toHaveLength(0);
    expect((await tasks.create(input)).id).toBe(first.id);
  });

  it('user continuation preserves scope and chat; replay cannot revise the request', async () => {
    const { tasks, conversations } = await setup();
    const initial = await tasks.create({
      kind: 'background',
      text: 'first draft',
      toolScope: { names: ['artifact_create'], accountId: 'same-account' },
      expectations: [{ tool: 'artifact_create', minimum: 1 }],
    });
    const before = await until(
      () => tasks.get(initial.id),
      (task) => task.status === 'unverified',
    );
    await expect(
      conversations.send({
        conversationId: before.conversationId,
        text: 'bypass task scope',
        clientMessageId: 'bypass',
      }),
    ).rejects.toThrow(/Resume safely/);
    await tasks.continue(initial.id, 'Make the introduction shorter', 'revision-1');
    const after = await until(
      () => tasks.get(initial.id),
      (task) => task.status === 'unverified',
    );
    expect(after.conversationId).toBe(before.conversationId);
    expect(after.toolScope).toEqual(before.toolScope);
    expect(after.expectations).toEqual(before.expectations);
    expect(after.goalRevision).toBe(1);
    expect(
      (await tasks.continue(initial.id, 'Make the introduction shorter', 'revision-1')).rev,
    ).toBe(after.rev);
    await expect(tasks.continue(initial.id, 'Now send it', 'revision-1')).rejects.toThrow(
      /different instruction/,
    );
    await expect(tasks.continue(initial.id, '   ')).rejects.toThrow(/instruction/);
  });

  it('does not change the instruction while queued or running', async () => {
    const { tasks } = await setup({ background: 0 });
    const task = await tasks.create({ kind: 'background', text: 'queued' });
    await expect(tasks.continue(task.id, 'a different goal')).rejects.toThrow(/Wait/);
    expect((await tasks.get(task.id)).prompt).toBe('queued');
  });

  it('scoped jobs receive only their approved common tools and verify real tool evidence', async () => {
    let read = false;
    const forbidden = vi.fn(async () => 'must not run');
    const { tasks, engines } = await setup({
      tools: () => [
        {
          name: 'fixture_read',
          description: 'Read fixture',
          input: {},
          run: async () => {
            read = true;
            return 'Actual fixture contents';
          },
          verification: {
            effect: 'read',
            scope: async () => ({
              account: 'fixture',
              authorization: 'read',
              expiresAt: Number.MAX_SAFE_INTEGER,
            }),
            reconcile: async () =>
              read
                ? {
                    state: 'confirmed',
                    receipt: { provider: 'fixture', id: 'read-1', label: 'Read fixture contents' },
                  }
                : { state: 'unknown' },
          },
        },
        { name: 'delegate', description: 'Not allowed', input: {}, run: forbidden },
      ],
    });
    const task = await tasks.create({
      kind: 'background',
      text: 'trusted workflow',
      toolScope: { names: ['fixture_read'] },
      expectations: [{ tool: 'fixture_read', minimum: 1 }],
    });
    const result = await until(
      () => tasks.get(task.id),
      (value) => value.finishedAt !== undefined,
    );
    expect(result.status).toBe('done');
    expect(result.verification).toBe('verified');
    expect(result.operations?.[0]?.receipt?.id).toBe('read-1');
    expect(
      engines
        .get('mock')
        ?.turns[0]?.tools.map((tool) => tool.name)
        .sort(),
    ).toEqual(['fixture_read', 'report_result']);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('foreground draft handoff is exact, approval-gated and deduplicated within the original user turn', async () => {
    const { tasks, conversations } = await setup({ background: 0 });
    const chat = await conversations.send({
      clientMessageId: 'draft-source',
      text: 'Prepare a reply',
      options: { engine: 'mock', model: 'parent-model' },
    });
    await until(
      () => conversations.detail(chat.id),
      (value) => value.conversation.status === 'idle',
    );
    const draft = {
      accountId: 'account_1',
      to: ['person@example.com'],
      subject: 'Hello',
      body: 'Prepared text',
    };
    const [first, repeated] = await Promise.all([
      tasks.createDraft({ parentConversationId: chat.id, draft }),
      tasks.createDraft({
        parentConversationId: chat.id,
        draft: {
          body: 'Prepared text',
          subject: 'Hello',
          to: ['person@example.com'],
          accountId: 'account_1',
          threadId: undefined,
        },
      }),
    ]);
    expect(repeated.id).toBe(first.id);
    expect(first.options).toMatchObject({
      engine: 'mock',
      model: 'parent-model',
      permissionMode: 'default',
    });
    expect(first.toolScope).toMatchObject({
      names: ['google_mail_create_draft'],
      limits: { google_mail_create_draft: 1 },
      accountId: 'account_1',
    });
    expect(first.toolScope?.argumentHashes?.google_mail_create_draft).toMatch(/^[a-f0-9]{64}$/);
    expect(first.expectations).toEqual([
      {
        tool: 'google_mail_create_draft',
        minimum: 1,
        inputHash: first.toolScope?.argumentHashes?.google_mail_create_draft,
      },
    ]);
    expect(first.parentConversationId).toBe(chat.id);
    await conversations.send({
      conversationId: chat.id,
      clientMessageId: 'new-request',
      text: 'Prepare another copy intentionally',
    });
    await until(
      () => conversations.detail(chat.id),
      (value) => value.conversation.status === 'idle',
    );
    expect((await tasks.createDraft({ parentConversationId: chat.id, draft })).id).not.toBe(
      first.id,
    );
    await expect(
      tasks.createDraft({
        parentConversationId: chat.id,
        draft: { ...draft, body: 'x'.repeat(20_001) },
      }),
    ).rejects.toThrow(/too long/);
  });

  it('scoped source notes cannot initialize unrelated MCP integrations', async () => {
    const initialize = vi.fn(async () => undefined);
    const { tasks } = await setup({ integrations: { forTurn: initialize } as never });
    const task = await tasks.create({
      kind: 'background',
      text: 'Notes mention Slack and an installed MCP app',
      toolScope: { names: ['artifact_create'] },
    });
    await until(
      () => tasks.get(task.id),
      (value) => value.finishedAt !== undefined,
    );
    expect(initialize).not.toHaveBeenCalled();
  });

  it('scoped tasks do not silently switch the selected provider after a quota limit', async () => {
    const { tasks, settings, engines } = await setup();
    await settings.update({ preferences: { limitFallback: 'openrouter' } });
    const task = await tasks.create({
      kind: 'background',
      text: 'hit the limit',
      toolScope: { names: ['artifact_create'] },
    });
    const result = await until(
      () => tasks.get(task.id),
      (value) => value.finishedAt !== undefined,
    );
    expect(result.status).toBe('failed');
    expect(engines.get('openrouter')?.turns).toHaveLength(0);
  });

  it('workflow scope rejects arbitrary native tools regardless of permission mode', async () => {
    const { tasks, engines } = await setup();
    const task = await tasks.create({
      kind: 'background',
      text: 'draft a note',
      options: { permissionMode: 'default' },
      toolScope: { names: ['artifact_create'] },
    });
    await until(
      () => tasks.get(task.id),
      (value) => value.status === 'unverified',
    );
    const turn = engines.get('mock')?.turns[0];
    if (!turn) throw new Error('Expected a running scripted turn');
    for (const toolName of [
      'Bash',
      'Write',
      'browser_click',
      'mcp__gmail__send',
      'mcp__conch__start_background_task',
    ]) {
      expect(await turn.guard?.({ toolName, input: {} })).toMatchObject({ decision: 'deny' });
      expect(await turn.requestPermission({ toolName, input: {} }, turn.signal)).toBe('deny');
    }
  });
});

describe('helpers side by side (delegate)', () => {
  const ctx = (conversationId: string, engine: Engine, signal = new AbortController().signal) => ({
    conversationId,
    append: () => undefined,
    engine,
    permissionMode: 'default' as const,
    ask: async () => 'deny' as const,
    signal,
  });

  it('runs the parts at once on the fast model, and brings the results back together', async () => {
    const { tasks, conversations, engines } = await setup();
    const chat = await conversations.send({ clientMessageId: 'u1', text: 'hi' });
    await until(
      () => conversations.detail(chat.id),
      (d) => d.conversation.status === 'idle',
    );
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    const out = await delegate?.run({
      parts: [
        { title: 'Check A', instructions: 'look at A', model: 'fast', worktree: false },
        { title: 'Check B', instructions: 'look at B', model: 'same', worktree: false },
      ],
    } as never);
    expect(out).toBe(
      '## Check A\nFinished; no automatic outcome criteria: Scripted did: look at A\n\n## Check B\nFinished; no automatic outcome criteria: Scripted did: look at B',
    );
    const helpers = (await tasks.list()).tasks.filter((t) => t.kind === 'helper');
    expect(helpers).toHaveLength(2);
    expect(new Set(helpers.map((t) => t.group)).size).toBe(1);
    expect(helpers.find((t) => t.title === 'Check A')?.options.model).toBe('small-model');
    expect(helpers.find((t) => t.title === 'Check B')?.options.model).toBeUndefined();
    const cards = (await conversations.detail(chat.id)).events.filter((e) => e.type === 'task');
    expect(new Set(cards.map((e) => (e.type === 'task' ? e.taskId : '')))).toEqual(
      new Set(helpers.map((t) => t.id)),
    );
  });

  it('stopping the chat stops its helpers', async () => {
    const { tasks, conversations, engines } = await setup();
    const chat = await conversations.send({ clientMessageId: 'u1', text: 'hi' });
    await until(
      () => conversations.detail(chat.id),
      (d) => d.conversation.status === 'idle',
    );
    const abort = new AbortController();
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine, abort.signal))
      .find((t) => t.name === 'delegate');
    const pending = delegate?.run({
      parts: [{ title: 'Slow', instructions: 'slow work', model: 'fast', worktree: false }],
    } as never);
    await until(
      async () => (await tasks.list()).tasks.find((t) => t.kind === 'helper')?.status,
      (s) => s === 'running',
    );
    abort.abort();
    expect(await pending).toBe('## Slow\nStopped before it finished.');
  });

  it('over your monthly budget, doesn’t multiply the spend', async () => {
    const { tasks, conversations, engines } = await setup({ overBudget: true });
    const chat = await conversations.send({ clientMessageId: 'u1', text: 'hi' });
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    expect(
      await delegate?.run({
        parts: [{ title: 'A', instructions: 'a', model: 'fast', worktree: false }],
      } as never),
    ).toMatch(/monthly budget/);
    expect((await tasks.list()).tasks).toHaveLength(0);
  });

  it('helpers start as wary as their chat, and what they read comes back with them', async () => {
    const { tasks, conversations, engines } = await setup();
    const chat = await conversations.send({ clientMessageId: 'u1', text: 'hi' });
    await until(
      () => conversations.detail(chat.id),
      (d) => d.conversation.status === 'idle',
    );
    await conversations.addTaint(chat.id, [{ kind: 'person', label: 'Ana on Telegram' }]);
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    await delegate?.run({
      parts: [{ title: 'Read', instructions: 'read the web', model: 'fast', worktree: false }],
    } as never);
    const helper = (await tasks.list()).tasks[0] as Task;
    const childTaint = await conversations.taintOf(helper.conversationId ?? '');
    expect(childTaint).toEqual(
      expect.arrayContaining([
        { kind: 'person', label: 'Ana on Telegram' },
        { kind: 'web', label: 'evil.example' },
      ]),
    );
    expect(await conversations.taintOf(chat.id)).toContainEqual({
      kind: 'web',
      label: 'evil.example',
    });
  });

  it('helpers are held to the skills their chat is held to (ADR 0047)', async () => {
    const { tasks, conversations, engines } = await setup();
    const chat = await conversations.send({ clientMessageId: 'u1', text: 'hi' });
    await until(
      () => conversations.detail(chat.id),
      (d) => d.conversation.status === 'idle',
    );
    const git = {
      declared: true,
      capabilities: ['commands' as const],
      commands: ['git'],
      words: ['run commands (only `git`)'],
    };
    await conversations.addHolds(
      chat.id,
      [
        {
          skillId: 'quick-setup',
          name: 'quick-setup',
          title: 'Quick setup',
          permissions: git,
          seq: 0,
        },
      ],
      'c_elsewhere',
    );
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    await delegate?.run({
      parts: [{ title: 'A', instructions: 'look around', model: 'fast', worktree: false }],
    } as never);
    const helper = (await tasks.list()).tasks[0] as Task;
    expect(await conversations.holdsOf(helper.conversationId ?? '')).toMatchObject([
      { skillId: 'quick-setup', permissions: git, from: chat.id },
    ]);
    const { events } = await conversations.detail(helper.conversationId ?? '');
    expect(events.find((e) => e.type === 'skill.used')).toMatchObject({
      by: 'carried',
      from: chat.id,
    });
    // What it was handed doesn't come back as a second hold.
    expect(await conversations.holdsOf(chat.id)).toHaveLength(1);
  });

  it('a code part gets its own worktree: kept with its branch when it changed things, gone when not', async () => {
    const { tasks, conversations, engines, settings, home } = await setup();
    const repo = mkdtempSync(join(tmpdir(), 'conch-repo-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=A', 'commit', '--allow-empty', '-qm', 'start');
    await settings.update({ preferences: { workspace: repo } });
    const chat = await conversations.send({ clientMessageId: 'u1', text: 'hi' });
    await until(
      () => conversations.detail(chat.id),
      (d) => d.conversation.status === 'idle',
    );
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    const out = await delegate?.run({
      parts: [
        { title: 'Change it', instructions: 'edit the file', model: 'fast', worktree: true },
        { title: 'Just look', instructions: 'look around', model: 'fast', worktree: true },
      ],
    } as never);
    const helpers = (await tasks.list()).tasks;
    const changed = helpers.find((t) => t.title === 'Change it');
    const looked = helpers.find((t) => t.title === 'Just look');
    expect(changed?.worktree).toMatchObject({ changed: true, branch: `conch/${changed?.id}` });
    expect(existsSync(join(changed?.worktree?.path ?? '', 'changed.txt'))).toBe(true);
    expect(looked?.worktree?.changed).toBe(false);
    expect(existsSync(looked?.worktree?.path ?? '/nope')).toBe(false);
    expect(out).toContain(`branch \`conch/${changed?.id}\``);
    expect(changed?.worktree?.path.startsWith(join(home, 'worktrees'))).toBe(true);
  });
  it('reopens a cleaned worktree at its saved base after restart', async () => {
    const first = await setup();
    const repo = mkdtempSync(join(tmpdir(), 'conch-reopen-repo-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=A', 'commit', '--allow-empty', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    await first.settings.update({ preferences: { workspace: repo } });
    const task = await first.tasks.create({ kind: 'helper', text: 'look around', worktree: true });
    const [before] = await first.tasks.waitFor([task.id]);
    expect(before?.worktree).toMatchObject({ base, retained: false });
    first.tasks.close();
    await first.conversations.drain();
    git('-c', 'user.email=a@b.c', '-c', 'user.name=A', 'commit', '--allow-empty', '-qm', 'later');
    const second = await setup({ home: first.home });
    const engine = second.engines.get('mock');
    if (!engine) throw new Error('Missing engine');
    const run = engine.runTurn.bind(engine);
    let resumedHead = '';
    vi.spyOn(engine, 'runTurn').mockImplementation(async function* (input) {
      resumedHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: input.cwd,
        encoding: 'utf8',
      }).trim();
      yield* run(input);
    });
    await second.tasks.retry(task.id);
    const [done] = await second.tasks.waitFor([task.id]);
    expect(done?.status).toBe('unverified');
    expect(engine.turns.at(-1)?.cwd).toBe(before?.worktree?.path);
    expect(resumedHead).toBe(base);
    second.tasks.close();
  });

  it('can resume if Conch dies after cleaning a worktree but before saving completion', async () => {
    const first = await setup();
    const repo = mkdtempSync(join(tmpdir(), 'conch-cleanup-crash-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=A', 'commit', '--allow-empty', '-qm', 'base');
    await first.settings.update({ preferences: { workspace: repo } });
    const save = TaskStore.prototype.save;
    let lostCompletion = false;
    const saving = vi.spyOn(TaskStore.prototype, 'save').mockImplementation(function (
      this: TaskStore,
      task,
    ) {
      if (
        task.kind === 'helper' &&
        task.status === 'unverified' &&
        task.worktree?.retained === false
      ) {
        lostCompletion = true;
        return new Promise<Task>(() => {});
      }
      return save.call(this, task);
    });
    try {
      const task = await first.tasks.create({ kind: 'helper', text: 'inspect', worktree: true });
      await until(async () => lostCompletion, Boolean);
      expect(existsSync(task.worktree?.path ?? '')).toBe(false);
      first.tasks.close();
      await first.conversations.drain();
      saving.mockRestore();
      const second = await setup({ home: first.home });
      expect((await second.tasks.get(task.id)).worktree?.retained).toBe(false);
      await second.tasks.retry(task.id);
      const [done] = await second.tasks.waitFor([task.id]);
      expect(done?.status).toBe('unverified');
      expect(second.engines.get('mock')?.turns.at(-1)?.cwd).toBe(task.worktree?.path);
      second.tasks.close();
    } finally {
      saving.mockRestore();
      first.tasks.close();
    }
  });

  it('retains an interrupted clean worktree and resumes in it after a cold restart', async () => {
    const first = await setup();
    const repo = mkdtempSync(join(tmpdir(), 'conch-interrupted-repo-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=A', 'commit', '--allow-empty', '-qm', 'base');
    await first.settings.update({ preferences: { workspace: repo } });
    const task = await first.tasks.create({ kind: 'helper', text: 'slow inspect', worktree: true });
    await until(async () => first.engines.get('mock')?.turns.length, Boolean);
    first.tasks.close();
    await first.conversations.drain();
    const second = await setup({ home: first.home });
    const engine = second.engines.get('mock');
    if (!engine) throw new Error('Missing engine');
    await second.tasks.retry(task.id);
    await until(async () => engine.turns.length, Boolean);
    expect(engine.turns.at(-1)?.cwd).toBe(task.worktree?.path);
    engine.release?.();
    const [done] = await second.tasks.waitFor([task.id]);
    expect(done?.status).toBe('unverified');
    expect(done?.worktree?.retained).toBe(false);
    second.tasks.close();
  });
});

describe('helpers on another provider', () => {
  const ctx = (conversationId: string, engine: Engine) => ({
    conversationId,
    append: () => undefined,
    engine,
    permissionMode: 'acceptEdits' as const,
    ask: async () => 'deny' as const,
    signal: new AbortController().signal,
  });

  async function idleChat(conversations: ConversationManager, options?: { model: string }) {
    const chat = await conversations.send({
      clientMessageId: 'u1',
      text: 'hi',
      ...(options && { options }),
    });
    await until(
      () => conversations.detail(chat.id),
      (d) => d.conversation.status === 'idle',
    );
    return chat;
  }

  it('hands a part to the provider asked for, in the chat’s own mode, and says who did it', async () => {
    const { tasks, conversations, engines } = await setup();
    const chat = await idleChat(conversations);
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    const out = await delegate?.run({
      parts: [
        {
          title: 'Write the tests',
          instructions: 'write the tests',
          provider: 'openrouter',
          model: 'fast',
          worktree: false,
        },
        { title: 'Check it', instructions: 'check it', model: 'fast', worktree: false },
      ],
    } as never);
    expect(out).toBe(
      '## Write the tests\nFinished; no automatic outcome criteria: Other did: write the tests\n\n## Check it\nFinished; no automatic outcome criteria: Scripted did: check it',
    );
    const helpers = (await tasks.list()).tasks;
    const other = helpers.find((t) => t.title === 'Write the tests');
    expect(other).toMatchObject({
      by: 'Other',
      options: { engine: 'openrouter', model: 'small-model', permissionMode: 'acceptEdits' },
    });
    expect(helpers.find((t) => t.title === 'Check it')?.by).toBeUndefined();
    // It ran there, and only there; a mode it can't honour became its safest.
    const ran = engines.get('openrouter')?.turns ?? [];
    expect(ran).toHaveLength(1);
    expect(ran[0]?.options.permissionMode).toBe('default');
    const card = (await conversations.detail(chat.id)).events.findLast(
      (e) => e.type === 'task' && e.taskId === other?.id,
    );
    expect(card).toMatchObject({ by: 'Other' });
  });

  it('knows a provider by its name too', async () => {
    const { tasks, conversations, engines } = await setup();
    const chat = await idleChat(conversations);
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    await delegate?.run({
      parts: [{ title: 'A', instructions: 'a', provider: 'other', model: 'same', worktree: false }],
    } as never);
    expect((await tasks.list()).tasks[0]?.options.engine).toBe('openrouter');
  });

  it('a provider that isn’t connected starts nothing, and says who can take it', async () => {
    const { tasks, conversations, engines } = await setup();
    const chat = await idleChat(conversations);
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    const out = await delegate?.run({
      parts: [
        { title: 'A', instructions: 'a', model: 'fast', worktree: false },
        { title: 'B', instructions: 'b', provider: 'gemini-cli', model: 'fast', worktree: false },
      ],
    } as never);
    expect(out).toMatch(/^Nothing was started\. “gemini-cli” isn’t a provider/);
    expect(out).toContain('Other (`openrouter`)');
    expect((await tasks.list()).tasks).toHaveLength(0);
  });

  it('checks a model against that provider’s own list', async () => {
    const { tasks, conversations, engines } = await setup();
    const other = engines.get('openrouter') as Scripted;
    other.capabilities = async () => ({
      engine: 'openrouter',
      label: 'Other',
      models: [{ id: 'big-one', label: 'Big One' }] as Capabilities['models'],
      commands: [],
      permissionModes: ['default'],
    });
    const chat = await idleChat(conversations);
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    const wrong = await delegate?.run({
      parts: [
        { title: 'A', instructions: 'a', provider: 'openrouter', model: 'gpt-9', worktree: false },
      ],
    } as never);
    expect(wrong).toMatch(/Other has no model called “gpt-9”.*big-one/);
    await delegate?.run({
      parts: [
        {
          title: 'A',
          instructions: 'a',
          provider: 'openrouter',
          model: 'Big One',
          worktree: false,
        },
      ],
    } as never);
    expect((await tasks.list()).tasks[0]?.options.model).toBe('big-one');
  });

  it('doesn’t carry the chat’s own model to another provider', async () => {
    const { tasks, conversations, engines } = await setup();
    const chat = await idleChat(conversations, { model: 'chat-model' });
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    await delegate?.run({
      parts: [
        { title: 'Mine', instructions: 'a', model: 'same', worktree: false },
        {
          title: 'Theirs',
          instructions: 'b',
          provider: 'openrouter',
          model: 'same',
          worktree: false,
        },
      ],
    } as never);
    const helpers = (await tasks.list()).tasks;
    expect(helpers.find((t) => t.title === 'Mine')?.options.model).toBe('chat-model');
    expect(helpers.find((t) => t.title === 'Theirs')?.options.model).toBeUndefined();
  });

  it('another provider’s helper is as wary as the chat, and what it read comes back', async () => {
    const { tasks, conversations, engines } = await setup();
    const chat = await idleChat(conversations);
    await conversations.addTaint(chat.id, [{ kind: 'person', label: 'Ana on Telegram' }]);
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    await delegate?.run({
      parts: [
        {
          title: 'Read',
          instructions: 'read the web',
          provider: 'openrouter',
          model: 'fast',
          worktree: false,
        },
      ],
    } as never);
    const helper = (await tasks.list()).tasks[0] as Task;
    expect(await conversations.taintOf(helper.conversationId ?? '')).toEqual(
      expect.arrayContaining([{ kind: 'person', label: 'Ana on Telegram' }]),
    );
    expect(await conversations.taintOf(chat.id)).toContainEqual({
      kind: 'web',
      label: 'evil.example',
    });
  });

  it('over the monthly budget, hands nothing to anyone', async () => {
    const { tasks, conversations, engines } = await setup({ overBudget: true });
    const chat = await idleChat(conversations);
    const delegate = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'delegate');
    expect(
      await delegate?.run({
        parts: [
          { title: 'A', instructions: 'a', provider: 'openrouter', model: 'fast', worktree: false },
        ],
      } as never),
    ).toMatch(/monthly budget/);
    expect(engines.get('openrouter')?.turns).toHaveLength(0);
  });

  it('a background task can go to another provider too', async () => {
    const { tasks, conversations, engines } = await setup();
    const chat = await idleChat(conversations);
    const background = tasks
      .tools(ctx(chat.id, engines.get('mock') as Engine))
      .find((t) => t.name === 'start_background_task');
    const said = await background?.run({
      title: 'Tidy',
      instructions: 'tidy the README',
      provider: 'openrouter',
    } as never);
    expect(said).toMatch(/in the background with Other\./);
    const task = (await tasks.list()).tasks[0] as Task;
    expect(task).toMatchObject({
      kind: 'background',
      by: 'Other',
      options: { engine: 'openrouter' },
    });
    await until(
      () => tasks.get(task.id),
      (t) => t.status === 'unverified',
    );
    expect(engines.get('openrouter')?.turns).toHaveLength(1);
  });

  it('tells the assistant who else it can hand work to', async () => {
    const { tasks, engines } = await setup();
    const section = await tasks.promptSection(engines.get('mock') as Engine);
    expect(section).toContain('## Handing work off');
    expect(section).toContain('- Other (`openrouter`)');
    expect(section).not.toContain('(`mock`)');
  });
});

describe('merged results', () => {
  it('says which parts didn’t finish', () => {
    const base = {
      kind: 'helper' as const,
      prompt: '',
      options: {},
      createdAt: 0,
      steps: [],
      rev: 0,
    };
    expect(
      merged([
        { ...base, id: '1', title: 'A', status: 'done', summary: 'Found it.' },
        { ...base, id: '2', title: 'B', status: 'failed', error: 'It broke.' },
      ]),
    ).toBe('## A\nFound it.\n\n## B\nDidn’t finish: It broke.');
  });
});

void vi;

describe('task controls in the originating chat', () => {
  it('lists only owned tasks and refuses another chat’s handles', async () => {
    const { tasks, conversations, engines } = await setup({ background: 0 });
    const chat = await conversations.send({ clientMessageId: 'owner', text: 'hello' });
    await until(
      () => conversations.detail(chat.id),
      (d) => d.conversation.status === 'idle',
    );
    const owned = await tasks.create({
      kind: 'background',
      text: 'work',
      parentConversationId: chat.id,
    });
    const other = await tasks.create({ kind: 'background', text: 'other work' });
    const context = {
      conversationId: chat.id,
      engine: engines.get('mock') as Engine,
      append: () => {},
      permissionMode: 'default' as const,
      ask: async () => 'allow' as const,
      signal: new AbortController().signal,
    };
    const tools = tasks.tools(context);
    const statusTool = tools.find((t) => t.name === 'task_status');
    const control = tools.find((t) => t.name === 'task_control');
    expect(await statusTool?.run({})).toContain(owned.id);
    expect(await statusTool?.run({})).not.toContain(other.id);
    const evidence = Array.from({ length: 75 }, (_, index) => ({
      id: `op-${index}`,
      key: `key-${index}`,
      tool: 'Read',
      effect: 'read' as const,
      state: 'confirmed' as const,
      execution: 'succeeded' as const,
      account: 'test',
      authorization: 'read',
      expiresAt: Number.MAX_SAFE_INTEGER,
      startedAt: index,
      receipt: { provider: 'test', id: String(index), label: 'Read' },
    }));
    const read = vi.spyOn(tasks, 'get');
    read.mockResolvedValueOnce({ ...owned, operations: evidence });
    const recent = JSON.parse(String(await statusTool?.run({ id: owned.id }))) as {
      operationCount: number;
      operationsOffset: number;
      operations: { id: string }[];
    }[];
    expect(recent[0]).toMatchObject({ operationCount: 75, operationsOffset: 25 });
    expect(recent[0]?.operations).toHaveLength(50);
    expect(recent[0]?.operations[0]?.id).toBe('op-25');
    read.mockResolvedValueOnce({ ...owned, operations: evidence });
    const first = JSON.parse(
      String(await statusTool?.run({ id: owned.id, operations_offset: 0 })),
    ) as { nextOperationsOffset: number; operations: { id: string }[] }[];
    expect(first[0]?.nextOperationsOffset).toBe(50);
    expect(first[0]?.operations[0]?.id).toBe('op-0');
    read.mockRestore();
    await expect(statusTool?.run({ id: other.id })).rejects.toThrow('not started in this chat');
    await expect(control?.run({ id: other.id, action: 'stop' })).rejects.toThrow(
      'not started in this chat',
    );
    await control?.run({ id: owned.id, action: 'stop' });
    expect((await tasks.get(owned.id)).status).toBe('stopped');
    const denied = tasks
      .tools({ ...context, ask: async () => 'deny' as const })
      .find((t) => t.name === 'task_control');
    expect(await denied?.run({ id: owned.id, action: 'retry' })).toContain('declined');
    expect((await tasks.get(owned.id)).status).toBe('stopped');
    const restrictedAsk = vi.fn(async () => 'deny' as const);
    const held = tasks
      .tools({
        ...context,
        permissionMode: 'bypassPermissions',
        restricted: async () => 'This skill cannot restart work.',
        ask: restrictedAsk,
      })
      .find((t) => t.name === 'task_control');
    expect(await held?.run({ id: owned.id, action: 'retry' })).toContain('declined');
    expect(restrictedAsk).toHaveBeenCalledOnce();
    await control?.run({ id: owned.id, action: 'continue', instructions: 'New instruction' });
    expect(await tasks.get(owned.id)).toMatchObject({
      status: 'queued',
      prompt: 'New instruction',
      parentConversationId: chat.id,
    });
  });
});

describe('a task has exactly its chat’s powers (ADR 0033)', () => {
  const ALL: PermissionMode[] = ['default', 'auto', 'acceptEdits', 'plan', 'bypassPermissions'];

  /** A chat someone is in, in this mode, with its first turn started. */
  const chatIn = (
    conversations: ConversationManager,
    permissionMode: PermissionMode,
    text = 'hello',
  ) =>
    conversations.send({
      clientMessageId: `u-${permissionMode}-${text}`,
      text,
      options: { permissionMode },
    });
  const idle = (conversations: ConversationManager, id: string) =>
    until(
      () => conversations.detail(id),
      (d) => d.conversation.status === 'idle',
    );
  const asked = async (conversations: ConversationManager, id?: string) =>
    (await conversations.detail(id ?? '')).events.filter((e) => e.type === 'permission.requested');

  it('never more than its chat: a mode asked for above the chat’s becomes the chat’s', () => {
    expect(noMoreThan('bypassPermissions', 'default')).toBe('default');
    expect(noMoreThan('acceptEdits', 'plan')).toBe('plan');
    expect(noMoreThan(undefined, 'acceptEdits')).toBe('acceptEdits');
    expect(noMoreThan('plan', 'bypassPermissions')).toBe('plan');
    expect(noMoreThan('default', 'acceptEdits')).toBe('default');
    // A ladder (ADR 0100): Auto lets through everything Edit freely does, and more.
    expect(noMoreThan('auto', 'acceptEdits')).toBe('acceptEdits');
    expect(noMoreThan('acceptEdits', 'auto')).toBe('acceptEdits');
    expect(noMoreThan('bypassPermissions', 'auto')).toBe('auto');
    expect(noMoreThan('auto', 'bypassPermissions')).toBe('auto');
  });

  it('a task sent with more than its chat may do runs in the chat’s mode, and asks', async () => {
    const { tasks, conversations, engines } = await setup();
    (engines.get('mock') as Scripted).modes = ALL;
    const chat = await chatIn(conversations, 'default');
    await idle(conversations, chat.id);
    const task = await tasks.create({
      kind: 'background',
      text: 'ask before testing',
      parentConversationId: chat.id,
      options: { permissionMode: 'bypassPermissions' },
    });
    expect(task.options.permissionMode).toBe('default');
    const waiting = await until(
      () => tasks.get(task.id),
      (t) => t.status === 'needs-you' && t.asking !== undefined,
    );
    // What it asks is on its card, to be answered from the chat it came from.
    expect(waiting.asking).toMatchObject({ toolName: 'Bash', here: true, command: 'npm test' });
    await conversations.respond(
      waiting.conversationId ?? '',
      waiting.asking?.permissionId ?? '',
      'allow',
    );
    const done = await until(
      () => tasks.get(task.id),
      (t) => t.status === 'unverified',
    );
    expect(done.asking).toBeUndefined();
  });

  it('Full trust in a chat you’re in is the task’s too: what the chat read doesn’t stop it', async () => {
    const { tasks, conversations, engines } = await setup();
    (engines.get('mock') as Scripted).modes = ALL;
    const chat = await chatIn(conversations, 'bypassPermissions');
    await idle(conversations, chat.id);
    await conversations.addTaint(chat.id, [{ kind: 'web', label: 'evil.example' }]);
    const task = await tasks.create({
      kind: 'background',
      text: 'ask before testing',
      parentConversationId: chat.id,
    });
    const done = await until(
      () => tasks.get(task.id),
      (t) => !['queued', 'running'].includes(t.status),
    );
    expect(done.status).toBe('unverified');
    expect(done.options.permissionMode).toBe('bypassPermissions');
    expect(await asked(conversations, done.conversationId)).toHaveLength(0);
    // It still started as wary as its chat.
    expect(await conversations.taintOf(done.conversationId ?? '')).toEqual([
      { kind: 'web', label: 'evil.example' },
    ]);
    // Said as carried, so its chat shows it as one line from the chat it came from.
    const { events } = await conversations.detail(done.conversationId ?? '');
    expect(events.filter((e) => e.type === 'taint')).toEqual([
      expect.objectContaining({ source: { kind: 'web', label: 'evil.example' }, carried: true }),
    ]);
  });

  it('a helper runs in the mode of the turn that started it', async () => {
    const { tasks, conversations, engines } = await setup();
    (engines.get('mock') as Scripted).modes = ALL;
    const chat = await chatIn(conversations, 'acceptEdits');
    await idle(conversations, chat.id);
    const delegate = tasks
      .tools({
        conversationId: chat.id,
        append: () => undefined,
        engine: engines.get('mock') as Engine,
        permissionMode: 'acceptEdits',
        ask: async () => 'deny',
        signal: new AbortController().signal,
      })
      .find((t) => t.name === 'delegate');
    await delegate?.run({
      parts: [{ title: 'Look', instructions: 'look around', model: 'same', worktree: false }],
    } as never);
    const [helper] = (await tasks.list()).tasks;
    expect(helper?.options.permissionMode).toBe('acceptEdits');
    expect(engines.get('mock')?.turns.at(-1)?.options.permissionMode).toBe('acceptEdits');
  });

  it('“Always allow” said in the chat holds in its task, and nothing more', async () => {
    const { tasks, conversations } = await setup();
    const chat = await chatIn(conversations, 'default', 'ask first');
    const question = await until(
      () => asked(conversations, chat.id),
      (found) => found.length > 0,
    );
    const first = question[0];
    if (first?.type !== 'permission.requested') throw new Error('no question');
    await conversations.respond(chat.id, first.permissionId, 'allow-always');
    await idle(conversations, chat.id);
    const task = await tasks.create({
      kind: 'background',
      text: 'ask before testing',
      parentConversationId: chat.id,
    });
    const done = await until(
      () => tasks.get(task.id),
      (t) => !['queued', 'running'].includes(t.status),
    );
    expect(done.status).toBe('unverified');
    expect(await asked(conversations, done.conversationId)).toHaveLength(0);
    // A task sent from another chat hasn't been told yes.
    const other = await chatIn(conversations, 'default', 'other');
    await idle(conversations, other.id);
    const elsewhere = await tasks.create({
      kind: 'background',
      text: 'ask before testing',
      parentConversationId: other.id,
    });
    await until(
      () => tasks.get(elsewhere.id),
      (t) => t.status === 'needs-you',
    );
    await tasks.stop(elsewhere.id);
  });

  it('follows its chat: Full trust picked there lets a waiting task carry on', async () => {
    const { tasks, conversations, engines } = await setup();
    (engines.get('mock') as Scripted).modes = ALL;
    const chat = await chatIn(conversations, 'default');
    await idle(conversations, chat.id);
    const task = await tasks.create({
      kind: 'background',
      text: 'ask before testing',
      parentConversationId: chat.id,
    });
    await until(
      () => tasks.get(task.id),
      (t) => t.status === 'needs-you',
    );
    await conversations.configure(chat.id, { permissionMode: 'bypassPermissions' });
    const done = await until(
      () => tasks.get(task.id),
      (t) => t.status === 'unverified',
    );
    expect(done.options.permissionMode).toBe('bypassPermissions');
    const resolved = (await conversations.detail(done.conversationId ?? '')).events.find(
      (e) => e.type === 'permission.resolved',
    );
    expect(resolved).toMatchObject({ decision: 'allow' });
  });

  it('gets Conch’s own tools, as its chat has them, but never hands work on itself', async () => {
    const probe = {
      name: 'probe',
      description: 'A tool of Conch’s own.',
      input: {},
      run: async () => 'ok',
    };
    const made: { tasks?: TaskService } = {};
    const { tasks, conversations, engines } = await setup({
      tools: (ctx) => [probe, ...(made.tasks?.tools(ctx) ?? [])],
    });
    made.tasks = tasks;
    const chat = await chatIn(conversations, 'default');
    await idle(conversations, chat.id);
    const inChat =
      engines
        .get('mock')
        ?.turns.at(-1)
        ?.tools.map((t) => t.name) ?? [];
    expect(inChat).toEqual(expect.arrayContaining(['probe', 'delegate', 'start_background_task']));
    const task = await tasks.create({
      kind: 'background',
      text: 'look around',
      parentConversationId: chat.id,
    });
    await until(
      () => tasks.get(task.id),
      (t) => t.status === 'unverified',
    );
    const inTask =
      engines
        .get('mock')
        ?.turns.at(-1)
        ?.tools.map((t) => t.name) ?? [];
    expect(inTask).toEqual(expect.arrayContaining(['probe', 'report_result']));
    expect(inTask).not.toContain('delegate');
    expect(inTask).not.toContain('start_background_task');
    expect(engines.get('mock')?.turns.at(-1)?.systemAppend).toMatch(
      /don’t start sub-agents or tasks of your own/,
    );
  });

  it('tells every provider to hand work off as Conch’s tasks, never its own sub-agents', () => {
    expect(TASKS_PROMPT).toMatch(/Never use a sub-agent or task tool of your own provider/);
  });
});
