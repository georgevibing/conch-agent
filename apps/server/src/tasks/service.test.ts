import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, EngineId, EngineStatus, ServerEvent, Task } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { ConversationManager } from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { merged, TaskService } from './service';
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
      permissionModes: ['default'],
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
    if (/ask/.test(said)) {
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
    const report = input.tools.find((t) => t.name === 'report_result');
    await report?.run({ summary: `${this.label} did: ${said.slice(0, 40)}` } as never);
    yield { type: 'text', messageId: 'm', delta: 'All done.' };
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup(
  options: { background?: number; helpers?: number; overBudget?: boolean } = {},
) {
  const home = mkdtempSync(join(tmpdir(), 'conch-tasks-'));
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
      background: options.background,
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
      (t) => t.status === 'done',
    );
    expect(done.summary).toBe('Scripted did: tidy the README');
    expect(done.conversationId).toBeDefined();
    const { conversation } = await conversations.detail(done.conversationId ?? '');
    expect(conversation.origin).toEqual({ kind: 'task', taskId: task.id });
    const cards = (await conversations.detail(chat.id)).events.filter((e) => e.type === 'task');
    expect(cards.map((e) => (e.type === 'task' ? e.state : ''))).toEqual([
      'queued',
      'running',
      'done',
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
      (s) => s === 'done',
    );
    expect(await status(tasks, first.id)).toBe('done');
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
      (s) => s === 'done',
    );
    const conversationId = (await tasks.get(asking.id)).conversationId ?? '';
    const request = (await conversations.detail(conversationId)).events.find(
      (e) => e.type === 'permission.requested',
    );
    if (request?.type !== 'permission.requested') throw new Error('no question');
    await conversations.respond(conversationId, request.permissionId, 'allow');
    const done = await until(
      () => tasks.get(asking.id),
      (t) => t.status === 'done',
    );
    expect(done.steps.map((s) => s.label)).toContain('Ran `npm test`');
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

  it('at a provider’s limit, carries on with your fallback provider, and says so', async () => {
    const { tasks, settings } = await setup();
    await settings.update({ preferences: { limitFallback: 'openrouter' } });
    const task = await tasks.create({ kind: 'background', text: 'hit the limit' });
    const done = await until(
      () => tasks.get(task.id),
      (t) => t.status === 'done' || t.status === 'failed',
    );
    expect(done).toMatchObject({
      status: 'done',
      summary: 'Other did: hit the limit',
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
    expect(out).toBe('## Check A\nScripted did: look at A\n\n## Check B\nScripted did: look at B');
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
