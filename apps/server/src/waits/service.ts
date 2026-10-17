/**
 * Waiting for something until it changes (ADR 0125). `wait_for` is a tool
 * every provider gets: the assistant names what it waits for (a command of
 * this chat, CI on GitHub, a page, a time) and Conch watches it by itself, at
 * a pace that slows while nothing changes. No model is called while it waits.
 *
 * - **In a chat someone is in**, a wait for CI, a page or a time lets go of
 *   the turn: the tool answers at once, the assistant says what it waits for
 *   and ends its turn, and the chat is free. When the wait ends (or its
 *   deadline comes), Conch starts the assistant's next turn in that chat with
 *   what changed. It survives a restart.
 * - **A command, or a run nobody watches** (a task, a routine, a chat app),
 *   holds the turn instead: the tool call stays open, sleeping, and returns
 *   what changed. A managed command stops with its turn, so it can't be let go.
 *
 * Either way the chat shows one waiting row, kept current (`wait` events),
 * with Check now and Stop waiting.
 */
import { join } from 'node:path';

import {
  waitHeadline,
  type ConversationSummary,
  type TaintSource,
  type WaitNote,
  type WaitState,
} from '@conch/protocol';
import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { DoctorCheck } from '../doctor/service';
import type { HostTool } from '../engines/types';
import type { AppFetcher } from '../conchapps/types';
import { Mutex, readJson, writeJson } from '../lib/fs';
import { newId } from '../lib/ids';
import type { ProcessPeek } from '../processes/service';

import { isRepo, readCiUrl, repoOfRemote, type CiTarget, type GitHubClient } from './github';
import { nextGap, span } from './pace';
import { isYours, offersTogether } from '../together/service';
import {
  chatWatcher,
  ciWatcher,
  processWatcher,
  taskWatcher,
  timeWatcher,
  urlWatcher,
  type ChatLook,
  type Reading,
  type TaskLook,
  type Watcher,
} from './watchers';

/** What a wait that outlives its turn is, saved so a restart picks it up again. */
const WaitSpec = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ci'),
    target: z.object({
      repo: z.string(),
      run: z.number().int().optional(),
      sha: z.string().optional(),
      label: z.string(),
    }),
    failFast: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('url'), url: z.string().url(), contains: z.string().optional() }),
  z.object({ kind: z.literal('time'), at: z.number() }),
  // Another of your chats, a task this chat started (ADR 0134).
  z.object({ kind: z.literal('chat'), chat: z.string(), title: z.string() }),
  z.object({ kind: z.literal('task'), task: z.string(), title: z.string() }),
]);
type WaitSpec = z.infer<typeof WaitSpec>;

const Notification = z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(160) });
type Notification = z.infer<typeof Notification>;

const Saved = z.object({
  waitId: z.string(),
  conversationId: z.string(),
  spec: WaitSpec,
  startedAt: z.number(),
  deadline: z.number(),
  tell: z.boolean().optional(),
  notification: Notification.optional(),
});
type Saved = z.infer<typeof Saved>;
const SavedFile = z.object({ waits: z.array(Saved).default([]) });

/** How many waits one chat, and all of Conch, may have going at once. */
export const WAIT_LIMITS = { perChat: 4, total: 32 } as const;
/** A time this close is waited for inside the turn. */
export const HOLD_TIME_MS = 2 * 60_000;
/** Check now, at most this often. */
const POKE_MS = 5_000;
/** Between looks at a command that prints all the time. */
const LIVE_MIN_MS = 250;

/** The default and the longest wait, by kind, in minutes. */
const DEADLINE: Record<WaitNote['kind'], { default: number; max: number }> = {
  process: { default: 30, max: 30 },
  ci: { default: 60, max: 360 },
  url: { default: 60, max: 1440 },
  time: { default: 1, max: 1440 },
  chat: { default: 60, max: 1440 },
  task: { default: 120, max: 1440 },
};

