/**
 * Hand it off (ADR 0033): work that runs in the background.
 *
 * - **Background tasks** — "Do it in the background": you send a message
 *   away and carry on. It runs as its own conversation (you can open it,
 *   approve things in it, stop it), a few at a time, the rest waiting their
 *   turn. When it's done its result comes back to the chat it came from, and
 *   you're told (in Conch, and on your devices, ADR 0027).
 * - **Helpers** — the assistant splits a job (`delegate`): up to six parts run
 *   side by side, each in its own conversation (on a cheaper model unless the
 *   part needs the same one), each visible as a card in the chat, and their
 *   results come back together.
 *
 * Everything a task does is held to what the chat it came from could do:
 * the same provider and permission mode, as wary as it was (ADR 0028), and
 * stopped with it. A task that was running when Conch stopped says so and
 * runs again with one press; one that reached its provider's limit carries on
 * with your fallback provider (ADR 0023).
 */
import type {
  ConversationEvent,
  EngineId,
  ServerEvent,
  Task,
  TaskKind,
  TaskList,
  TaskStatus,
  TurnOptions,
} from '@conch/protocol';
import { z } from 'zod';

import { didWhat } from '../activity/service';
import type { ConversationManager, ToolContext } from '../conversations/manager';
import { summarizeToolUse } from '../conversations/summarize';
import type { Engine, HostTool } from '../engines/types';
import { newId } from '../lib/ids';
import type { SettingsStore } from '../settings/store';
import type { TaskStore } from './store';
import { createWorktree, finishWorktree, type Git, type Worktree } from './worktree';

/** Background tasks at once; the rest queue. */
export const BACKGROUND_AT_ONCE = 3;
/** Helpers at once, across every chat. */
export const HELPERS_AT_ONCE = 4;
/** Parts one `delegate` can start. */
export const MAX_PARTS = 6;
const STEPS_KEPT = 12;

const RUNNING: readonly TaskStatus[] = ['running', 'needs-you'];
const FINISHED: readonly TaskStatus[] = ['done', 'failed', 'stopped', 'interrupted'];

export class TaskError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid' | 'busy',
    message: string,
  ) {
    super(message);
  }
}

/** "Run `npm test`" → "Running `npm test`": what it's doing right now. */
export function doingWhat(name: string, input: Record<string, unknown>): string {
  return summarizeToolUse(name, input)
    .replace(/^Run /, 'Running ')
    .replace(/^Create /, 'Creating ')
    .replace(/^Edit /, 'Changing ')
    .replace(/^Read /, 'Reading ')
    .replace(/^Open /, 'Opening ')
    .replace(/^Search the web for /, 'Searching the web for ')
    .replace(/^Use /, 'Using ');
}

const tidy = (text: string, max: number) => {
  const flat = text.replace(/\n{3,}/g, '\n\n').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

const titleOf = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= 60 ? line : `${line.slice(0, 57).trimEnd()}…`;
};

export interface TaskDeps {
  store: TaskStore;
  conversations: ConversationManager;
  engine: (id?: EngineId) => Engine;
  settings: SettingsStore;
  emit: (event: ServerEvent) => void;
  home: string;
  /** Over the monthly budget you set (ADR 0005): helpers don't multiply the spend. */
  overBudget?: () => Promise<boolean>;
  git?: Git;
  now?: () => number;
  background?: number;
  helpers?: number;
}

export class TaskService {
  /** conversationId → taskId, for following each task's own chat. */
  readonly #byConversation = new Map<string, string>();
  readonly #stopping = new Set<string>();
  readonly #worktrees = new Map<string, Worktree>();
  readonly #waiters = new Map<string, Set<(task: Task) => void>>();
  #pumping = Promise.resolve();

  constructor(private readonly deps: TaskDeps) {}

  get #now() {
    return (this.deps.now ?? Date.now)();
  }

  /**
   * On start: what was running when Conch stopped says so (one press runs it
   * again); what was waiting its turn carries on.
   */
  async start(): Promise<void> {
    for (const task of await this.deps.store.list()) {
      if (task.conversationId) this.#byConversation.set(task.conversationId, task.id);
      if (RUNNING.includes(task.status))
        await this.#save({
          ...task,
          status: 'interrupted',
          current: undefined,
          finishedAt: this.#now,
          error: 'Conch stopped while this was running.',
        });
    }
    this.#pump();
  }

  async list(): Promise<TaskList> {
    const tasks = [...(await this.deps.store.list())].sort((a, b) => b.createdAt - a.createdAt);
    return { tasks, concurrent: this.deps.background ?? BACKGROUND_AT_ONCE };
  }

  async get(id: string): Promise<Task> {
    const task = await this.deps.store.get(id);
    if (!task) throw new TaskError('not-found', 'That task isn’t there any more.');
    return task;
  }

  /** Something is running or waiting its turn (updates and backups wait for quiet). */
  async busy(): Promise<boolean> {
    return (await this.deps.store.list()).some(
      (t) => t.status === 'queued' || RUNNING.includes(t.status),
    );
  }

  /** Send work away. It starts as soon as there's room. */
  async create(input: {
    kind: TaskKind;
    text: string;
    title?: string;
    parentConversationId?: string;
    options?: TurnOptions;
    group?: string;
    /** A helper's own git worktree (code tasks). */
    worktree?: boolean;
  }): Promise<Task> {
    const text = input.text.trim();
    if (!text) throw new TaskError('invalid', 'Say what the task is.');
    const options = await this.#optionsFor(input.parentConversationId, input.options);
    const task: Task = {
      id: newId('task'),
      kind: input.kind,
      title: (input.title?.trim() || titleOf(text)).slice(0, 120),
      prompt: text,
      status: 'queued',
      options,
      createdAt: this.#now,
      steps: [],
      rev: 0,
      ...(input.parentConversationId && { parentConversationId: input.parentConversationId }),
      ...(input.group && { group: input.group }),
    };
    if (input.worktree) {
      const workspace = await this.deps.settings.workspace();
      const wt = await createWorktree(workspace, this.deps.home, task.id, this.deps.git).catch(
        () => undefined,
      );
      if (wt) {
        this.#worktrees.set(task.id, wt);
        task.worktree = { path: wt.path, branch: wt.branch, changed: false };
      }
    }
    await this.#save(task);
    await this.#tell(task);
    this.#pump();
    return task;
  }

  /** The chat's own provider and mode, unless asked for something else. */
  async #optionsFor(parent: string | undefined, given?: TurnOptions): Promise<TurnOptions> {
    const { preferences } = await this.deps.settings.get();
    const chat = parent
      ? await this.deps.conversations.detail(parent).catch(() => undefined)
      : undefined;
    const inherited = chat?.conversation.options ?? {};
    return {
      ...(preferences.permissionMode && { permissionMode: preferences.permissionMode }),
      ...inherited,
      ...given,
    };
  }

  async stop(id: string): Promise<Task> {
    const task = await this.get(id);
    if (task.status === 'queued')
      return this.#finish(task, { status: 'stopped', error: undefined });
    if (!RUNNING.includes(task.status)) return task;
    this.#stopping.add(id);
    if (task.conversationId) await this.deps.conversations.interrupt(task.conversationId);
    return this.get(id);
  }

  /** Run a task that didn't finish again, from the start, in a new chat. */
  async retry(id: string): Promise<Task> {
    const task = await this.get(id);
    if (!FINISHED.includes(task.status) || task.status === 'done')
      throw new TaskError('busy', 'This task is still going.');
    const again = await this.#save({
      ...task,
      status: 'queued',
      conversationId: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      summary: undefined,
      error: undefined,
      note: undefined,
      current: undefined,
      steps: [],
    });
    this.#pump();
    return again;
  }

  async remove(id: string): Promise<void> {
    const task = await this.get(id);
    if (!FINISHED.includes(task.status) && task.status !== 'done' && task.status !== 'queued')
      throw new TaskError('busy', 'Stop it first, then remove it.');
    await this.deps.store.remove(id);
    this.deps.emit({ type: 'task.deleted', taskId: id });
  }

  /** Resolves once every one of `ids` has finished (or `signal` stops them all). */
  async waitFor(ids: string[], signal?: AbortSignal): Promise<Task[]> {
    const one = (id: string) =>
      new Promise<Task>((resolve) => {
        void this.deps.store.get(id).then((now) => {
          if (now && (FINISHED.includes(now.status) || now.status === 'done')) return resolve(now);
          const set = this.#waiters.get(id) ?? new Set();
          set.add(resolve);
          this.#waiters.set(id, set);
        });
      });
    const onAbort = () => void Promise.all(ids.map((id) => this.stop(id).catch(() => undefined)));
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await Promise.all(ids.map(one));
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  // ── Running ─────────────────────────────────────────────────────────────

  /** Start whatever has room, oldest first. One pass at a time. */
  #pump(): void {
    this.#pumping = this.#pumping.then(
      async () => {
        const tasks = await this.deps.store.list();
        for (const kind of ['background', 'helper'] as const) {
          const limit =
            kind === 'background'
              ? (this.deps.background ?? BACKGROUND_AT_ONCE)
              : (this.deps.helpers ?? HELPERS_AT_ONCE);
          let room =
            limit - tasks.filter((t) => t.kind === kind && RUNNING.includes(t.status)).length;
          for (const task of tasks
            .filter((t) => t.kind === kind && t.status === 'queued')
            .sort((a, b) => a.createdAt - b.createdAt)) {
            if (room-- <= 0) break;
            // Marked running before the next look, so one pass never starts it twice.
            await this.#save({ ...task, status: 'running', startedAt: this.#now });
            void this.#run(task.id).catch(() => undefined);
          }
        }
      },
      () => undefined,
    );
  }

  async #run(id: string, fallback?: { engine: EngineId; from: string }): Promise<void> {
    let task = await this.get(id);
    const options = fallback ? { ...task.options, engine: fallback.engine } : task.options;
    const engine = this.deps.engine(options.engine);
    const ready = await engine.detect().catch(() => undefined);
    if (ready?.state !== 'ready') {
      await this.#finish(task, {
        status: 'failed',
        error:
          ready?.state === 'signed-out'
            ? `${engine.label} is signed out. Sign in, then try again.`
            : `${engine.label} isn’t available right now. Try again in a moment.`,
      });
      return;
    }
    let reported: string | undefined;
    const finishTool: HostTool<{ summary: z.ZodString }> = {
      name: 'report_result',
      description:
        'Call once at the end with the result, for the user to read: what you found or did, in a few short lines (no preamble). It goes back to the chat this task came from.',
      input: { summary: z.string().min(1).max(4_000) },
      async run(args) {
        reported = args.summary;
        return 'Recorded.';
      },
    };
    const taint = task.parentConversationId
      ? await this.deps.conversations.taintOf(task.parentConversationId).catch(() => [])
      : [];
    const wt = this.#worktrees.get(task.id);
    try {
      const { conversationId, result } = await this.deps.conversations.start({
        title: task.title,
        text: task.prompt,
        options,
        origin: { kind: 'task', taskId: task.id },
        extras: {
          systemExtra: brief(task),
          tools: [finishTool as HostTool],
          taint,
          ...(wt && { cwd: wt.path }),
          onStatus: (s) => {
            if (s === 'awaiting-permission') void this.#update(task.id, { status: 'needs-you' });
            if (s === 'running') void this.#update(task.id, { status: 'running' });
          },
        },
      });
      this.#byConversation.set(conversationId, task.id);
      task = await this.#update(task.id, {
        conversationId,
        ...(fallback && {
          note: `${fallback.from} reached its limit, so ${engine.label} carried on.`,
        }),
      });
      await this.#tell(task);
      // Stopped while it was starting: it stops now.
      if (this.#stopping.has(id)) await this.deps.conversations.interrupt(conversationId);
      const turn = await result;
      // A limit another provider can answer (ADR 0023): carry on with it, once.
      if (turn.outcome === 'error' && turn.problem === 'limit' && !fallback) {
        const { preferences } = await this.deps.settings.get();
        const next = preferences.limitFallback;
        if (next && next !== engine.id) return this.#run(id, { engine: next, from: engine.label });
      }
      const stopped = this.#stopping.delete(id);
      await this.#finish(
        await this.get(id),
        turn.outcome === 'success'
          ? { status: 'done', summary: tidy(reported ?? turn.finalText ?? 'Done.', 4_000) }
          : turn.outcome === 'interrupted'
            ? {
                status: stopped ? 'stopped' : 'interrupted',
                error: stopped ? undefined : 'It stopped before it finished.',
              }
            : { status: 'failed', error: tidy(turn.error ?? 'Something went wrong.', 1_000) },
      );
    } catch (error) {
      await this.#finish(await this.get(id), {
        status: 'failed',
        error: tidy((error as Error).message || 'Something went wrong.', 1_000),
      });
    }
  }

  async #finish(task: Task, patch: Partial<Task>): Promise<Task> {
    let worktree = task.worktree;
    const wt = this.#worktrees.get(task.id);
    if (wt) {
      const { changed } = await finishWorktree(wt, this.deps.git).catch(() => ({ changed: true }));
      this.#worktrees.delete(task.id);
      worktree = { path: wt.path, branch: wt.branch, changed };
    }
    const done = await this.#mutate(task.id, () => ({
      ...patch,
      current: undefined,
      finishedAt: this.#now,
      ...(worktree && { worktree }),
    }));
    if (!patch.status || patch.status === task.status) await this.#tell(done);
    for (const resolve of this.#waiters.get(task.id) ?? []) resolve(done);
    this.#waiters.delete(task.id);
    // What a task read, its chat now knows too: its result came from there (ADR 0028).
    if (done.parentConversationId && done.conversationId) {
      const read = await this.deps.conversations.taintOf(done.conversationId).catch(() => []);
      if (read.length)
        await this.deps.conversations
          .addTaint(done.parentConversationId, read)
          .catch(() => undefined);
    }
    this.#pump();
    return done;
  }

  /** Say where it stands in the chat it came from (a card that updates). */
  async #tell(task: Task): Promise<void> {
    if (!task.parentConversationId) return;
    await this.deps.conversations
      .note(task.parentConversationId, {
        type: 'task',
        taskId: task.id,
        title: task.title,
        kind: task.kind,
        state: task.status,
        ...(task.summary && { summary: tidy(task.summary, 600) }),
      })
      .catch(() => undefined);
  }

  /**
   * Change one task, one change at a time: its chat's events, its status and
   * its end arrive together, and none may undo another.
   */
  #mutate(id: string, change: (task: Task) => Partial<Task> | undefined): Promise<Task> {
    const before = this.#locks.get(id) ?? Promise.resolve();
    const next = before.then(async () => {
      const task = await this.get(id);
      const patch = change(task);
      if (!patch) return task;
      const saved = await this.#save({ ...task, ...patch });
      // Waiting for your OK, and back to work: the card in the chat says so.
      if (patch.status && patch.status !== task.status) await this.#tell(saved);
      return saved;
    });
    this.#locks.set(
      id,
      next.catch(() => undefined),
    );
    return next;
  }

  #update(id: string, patch: Partial<Task>): Promise<Task> {
    return this.#mutate(id, (task) =>
      // A finished task stays finished: a late event can't bring it back.
      task.finishedAt !== undefined && FINISHED.concat('done').includes(task.status) && patch.status
        ? undefined
        : patch,
    );
  }

  readonly #locks = new Map<string, Promise<unknown>>();

  async #save(task: Task): Promise<Task> {
    const saved = await this.deps.store.save({ ...task, rev: task.rev + 1 });
    this.deps.emit({ type: 'task.changed', task: saved });
    return saved;
  }

  /** Each task's own chat, followed: what it's doing, what it did. */
  onEvent(event: ServerEvent): void {
    if (event.type !== 'conversation.event') return;
    const e: ConversationEvent = event.event;
    const id = this.#byConversation.get(e.conversationId);
    if (!id) return;
    if (e.type === 'tool.started') {
      const input = (e.input && typeof e.input === 'object' ? e.input : {}) as Record<
        string,
        unknown
      >;
      void this.#update(id, { current: tidy(doingWhat(e.name, input), 240) }).catch(
        () => undefined,
      );
      this.#calls.set(`${e.conversationId}:${e.toolUseId}`, { name: e.name, input });
    }
    if (e.type === 'tool.finished') {
      const call = this.#calls.get(`${e.conversationId}:${e.toolUseId}`);
      this.#calls.delete(`${e.conversationId}:${e.toolUseId}`);
      if (!call) return;
      void this.get(id)
        .then((task) =>
          this.#update(id, {
            current: undefined,
            steps: [
              ...task.steps,
              {
                at: e.at,
                label: tidy(
                  `${didWhat(call.name, call.input)}${e.status === 'success' ? '' : ' (didn’t work)'}`,
                  240,
                ),
              },
            ].slice(-STEPS_KEPT),
          }),
        )
        .catch(() => undefined);
    }
  }

  readonly #calls = new Map<string, { name: string; input: Record<string, unknown> }>();

  // ── Tools for the assistant ─────────────────────────────────────────────

  /** `delegate` and `start_background_task`, in chats you're in (never inside a task). */
  tools(ctx: ToolContext): HostTool[] {
    const delegate: HostTool<{
      parts: z.ZodArray<
        z.ZodObject<{
          title: z.ZodString;
          instructions: z.ZodString;
          model: z.ZodDefault<z.ZodEnum<{ fast: 'fast'; same: 'same' }>>;
          worktree: z.ZodDefault<z.ZodBoolean>;
        }>
      >;
    }> = {
      name: 'delegate',
      description: `Do up to ${MAX_PARTS} independent parts of a job at the same time, each by a helper in its own conversation, and get all their results back together. Use it when the work splits cleanly (look into several things, check several files, draft alternatives) and each part can be done without the others. Each helper starts fresh: make every instruction complete on its own. Helpers can't ask the user anything. \`model: "fast"\` (the default) uses a quicker, cheaper model; use "same" for parts that need your full ability. \`worktree: true\` gives a code-changing part its own copy of the repository on its own branch.`,
      input: {
        parts: z
          .array(
            z.object({
              title: z.string().min(1).max(80),
              instructions: z.string().min(1).max(8_000),
              model: z.enum(['fast', 'same']).default('fast'),
              worktree: z.boolean().default(false),
            }),
          )
          .min(1)
          .max(MAX_PARTS),
      },
      searchHint: 'parallel helpers subagents split work in parallel',
      run: async (args) => {
        if (await this.deps.overBudget?.().catch(() => false))
          return 'The user has spent their monthly budget, so don’t start helpers (they’d multiply the cost). Do the work yourself, one part at a time.';
        const group = newId('grp');
        const small = ctx.engine.smallModel;
        const tasks = [];
        for (const part of args.parts)
          tasks.push(
            await this.create({
              kind: 'helper',
              text: part.instructions,
              title: part.title,
              parentConversationId: ctx.conversationId,
              group,
              worktree: part.worktree,
              options: {
                engine: ctx.engine.id,
                permissionMode: ctx.permissionMode,
                ...(part.model === 'fast' && small && { model: small }),
              },
            }),
          );
        const done = await this.waitFor(
          tasks.map((t) => t.id),
          ctx.signal,
        );
        return merged(done);
      },
    };
    const background: HostTool<{ title: z.ZodString; instructions: z.ZodString }> = {
      name: 'start_background_task',
      description:
        'Start a longer job in the background, when the user asked you to or agreed to it ("do it in the background", "let me know when it’s done"). It runs in its own conversation; its result comes back to this chat and the user is notified. Make the instructions complete on their own. Then tell the user it’s started and they can carry on.',
      input: { title: z.string().min(1).max(80), instructions: z.string().min(1).max(8_000) },
      searchHint: 'background task later notify when done',
      run: async (args) => {
        const task = await this.create({
          kind: 'background',
          text: args.instructions,
          title: args.title,
          parentConversationId: ctx.conversationId,
          options: { engine: ctx.engine.id, permissionMode: ctx.permissionMode },
        });
        return `Started “${task.title}” in the background. Its result will come back to this chat, and the user will be told when it’s done.`;
      },
    };
    return [delegate as HostTool, background as HostTool];
  }
}