export interface WaitServiceDeps {
  home: string;
  processes: {
    peek(owner: string, id: string): ProcessPeek | undefined;
    onChange(id: string, listener: () => void): () => void;
  };
  fetcher: AppFetcher;
  /** The best way to read GitHub right now: `gh`, the connected app's token, or nobody's. */
  github: (owner: string) => Promise<GitHubClient>;
  /** `git` in a work folder: what it printed. */
  git?: (cwd: string, args: readonly string[]) => Promise<string>;
  chat: {
    note(id: string, event: { type: 'wait'; wait: WaitNote }): Promise<void>;
    /** Start the assistant's next turn in this chat with these words, now or once it's free. */
    wake(id: string, prompt: string): Promise<unknown>;
    taint?(id: string, sources: readonly TaintSource[]): Promise<void>;
  };
  /**
   * Your other chats and this chat's tasks (ADR 0134): where one is, and a
   * call back when it may have changed. Without it, neither can be waited for.
   */
  others?: {
    chat(conversationId: string): Promise<
      | (ChatLook & {
          origin?: ConversationSummary['origin'];
          taint: readonly TaintSource[];
        })
      | undefined
    >;
    task(taskId: string): Promise<(TaskLook & { parentConversationId?: string }) | undefined>;
    /** Calls back when that chat or task may have changed; returns how to stop. */
    onChange(id: string, listener: () => void): () => void;
  };
  /** Resolve the one app explicitly requested; refuse missing or ambiguous choices. */
  notificationTarget?: (app: string) => Promise<Notification>;
  /** Send to that pinned destination only, never the routine broadcast list. */
  tell?: (told: {
    title: string;
    body: string;
    conversationId: string;
    waitId: string;
    notification: Notification;
  }) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

interface Active {
  waitId: string;
  conversationId: string;
  watcher: Watcher;
  note: WaitNote;
  abort: AbortController;
  /** Why it stopped, when it was stopped. */
  stopped?: string;
  /** Ends the current sleep at once: Check now, a nudge, Stop. */
  poke?: () => void;
  lastPoke: number;
  /** Saved for a restart: only a wait that let go of its turn. */
  saved?: Saved;
  notification?: Notification;
  notificationError?: string;
  /** When it ends: what the assistant reads, and whose words it brings in. */
  ended: Promise<Ended>;
  checks: number;
}

export class WaitService {
  readonly #active = new Map<string, Active>();
  readonly #mutex = new Mutex();
  #closed = false;

  constructor(private readonly deps: WaitServiceDeps) {}

  get #now() {
    return (this.deps.now ?? Date.now)();
  }

  get #path() {
    return join(this.deps.home, 'waits.json');
  }

  /** Every wait still going in one chat (or all), as its row shows it. */
  list(conversationId?: string): WaitNote[] {
    return [...this.#active.values()]
      .filter((a) => !conversationId || a.conversationId === conversationId)
      .map((a) => a.note);
  }

  /** Picks up the waits that outlived their turn, after a restart. */
  async start(): Promise<number> {
    const file = SavedFile.safeParse((await readJson<unknown>(this.#path)) ?? { waits: [] });
    const saved = file.success ? file.data.waits : [];
    let resumed = 0;
    for (const s of saved) {
      if (this.#active.has(s.waitId)) continue;
      try {
        const watcher = await this.#rebuild(s);
        this.#begin({
          watcher,
          conversationId: s.conversationId,
          deadline: s.deadline,
          startedAt: s.startedAt,
          waitId: s.waitId,
          ...(s.notification && { tell: true, notification: s.notification }),
          saved: s,
        });
        resumed += 1;
      } catch {
        // A wait that can't be rebuilt (GitHub gone, say) is dropped; its row says so.
        void this.deps.chat
          .note(s.conversationId, {
            type: 'wait',
            wait: {
              waitId: s.waitId,
              kind: s.spec.kind,
              title:
                s.spec.kind === 'time'
                  ? 'the time'
                  : s.spec.kind === 'ci'
                    ? `CI ${s.spec.target.label}`
                    : s.spec.kind === 'chat' || s.spec.kind === 'task'
                      ? `“${s.spec.title.slice(0, 80)}”`
                      : 'the page',
              state: 'failed',
              status: 'Couldn’t pick this up again after Conch restarted',
              startedAt: s.startedAt,
              deadline: s.deadline,
              endedAt: this.#now,
            },
          })
          .catch(() => undefined);
      }
    }
    await this.#save();
    return resumed;
  }

  close() {
    this.#closed = true;
    for (const a of this.#active.values()) {
      // Saved waits carry on after the restart: stop the look, keep the record.
      a.stopped = 'closing';
      a.abort.abort();
    }
  }

  /** Check now: look at once, and soon again after. */
  check(conversationId: string, waitId: string): boolean {
    const a = this.#active.get(waitId);
    if (!a || a.conversationId !== conversationId) return false;
    if (this.#now - a.lastPoke < POKE_MS) return true;
    a.lastPoke = this.#now;
    a.poke?.();
    return true;
  }

  /** Stop waiting: the row ends, and the assistant hears it was stopped (if it's still waiting). */
  stop(conversationId: string, waitId: string, why = 'you'): boolean {
    const a = this.#active.get(waitId);
    if (!a || a.conversationId !== conversationId) return false;
    a.stopped = why;
    a.abort.abort();
    a.poke?.();
    return true;
  }

  /** A chat that's gone takes its waits with it. */
  forget(conversationId: string) {
    for (const a of this.#active.values())
      if (a.conversationId === conversationId) this.stop(conversationId, a.waitId, 'gone');
  }

  doctorCheck(exists: (conversationId: string) => Promise<boolean>): DoctorCheck {
    return {
      id: 'waits',
      group: 'Tasks',
      title: 'Waiting for things',
      run: async ({ repair }) => {
        const orphans: Active[] = [];
        for (const a of this.#active.values())
          if (!(await exists(a.conversationId).catch(() => true))) orphans.push(a);
        if (repair) for (const a of orphans) this.stop(a.conversationId, a.waitId, 'gone');
        const going = this.#active.size - (repair ? orphans.length : 0);
        return [
          {
            id: 'waits',
            group: 'Tasks',
            title: 'Waiting for things',
            state: orphans.length ? (repair ? 'fixed' : 'warning') : 'ok',
            ...(orphans.length && !repair && { repairable: true }),
            message: orphans.length
              ? repair
                ? 'Stopped waits whose chats are gone.'
                : 'Some waits belong to chats that are gone. Repair stops them.'
              : going
                ? `Watching ${going} ${going === 1 ? 'thing' : 'things'} without calling a model.`
                : 'Nothing to wait for.',
          },
        ];
      },
    };
  }

  tools(ctx: ToolContext): HostTool[] {
    return [
      {
        name: 'wait_for',
        effect: 'read',
        alwaysLoad: true,
        searchHint:
          'wait until ci passes finishes monitor watch poll sleep later remind other chat task done',
        description: [
          'Wait for something until it changes, without polling: Conch watches it itself and calls you back with what changed. Use this instead of `sleep`, `gh run watch`, or checking a command again and again.',
          'Kinds:',
          '- `ci`: GitHub checks for a commit, a pull request or a run. Give `url` (a run or pull request on github.com), or `ref` (a PR number like 482, a branch or a commit) and `repo` (owner/name); with neither, the commit checked out in the work folder and its `origin`. `fail_fast` wakes at the first failure.',
          '- `process`: a command you started with process_start (`process_id`): until it exits, or prints a line matching `pattern` (a regular expression, e.g. "ready|listening").',
          '- `url`: a public web page, until it changes, or until it `contains` some text.',
          '- `time`: until `minutes` from now, or `until` (an ISO time).',
          '- `chat`: another of the person’s chats (`chat`, an id from list_chats), until it stops working: its reply ends, or it needs the person. You hear how it ended and the end of its last reply.',
          '- `task`: a task started in this chat (`task_id`, from start_background_task or task_status), until it finishes. You hear its result.',
          'In a chat with the person, a wait for ci, url, chat, task or a time more than two minutes away returns at once: say in one short line what you are waiting for, then end your turn. The chat stays free, and your next turn starts by itself with the outcome. Otherwise the call returns when it changes. `timeout_minutes` is how long to wait at most. Results return to this chat by default, including "let me know when CI is green". Only when the person explicitly requests an external notification, set `tell_me: true` and `notify_app` to that one app. If they want an external notification but have not chosen an app, ask which one. Never select every connected channel.',
        ].join('\n'),
        input: {
          kind: z.enum(['ci', 'process', 'url', 'time', 'chat', 'task']),
          url: z.string().max(2000).optional(),
          repo: z.string().max(201).optional(),
          ref: z.string().max(200).optional(),
          fail_fast: z.boolean().default(false),
          process_id: z.string().uuid().optional(),
          pattern: z.string().min(1).max(200).optional(),
          contains: z.string().min(1).max(200).optional(),
          minutes: z.number().min(0).max(1440).optional(),
          until: z.string().max(40).optional(),
          chat: z.string().min(1).max(128).optional(),
          task_id: z.string().min(1).max(128).optional(),
          timeout_minutes: z.number().min(1).max(1440).optional(),
          tell_me: z.boolean().default(false),
          notify_app: z.string().trim().min(1).max(160).optional(),
        },
        aliases: {
          process_id: ['id', 'processId'],
          timeout_minutes: ['timeout'],
          ref: ['pr', 'branch', 'sha'],
          chat: ['chat_id', 'conversation', 'conversation_id'],
          task_id: ['task', 'taskId'],
        },
        run: async (args) => this.#waitFor(ctx, args as unknown as WaitArgs),
      },
    ];
  }

  // ── The tool ───────────────────────────────────────────────────────────────

  async #waitFor(ctx: ToolContext, args: WaitArgs): Promise<string> {
    if (this.#closed) throw new Error('Conch is closing. Wait again after it returns.');
    const mine = [...this.#active.values()].filter((a) => a.conversationId === ctx.conversationId);
    const built = await this.#build(ctx, args);
    // The same thing: the same chat or task by its id, else the same words for it.
    const target = (spec?: WaitSpec) =>
      spec?.kind === 'chat'
        ? `chat:${spec.chat}`
        : spec?.kind === 'task'
          ? `task:${spec.task}`
          : undefined;
    const key = target(built.spec);
    const same = mine.find((a) =>
      key
        ? target(a.saved?.spec) === key
        : a.note.title === built.watcher.title && a.note.kind === args.kind,
    );
    if (same)
      return `Already waiting for ${same.note.title} (${same.note.status}). ${same.note.wakes ? 'Your next turn starts by itself when it ends: end this turn now.' : 'Wait for that call to return.'}`;
    if (mine.length >= WAIT_LIMITS.perChat)
      throw new Error(
        `This chat already waits for ${mine.length} things. Stop one (the person can press Stop waiting) or wait for one to end.`,
      );
    if (this.#active.size >= WAIT_LIMITS.total)
      throw new Error(
        'Conch is already waiting for as much as it should. Try again when one ends.',
      );
    let notification: Notification | undefined;
    if (args.notify_app) {
      if (ctx.permissionMode === 'plan')
        throw new Error(
          'Read only cannot schedule an external notification. Keep the result in this chat.',
        );
      if (!args.tell_me)
        throw new Error(
          'Use tell_me with notify_app only for an external notification the person requested.',
        );
      if (!this.deps.notificationTarget || !this.deps.tell)
        throw new Error(
          'External wait notifications are unavailable. The result can return to this chat.',
        );
      notification = await this.deps.notificationTarget(args.notify_app);
      if (ctx.permissionMode === 'default') {
        const answer = await ctx.ask({
          toolName: 'wait_for',
          input: { notify_app: notification.name, title: built.watcher.title },
          summary: `Notify you on ${notification.name} when ${built.watcher.title} ends`,
        });
        if (answer === 'deny') throw new Error('The user declined this notification.');
      }
      ctx.signal.throwIfAborted();
    }
    const limits = DEADLINE[args.kind];
    const now = this.#now;
    const minutes = Math.min(limits.max, args.timeout_minutes ?? limits.default);
    const deadline = Math.max(now + minutes * 60_000, (built.watcher.dueAt ?? 0) + 60_000);
    // A command stops with its turn, and nobody may be there to come back to: those hold the turn.
    const canLetGo =
      args.kind !== 'process' &&
      !ctx.unattended &&
      !ctx.origin &&
      !(args.kind === 'time' && (built.watcher.dueAt ?? 0) - now <= HOLD_TIME_MS);
    if (canLetGo) {
      // Already over? Then there's nothing to wait for.
      const first = await built.watcher
        .look(ctx.signal)
        .catch((error: Error) => ({ settled: false, status: '', blip: error.message }) as Reading);
      if (first.fatal) throw new Error(first.fatal);
      if (first.settled) {
        if (first.taint) ctx.taint?.(first.taint);
        return first.summary ?? first.status;
      }
      const waitId = newId('wait');
      const saved: Saved = {
        waitId,
        conversationId: ctx.conversationId,
        spec: built.spec as WaitSpec,
        startedAt: now,
        deadline,
        ...(notification && { tell: true, notification }),
      };
      const a = this.#begin({
        watcher: built.watcher,
        conversationId: ctx.conversationId,
        deadline,
        startedAt: now,
        waitId,
        ...(notification && { tell: true, notification }),
        saved,
        first,
      });
      if (built.taint)
        await this.deps.chat.taint?.(ctx.conversationId, [built.taint]).catch(() => undefined);
      await this.#save();
      const pace = built.watcher.dueAt
        ? `at ${built.watcher.title}`
        : `every ${span(built.watcher.pace.base)} at first, further apart while nothing changes`;
      return [
        `Waiting for ${a.note.title} (${first.status || 'watching'}). Conch looks by itself (${pace}) and starts your next turn in this chat when it ends, or in ${span(deadline - now)} at the latest.`,
        'End your turn now: tell the person in one short line what you are waiting for and what you will do when it is back. Don’t poll, sleep, or call wait_for again for this.',
      ].join('\n');
    }
    // Held in the turn: the call sleeps until it changes, and stops with the turn.
    const waitId = newId('wait');
    const a = this.#begin({
      watcher: built.watcher,
      conversationId: ctx.conversationId,
      deadline,
      startedAt: now,
      waitId,
      ...(notification && { tell: true, notification }),
      append: (note) => ctx.append({ type: 'wait', wait: note }),
    });
    const onAbort = () => this.stop(ctx.conversationId, waitId, 'turn');
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const ended = await a.ended;
      if (built.taint && ended.state === 'done') ctx.taint?.(built.taint);
      if (ended.taint) ctx.taint?.(ended.taint);
      await this.#tell(a, ended);
      return [ended.text, a.notificationError].filter(Boolean).join('\n\n');
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  }

  async #build(
    ctx: ToolContext,
    args: WaitArgs,
  ): Promise<{ watcher: Watcher; spec?: WaitSpec; taint?: TaintSource }> {
    const now = this.deps.now ?? Date.now;
    switch (args.kind) {
      case 'process': {
        if (!args.process_id)
          throw new Error(
            'Say which command: process_id, from process_start. To wait for a command you haven’t started, start it with process_start first.',
          );
        let pattern: RegExp | undefined;
        if (args.pattern) {
          try {
            pattern = new RegExp(args.pattern, 'i');
          } catch {
            throw new Error(
              `“${args.pattern}” isn’t a regular expression Conch can read. Use plain words, or escape special characters.`,
            );
          }
        }
        return {
          watcher: processWatcher({
            id: args.process_id,
            owner: ctx.conversationId,
            ...(pattern && { pattern }),
            peek: (o, i) => this.deps.processes.peek(o, i),
            onChange: (i, l) => this.deps.processes.onChange(i, l),
            now,
          }),
          taint: { kind: 'download', label: 'command output' },
        };
      }
      case 'time': {
        let at: number;
        if (args.until) {
          at = Date.parse(args.until);
          if (!Number.isFinite(at))
            throw new Error(
              '`until` should be an ISO time, like 2026-10-09T15:30:00+02:00. Or give minutes from now.',
            );
        } else if (args.minutes !== undefined) at = now() + args.minutes * 60_000;
        else throw new Error('Say when: `minutes` from now, or `until` (an ISO time).');
        if (at - now() > DEADLINE.time.max * 60_000)
          throw new Error(
            'That’s more than a day away. For something that far off, offer the person a routine instead.',
          );
        const spec: WaitSpec = { kind: 'time', at };
        return { watcher: timeWatcher({ at, now }), spec };
      }
      case 'url': {
        let url: URL;
        try {
          url = new URL(args.url ?? '');
        } catch {
          throw new Error('Give the page’s full address in `url`, starting with https://.');
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:')
          throw new Error('Only web pages (http or https) can be watched.');
        const spec: WaitSpec = {
          kind: 'url',
          url: url.href,
          ...(args.contains && { contains: args.contains }),
        };
        return {
          watcher: urlWatcher({
            url,
            owner: ctx.conversationId,
            fetcher: this.deps.fetcher,
            ...(args.contains && { contains: args.contains }),
          }),
          spec,
          taint: { kind: 'web', label: url.hostname.slice(0, 120) },
        };
      }
      case 'chat': {
        const others = this.deps.others;
        if (!others || !offersTogether(ctx))
          throw new Error('Waiting for another chat isn’t available here.');
        const id = args.chat?.trim();
        if (!id) throw new Error('Say which chat: `chat`, an id from list_chats.');
        if (id === ctx.conversationId)
          throw new Error('That’s this chat. Give the id of another one, from list_chats.');
        const chat = await others.chat(id).catch(() => undefined);
        // Someone else's chat looks like no chat at all.
        if (!chat || !isYours(chat))
          throw new Error(`No chat “${id}” of the person’s. Use a chat id from list_chats.`);
        // Waiting back for a chat that waits for this one would only wake each in turn.
        const back = [...this.#active.values()].some(
          (a) =>
            a.conversationId === id &&
            a.saved?.spec.kind === 'chat' &&
            a.saved.spec.chat === ctx.conversationId,
        );
        if (back)
          throw new Error(
            'That chat is already waiting for this one: waiting back would only wake each of you in turn. Carry on, or wait for something concrete instead (its task, CI).',
          );
        const spec: WaitSpec = { kind: 'chat', chat: id, title: chat.title.slice(0, 200) };
        return { watcher: this.#chatWatcher(spec), spec };
      }
      case 'task': {
        const others = this.deps.others;
        if (!others) throw new Error('Waiting for a task isn’t available here.');
        const id = args.task_id?.trim();
        if (!id)
          throw new Error('Say which task: `task_id`, from start_background_task or task_status.');
        const task = await others.task(id).catch(() => undefined);
        if (!task || task.parentConversationId !== ctx.conversationId)
          throw new Error(
            `No task “${id}” was started in this chat. Use an id from task_status; to wait for another chat, use kind chat.`,
          );
        const spec: WaitSpec = { kind: 'task', task: id, title: task.title.slice(0, 200) };
        return { watcher: this.#taskWatcher(spec), spec };
      }
      case 'ci': {
        const target = await this.#ciTarget(ctx, args);
        const client = await this.deps.github(ctx.conversationId);
        const spec: WaitSpec = { kind: 'ci', target, ...(args.fail_fast && { failFast: true }) };
        return { watcher: ciWatcher({ target, client, failFast: args.fail_fast, now }), spec };
      }
    }
  }

  async #ciTarget(ctx: ToolContext, args: WaitArgs): Promise<CiTarget> {
    const git = this.deps.git;
    const cwd = git && ctx.workspace ? await ctx.workspace().catch(() => undefined) : undefined;
    const inFolder = async (gitArgs: string[]) =>
      git && cwd ? (await git(cwd, gitArgs).catch(() => '')).trim() : '';
    const fromUrl = args.url ? readCiUrl(args.url) : undefined;
    if (args.url && !fromUrl)
      throw new Error(
        'That isn’t a GitHub run, pull request or commit address. Give one like https://github.com/owner/name/actions/runs/123, or `repo` and `ref`.',
      );
    let repo =
      fromUrl?.repo ?? args.repo?.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    repo ??= repoOfRemote(await inFolder(['remote', 'get-url', 'origin']));
    if (!repo || !isRepo(repo))
      throw new Error(
        'Say which repository: `repo` as owner/name, or a GitHub `url`. The work folder has no GitHub origin.',
      );
    if (fromUrl?.run) return { repo, run: fromUrl.run, label: `run ${fromUrl.run}` };
    const client = await this.deps.github(ctx.conversationId);
    const ref = fromUrl?.pr ? String(fromUrl.pr) : (fromUrl?.sha ?? args.ref?.trim());
    const pr = ref && /^#?\d+$/.test(ref) ? Number(ref.replace('#', '')) : undefined;
    if (pr) {
      const answer = await client.get(`/repos/${repo}/pulls/${pr}`, undefined, ctx.signal);
      const sha = (answer.json as { head?: { sha?: unknown } } | undefined)?.head?.sha;
      if (answer.status !== 200 || typeof sha !== 'string')
        throw new Error(
          `GitHub didn’t show pull request #${pr} in ${repo} (${answer.status}). Check the number, or sign in with \`gh auth login\`.`,
        );
      return { repo, sha, label: `#${pr}` };
    }
    if (ref && /^[0-9a-f]{7,40}$/i.test(ref) && ref.length === 40)
      return { repo, sha: ref, label: ref.slice(0, 7) };
    if (ref) {
      const answer = await client.get(
        `/repos/${repo}/commits/${encodeURIComponent(ref)}`,
        undefined,
        ctx.signal,
      );
      const sha = (answer.json as { sha?: unknown } | undefined)?.sha;
      if (answer.status !== 200 || typeof sha !== 'string')
        throw new Error(
          `GitHub doesn’t know “${ref}” in ${repo} (${answer.status}). Push it first, or check the name.`,
        );
      return { repo, sha, label: /^[0-9a-f]{7,40}$/i.test(ref) ? ref.slice(0, 7) : ref };
    }
    const sha = await inFolder(['rev-parse', 'HEAD']);
    if (!/^[0-9a-f]{40}$/.test(sha))
      throw new Error(
        'Say what to wait for: a `ref` (PR number, branch or commit) or a GitHub `url`.',
      );
    const branch = await inFolder(['rev-parse', '--abbrev-ref', 'HEAD']);
    return { repo, sha, label: branch && branch !== 'HEAD' ? branch : sha.slice(0, 7) };
  }

  #chatWatcher(spec: Extract<WaitSpec, { kind: 'chat' }>): Watcher {
    const others = this.deps.others;
    if (!others) throw new Error('Waiting for another chat isn’t available here.');
    return chatWatcher({
      id: spec.chat,
      title: spec.title,
      look: async (id) => {
        const chat = await others.chat(id).catch(() => undefined);
        // Gone, or no longer one of yours (someone else's words came in): nothing to say about it.
        if (!chat || !isYours(chat)) return undefined;
        // It ended its reply to wait for something of its own: it isn't done yet.
        const waiting = this.list(id).some((n) => n.state === 'watching' && n.wakes);
        return waiting ? { ...chat, waiting } : chat;
      },
      onChange: (id, listener) => others.onChange(id, listener),
    });
  }

  #taskWatcher(spec: Extract<WaitSpec, { kind: 'task' }>): Watcher {
    const others = this.deps.others;
    if (!others) throw new Error('Waiting for a task isn’t available here.');
    return taskWatcher({
      id: spec.task,
      title: spec.title,
      look: (id) => others.task(id),
      onChange: (id, listener) => others.onChange(id, listener),
    });
  }

  async #rebuild(s: Saved): Promise<Watcher> {
    const now = this.deps.now ?? Date.now;
    const spec = s.spec;
    if (spec.kind === 'time') return timeWatcher({ at: spec.at, now });
    if (spec.kind === 'chat') return this.#chatWatcher(spec);
    if (spec.kind === 'task') return this.#taskWatcher(spec);
    if (spec.kind === 'url')
      return urlWatcher({
        url: new URL(spec.url),
        owner: s.conversationId,
        fetcher: this.deps.fetcher,
        ...(spec.contains && { contains: spec.contains }),
      });
    const client = await this.deps.github(s.conversationId);
    return ciWatcher({
      target: spec.target,
      client,
      ...(spec.failFast && { failFast: true }),
      now,
    });
  }

  // ── The watch ──────────────────────────────────────────────────────────────

  #begin(options: {
    watcher: Watcher;
    conversationId: string;
    waitId: string;
    startedAt: number;
    deadline: number;
    tell?: boolean;
    notification?: Notification;
    saved?: Saved;
    /** Inside the turn: its rows go into the turn. */
    append?: (note: WaitNote) => void;
    first?: Reading;
  }): Active {
    const { watcher } = options;
    const note: WaitNote = {
      waitId: options.waitId,
      kind: watcher.kind,
      title: watcher.title,
      state: 'watching',
      status: options.first?.status || (watcher.kind === 'process' ? 'Running' : 'Watching'),
      ...(options.first?.parts && { parts: options.first.parts }),
      startedAt: options.startedAt,
      deadline: options.deadline,
      ...(watcher.url && { url: watcher.url }),
      ...(watcher.opens && { chat: watcher.opens }),
      ...(options.saved && { wakes: true }),
      ...(options.tell && { tell: true }),
    };
    const a: Active = {
      waitId: options.waitId,
      conversationId: options.conversationId,
      watcher,
      note,
      abort: new AbortController(),
      lastPoke: 0,
      checks: options.first ? 1 : 0,
      ...(options.saved && { saved: options.saved }),
      ...(options.notification && { notification: options.notification }),
      ended: Promise.resolve<Ended>({ state: 'watching', text: '' }),
    };
    const emit = (next: WaitNote) => {
      a.note = next;
      if (options.append) options.append(next);
      else
        void this.deps.chat.note(a.conversationId, { type: 'wait', wait: next }).catch(() => {
          // The chat is gone: so is its wait.
          if (next.state === 'watching') this.stop(a.conversationId, a.waitId, 'gone');
        });
    };
    this.#active.set(a.waitId, a);
    a.ended = this.#watch(a, emit, options.first).finally(() => {
      this.#active.delete(a.waitId);
    });
    const after = options.saved
      ? a.ended.then(async (ended) => {
          if (a.stopped === 'closing') return;
          // Stopped from the row: the chat says so, and nobody is woken.
          if (ended.state !== 'stopped') await this.#wake(a, ended);
          await this.#save();
        })
      : undefined;
    if (after) {
      const kept = after.catch(() => undefined).finally(() => this.#after.delete(kept));
      this.#after.add(kept);
    }
    return a;
  }

  /** Everything a wait does once it ends (waking, telling, saving) is done. For tests and shutdown. */
  async settled(): Promise<void> {
    while (this.#after.size) await Promise.all([...this.#after]);
  }
  readonly #after = new Set<Promise<unknown>>();

  async #watch(a: Active, emit: (note: WaitNote) => void, first?: Reading): Promise<Ended> {
    const { watcher } = a;
    const fp = (r: { status: string; parts?: unknown }) =>
      JSON.stringify([r.status, r.parts ?? null]);
    let last = first
      ? fp({ status: first.status, ...(first.parts && { parts: first.parts }) })
      : '';
    let gap: number | undefined;
    const off = watcher.nudge?.(() => a.poke?.());
    const end = (state: WaitState, status: string, text: string, r?: Reading): Ended => {
      const now = this.#now;
      const final: WaitNote = {
        ...a.note,
        state,
        status: status.slice(0, 300),
        ...(r?.tone && { tone: r.tone }),
        ...(r?.parts && { parts: r.parts }),
        ...(r?.url && { url: r.url }),
        ...(r?.ended && { ended: r.ended }),
        endedAt: now,
      };
      delete final.nextCheckAt;
      if (a.stopped !== 'closing' && a.stopped !== 'gone') emit(final);
      return {
        state,
        text,
        ...(r?.taint && { taint: r.taint }),
        ...(r?.bare && { bare: r.bare }),
        ...(r?.next && { next: r.next }),
      };
    };
    // The row shows at once.
    emit(a.note);
    let skipLook = Boolean(first);
    try {
      for (;;) {
        if (a.abort.signal.aborted) return this.#stoppedEnd(a, end);
        const now = this.#now;
        // Past the deadline it looks once more first: after sleep or a restart, it may have ended.
        const late = now >= a.note.deadline;
        let r: Reading;
        if (skipLook && first) {
          r = first;
          skipLook = false;
        } else {
          try {
            r = await watcher.look(a.abort.signal);
          } catch (error) {
            if (a.abort.signal.aborted) return this.#stoppedEnd(a, end);
            r = { settled: false, status: '', blip: (error as Error).message };
          }
          a.checks += 1;
        }
        if (r.fatal)
          return end('failed', r.fatal, `Couldn’t keep watching ${watcher.title}: ${r.fatal}`);
        if (r.settled) {
          const status = r.status || waitHeadline({ ...a.note, state: 'done' });
          return end('done', status, r.summary ?? status, r);
        }
        if (late)
          return end(
            'timed-out',
            `Stopped waiting after ${span(now - a.note.startedAt)}: ${a.note.status}`,
            `Stopped waiting for ${watcher.title} after ${span(now - a.note.startedAt)}: it hadn’t ended. Last seen: ${a.note.status}. Wait again with a longer timeout_minutes, or tell the person.`,
          );
        const status = r.blip ? a.note.status : r.status || a.note.status;
        const parts = r.parts ?? a.note.parts;
        const print = fp({ status, ...(parts && { parts }) });
        const changed = print !== last;
        last = print;
        gap = watcher.live
          ? watcher.pace.base
          : nextGap(watcher.pace, gap, changed, {
              ...(r.hintMs && { hint: r.hintMs }),
              ...(this.deps.random && { random: this.deps.random }),
            });
        let wakeAt = Math.min(now + gap, a.note.deadline);
        if (watcher.dueAt) wakeAt = Math.min(Math.max(watcher.dueAt, now + 250), a.note.deadline);
        const next: WaitNote = {
          ...a.note,
          status,
          ...(parts && { parts }),
          ...(r.url && { url: r.url }),
        };
        if (watcher.live) delete next.nextCheckAt;
        else next.nextCheckAt = wakeAt;
        // A live watch shows what changed; a clocked one shows its next look too.
        if (changed || !watcher.live) emit(next);
        else a.note = next;
        await this.#sleep(a, wakeAt - now, watcher.live ? LIVE_MIN_MS : 0);
        if (!a.abort.signal.aborted && this.#now - a.lastPoke < 1000) gap = undefined;
      }
    } finally {
      off?.();
    }
  }

  #stoppedEnd(
    a: Active,
    end: (state: WaitState, status: string, text: string) => { state: WaitState; text: string },
  ) {
    const why = a.stopped;
    if (why === 'turn')
      return end(
        'stopped',
        'Stopped with the turn',
        `Stopped waiting for ${a.watcher.title}: the turn was stopped.`,
      );
    if (why === 'gone') return end('stopped', 'Stopped: the chat is gone', '');
    if (why === 'closing') return end('stopped', 'Conch is restarting', '');
    return end(
      'stopped',
      'You stopped waiting',
      `The person stopped waiting for ${a.watcher.title}. Don’t wait for it again unless they ask.`,
    );
  }

  /** Sleeps, until the time, a poke (Check now, a nudge, Stop) or the end. */
  #sleep(a: Active, ms: number, atLeast: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const started = this.#now;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        a.abort.signal.removeEventListener('abort', finish);
        a.poke = undefined;
        resolve();
      };
      const timer = setTimeout(finish, Math.max(atLeast, ms));
      timer.unref?.();
      a.poke = () => {
        const waited = this.#now - started;
        if (waited >= atLeast || a.abort.signal.aborted) finish();
        else {
          clearTimeout(timer);
          setTimeout(finish, atLeast - waited).unref?.();
        }
      };
      if (a.abort.signal.aborted) finish();
      else a.abort.signal.addEventListener('abort', finish, { once: true });
    });
  }

  async #wake(a: Active, ended: Ended) {
    await this.#tell(a, ended);
    if (!ended.text || this.#closed) return;
    // Someone else's words came into this chat since it began waiting (ADR 0134): it hears
    // how the other chat ended, never what that chat said.
    let text = ended.text;
    if (ended.bare && a.saved?.spec.kind === 'chat') {
      const here = await this.deps.others?.chat(a.conversationId).catch(() => undefined);
      if (here?.taint.some((t) => t.kind === 'person')) text = ended.bare;
    }
    // What it brings back is someone else's words: the chat is wary before it reads them.
    if (ended.taint && text !== ended.bare)
      await this.deps.chat.taint?.(a.conversationId, [ended.taint]).catch(() => undefined);
    const headline = waitHeadline({ ...a.note, state: ended.state });
    const prompt = [
      `[Conch] A wait you started has ended: ${headline}.`,
      text,
      ...(a.notificationError
        ? [a.notificationError]
        : a.notification
          ? [
              'The requested external notification has already been sent to the chosen app. Do not send it again.',
            ]
          : []),
      ended.next ??
        (ended.state === 'done'
          ? 'Carry on with the job from here for the person. If you need to wait again, call wait_for again.'
          : 'Decide what to do next for the person: carry on, wait again, or tell them.'),
    ].join('\n\n');
    await this.deps.chat.wake(a.conversationId, prompt).catch(() => undefined);
  }

  async #tell(a: Active, ended: { state: WaitState }) {
    if (!a.notification || !this.deps.tell || ended.state === 'stopped') return;
    await this.deps
      .tell({
        title: waitHeadline({ ...a.note, state: ended.state }),
        body: a.note.status,
        conversationId: a.conversationId,
        waitId: a.waitId,
        notification: a.notification,
      })
      .catch(() => {
        a.notificationError =
          'The requested notification could not be delivered. Do not retry it automatically or send it to another app; report that the result is here in this chat.';
      });
  }

  async #save() {
    await this.#mutex.run(async () => {
      const waits = [...this.#active.values()].flatMap((a) =>
        a.saved && a.stopped !== 'gone' && a.stopped !== 'you' ? [a.saved] : [],
      );
      // Closing keeps what's going, for the restart.
      await writeJson(this.#path, { waits });
    });
  }
}

/** How a wait ended: what the assistant reads, and whose words it brings in. */
interface Ended {
  state: WaitState;
  text: string;
  taint?: TaintSource;
  /** The same without anyone's words: for a chat someone else has come into since. */
  bare?: string;
  /** What to do next, when it isn't simply carrying on. */
  next?: string;
}

/** What `wait_for` was asked, after its schema. */
interface WaitArgs {
  kind: 'ci' | 'process' | 'url' | 'time' | 'chat' | 'task';
  chat?: string;
  task_id?: string;
  url?: string;
  repo?: string;
  ref?: string;
  fail_fast: boolean;
  process_id?: string;
  pattern?: string;
  contains?: string;
  minutes?: number;
  until?: string;
  timeout_minutes?: number;
  tell_me: boolean;
  notify_app?: string;
}