/** What every chat knows about handing work off (only chats you're in have these tools). */
export const TASKS_PROMPT = [
  '## Handing work off',
  '- When a job splits into independent parts (look into several things, check several files, draft alternatives), use `delegate` to run them side by side instead of one after another. Keep each part’s instructions complete on their own.',
  '- When the user wants something done in the background, or agrees to it for a long job, use `start_background_task`; its result comes back to this chat.',
].join('\n');

/** What a task is told about its situation. */
function brief(task: Task): string {
  return [
    task.kind === 'helper'
      ? 'You are a helper working on one part of a bigger job, in the background. Nobody is watching this conversation, and you can’t ask the user anything: do the part as well as you can with what you have.'
      : 'You are working on a task the user sent to the background. They aren’t watching this conversation; they’ll read your result later.',
    'When you’re done, call report_result once with the result in a few short lines: what you found or did, and anything the user must know.',
  ].join(' ');
}

/** The helpers' results, together, for the assistant that asked. */
export function merged(tasks: Task[]): string {
  return tasks
    .map((t) => {
      const head = `## ${t.title}`;
      const branch = t.worktree?.changed
        ? `\n(Changes are on branch \`${t.worktree.branch}\` in ${t.worktree.path}.)`
        : '';
      if (t.status === 'done') return `${head}\n${t.summary ?? 'Done.'}${branch}`;
      if (t.status === 'stopped') return `${head}\nStopped before it finished.`;
      return `${head}\nDidn’t finish: ${t.error ?? 'something went wrong.'}`;
    })
    .join('\n\n');
}
