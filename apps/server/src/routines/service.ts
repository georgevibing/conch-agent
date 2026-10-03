import {
  CreateRoutineBody,
  Routine,
  type RoutineTrust,
  Schedule,
  type ConversationEventInput,
  type EngineId,
  type PermissionMode,
  type RoutineDetail,
  type RoutineRun,
  type RoutineSpending,
  type ServerEvent,
  type UpdateRoutineBody,
  type Usage,
} from '@conch/protocol';
import { z } from 'zod';

import type { ConversationManager } from '../conversations/manager';
import type { Engine, HostTool } from '../engines/types';
import { newId } from '../lib/ids';
import { cheapModel } from '../memory/learning';
import { describe, nextRuns, previousRun, ScheduleError, validate } from './schedule';
import { monthKey, type Allowed, type RoutineSpend } from './spend';
import type { RoutineStore, StoredRoutine } from './store';

/** Re-check at least this often, so sleep/wake and clock changes are noticed. */
const TICK_MS = 30_000;
/** A run held for a provider that wasn't ready still runs if it comes back within this. */
const WAIT_FOR_PROVIDER_MS = 12 * 60 * 60_000;
/** A run starting this late counts as a catch-up rather than on time. */
const LATE_MS = 5 * 60_000;
const MAX_CONCURRENT = 2;

const trustModes: Record<RoutineTrust, PermissionMode> = {
  ask: 'default',
  edits: 'acceptEdits',
  full: 'bypassPermissions',
};

export class RoutineError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid' | 'busy' | 'engine-unavailable',
    message: string,
  ) {
    super(message);
  }
}

export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Owns routines end to end: storage, the schedule clock, running them as real
 * conversations, recording outcomes, and the tools the agent uses to create
 * them from a chat.
 */
export class RoutineService {
  #timer?: NodeJS.Timeout;
  #running = new Map<string, string>(); // routineId → runId
  /** Runs held back because their provider wasn't ready: they go once it is. */
  #waiting = new Map<
    string,
    { engine: EngineId; since: number; scheduledFor?: number; runId: string }
  >();
  /**
   * Runs waiting for room on a plan (ADR 0057): they go once the window has
   * room again, unless their routine's next time comes first.
   */
  #roomWait = new Map<string, { until?: number; scheduledFor?: number }>();
  #started = false;

  constructor(
    private readonly deps: {
      store: RoutineStore;
      conversations: ConversationManager;
      /** The provider a routine's options name, else the default. */
      engine: (id?: EngineId) => Engine;
      emit: (event: ServerEvent) => void;
      now?: () => number;
      /** Leaves a “fixed on its own” note (a held run went once its provider came back). */
      onHeal?: (message: string) => void;
      /** What runs spend, and the guards on it (ADR 0057). */
      spend?: RoutineSpend;
    },
  ) {}

  get #now() {
    return this.deps.now?.() ?? Date.now();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async start() {
    if (this.#started) return;
    this.#started = true;
    await this.#tick();
  }

  /** Evaluate schedules now (the timer calls this; tests and wake-from-sleep can too). */
  checkNow() {
    return this.#tick();
  }

  stop() {
    this.#started = false;
    if (this.#timer) clearTimeout(this.#timer);
  }

  // ── Queries ────────────────────────────────────────────────────────────

  async list(): Promise<Routine[]> {
    const all = await this.deps.store.all();
    const routines = await Promise.all(all.map((r) => this.#view(r)));
    return routines.sort((a, b) => b.createdAt - a.createdAt);
  }

  async detail(id: string): Promise<RoutineDetail> {
    const stored = await this.#require(id);
    return { routine: await this.#view(stored), runs: await this.deps.store.runs(id) };
  }

  // ── Mutations ──────────────────────────────────────────────────────────

  async create(
    input: z.input<typeof CreateRoutineBody>,
    meta: { createdBy: 'user' | 'agent'; sourceConversationId?: string },
  ): Promise<Routine> {
    const body = CreateRoutineBody.parse(input);
    this.#validate(body.schedule, body.timezone);
    const now = this.#now;
    const stored = await this.deps.store.save({
      id: newId('r'),
      title: tidyTitle(body.title),
      summary: tidySentence(body.summary),
      prompt: body.prompt,
      schedule: body.schedule,
      timezone: body.timezone,
      status: body.status,
      ...(body.runLimitUsd && { runLimitUsd: body.runLimitUsd }),
      trust: body.trust,
      catchUp: body.catchUp,
      options: body.options,
      createdBy: meta.createdBy,
      sourceConversationId: meta.sourceConversationId,
      createdAt: now,
      updatedAt: now,
      anchor: now,
      lastScheduledFor: now,
    });
    return this.#changed(stored);
  }

  async update(id: string, patch: UpdateRoutineBody): Promise<Routine> {
    const current = await this.#require(id);
    const schedule = patch.schedule ?? current.schedule;
    const timezone = patch.timezone ?? current.timezone;
    const reschedule = Boolean(patch.schedule || patch.timezone);
    const reactivating = patch.status === 'active' && current.status !== 'active';
    if (reschedule || reactivating) this.#validate(schedule, timezone);
    const now = this.#now;
    const { runLimitUsd, ...rest } = patch;
    const stored = await this.deps.store.save({
      ...current,
      ...rest,
      // `null` goes back to Conch's default.
      ...(runLimitUsd !== undefined && { runLimitUsd: runLimitUsd ?? undefined }),
      ...(patch.title !== undefined && { title: tidyTitle(patch.title) }),
      ...(patch.summary !== undefined && { summary: tidySentence(patch.summary) }),
      // A new schedule (or turning it back on) starts counting from now — never
      // fire a backlog of runs that were "missed" while it was paused.
      ...((reschedule || reactivating) && { anchor: now, lastScheduledFor: now }),
      updatedAt: now,
    });
    return this.#changed(stored);
  }

  async remove(id: string) {
    await this.#require(id);
    await this.deps.store.remove(id);
    this.deps.emit({ type: 'routine.deleted', routineId: id });
    this.#schedule();
  }

  /** Run a routine right now, regardless of its schedule. */
  async runNow(id: string): Promise<RoutineRun> {
    const routine = await this.#require(id);
    if (this.#running.has(id)) throw new RoutineError('busy', 'This routine is already running.');
    const run = await this.#execute(routine, 'manual');
    if (!run) throw new RoutineError('busy', 'This routine is already running.');
    return run;
  }

  // ── Scheduling ─────────────────────────────────────────────────────────

  /** Routines held back because their provider wasn't ready (for Repair everything). */
  held(): { routineId: string; engine: EngineId }[] {
    return [...this.#waiting].map(([routineId, held]) => ({ routineId, engine: held.engine }));
  }

  /** Runs held for a provider that's ready now go, once each. */
  async #resumeWaiting() {
    for (const [routineId, held] of this.#waiting) {
      if (this.#now - held.since > WAIT_FOR_PROVIDER_MS) {
        this.#waiting.delete(routineId);
        continue;
      }
      const engine = this.deps.engine(held.engine);
      const ready = (await engine.detect().catch(() => undefined))?.state === 'ready';
      if (!ready) continue;
      this.#waiting.delete(routineId);
      const routine = await this.deps.store.get(routineId).catch(() => undefined);
      if (!routine || routine.status !== 'active') continue;
      const run = await this.#execute(routine, 'catch-up', held.scheduledFor);
      if (run)
        this.deps.onHeal?.(
          `“${routine.title}” didn’t run while ${engine.label} was signed out, so it ran once ${engine.label} was back.`,
        );
    }
    // Runs that waited for room on a plan go once there's room (ADR 0057).
    for (const [routineId, held] of this.#roomWait) {
      if (held.until !== undefined && this.#now < held.until) continue;
      const routine = await this.deps.store.get(routineId).catch(() => undefined);
      if (!routine || routine.status !== 'active') {
        this.#roomWait.delete(routineId);
        continue;
      }
      const allowed = await this.#allow(routine, this.deps.engine(routine.options.engine));
      if (!allowed.ok) {
        if (allowed.guard === 'plan-room') held.until = allowed.until;
        else this.#roomWait.delete(routineId);
        continue;
      }
      this.#roomWait.delete(routineId);
      await this.#execute(routine, 'catch-up', held.scheduledFor);
    }
  }

  /** Routines waiting for room on a plan, or paused at the monthly limit (for Repair everything). */
  waitingForRoom(): string[] {
    return [...this.#roomWait.keys()];
  }

  /** What routines spent this month, with what the active ones will spend (ADR 0057). */
  async spending(): Promise<RoutineSpending | undefined> {
    const spend = this.deps.spend;
    if (!spend) return undefined;
    const active = (await this.list()).filter(
      (r) => r.status === 'active' && r.spend?.billing === 'metered',
    );
    const known = active.flatMap((r) =>
      r.spend?.monthlyUsd !== undefined ? [r.spend.monthlyUsd] : [],
    );
    return spend.state(known.length ? known.reduce((a, b) => a + b, 0) : undefined);
  }

  async #allow(routine: StoredRoutine, engine: Engine): Promise<Allowed> {
    return (
      (await this.deps.spend?.allow(routine.id, engine).catch(() => undefined)) ?? { ok: true }
    );
  }

  async #tick() {
    await this.#resumeWaiting();
    const now = this.#now;
    for (const routine of await this.deps.store.all()) {
      if (routine.status !== 'active') continue;
      const handled = routine.lastScheduledFor ?? routine.createdAt;
      // The first scheduled time we haven't handled yet…
      const [firstDue] = nextRuns(routine.schedule, routine.timezone, {
        from: handled,
        anchor: routine.anchor,
      });
      if (firstDue === undefined || firstDue > now) continue;
      // …and the most recent one, which is what we run (a single catch-up, never a backlog).
      const due = previousRun(routine.schedule, routine.timezone, now, routine.anchor) ?? firstDue;
      const late = now - firstDue > LATE_MS;
      await this.deps.store.save({ ...routine, lastScheduledFor: due });
      // Its next time came: that run replaces one still waiting for room.
      this.#roomWait.delete(routine.id);
      if (late && !routine.catchUp) {
        await this.#record(routine, { trigger: 'schedule', status: 'missed', scheduledFor: due });
        await this.#afterRun(routine.id);
        continue;
      }
      void this.#execute(
        { ...routine, lastScheduledFor: due },
        late ? 'catch-up' : 'schedule',
        due,
      );
    }
    this.#schedule();
  }

  /** Sleep until the next due run (but never longer than TICK_MS). */
  #schedule() {
    if (!this.#started) return;
    if (this.#timer) clearTimeout(this.#timer);
    void this.deps.store.all().then((all) => {
      const now = this.#now;
      const next = all
        .filter((r) => r.status === 'active')
        .flatMap((r) => nextRuns(r.schedule, r.timezone, { from: now, anchor: r.anchor }))
        .reduce((min, t) => Math.min(min, t), Infinity);
      const delay = Math.max(250, Math.min(TICK_MS, next - now + 50));
      this.#timer = setTimeout(() => void this.#tick(), delay);
      this.#timer.unref?.();
    });
  }

  // ── Running ────────────────────────────────────────────────────────────

  async #execute(
    routine: StoredRoutine,
    trigger: RoutineRun['trigger'],
    scheduledFor?: number,
  ): Promise<RoutineRun | undefined> {
    if (this.#running.has(routine.id)) {
      await this.#record(routine, {
        trigger,
        status: 'skipped',
        scheduledFor,
        outcome: 'The previous run was still going.',
      });
      return undefined;
    }
    if (this.#running.size >= MAX_CONCURRENT) {
      await this.#record(routine, {
        trigger,
        status: 'skipped',
        scheduledFor,
        outcome: 'Too many routines were running at once.',
      });
      return undefined;
    }

    const engine = this.deps.engine(routine.options.engine);
    const status = await engine.detect();
    if (status.state !== 'ready') {
      const reason =
        status.state === 'signed-out'
          ? `${engine.label} was signed out, so this didn’t run. It runs as soon as you sign in.`
          : status.state === 'not-installed'
            ? `${engine.label} isn’t installed, so this didn’t run. It runs once it’s there.`
            : `${engine.label} wasn’t available, so this didn’t run. It runs once it’s back.`;
      const run = await this.#record(routine, {
        trigger,
        status: 'failed',
        scheduledFor,
        error: reason,
        waitingFor: engine.id,
      });
      // Held, not lost: it runs once the provider is ready again (checked every tick).
      if (run)
        this.#waiting.set(routine.id, {
          engine: engine.id,
          since: this.#now,
          scheduledFor,
          runId: run.id,
        });
      await this.#afterRun(routine.id);
      return run;
    }
    this.#waiting.delete(routine.id);

    // Spending guards (ADR 0057). “Run now” is a person asking, so it goes.
    const checked = await this.#allow(routine, engine);
    const allowed: Allowed = trigger === 'manual' && !checked.ok ? { ok: true } : checked;
    if (!allowed.ok) return this.#guarded(routine, trigger, scheduledFor, allowed);
    const spend = this.deps.spend;
    const billing =
      allowed.billing ?? (await spend?.billing(engine).catch(() => undefined))?.billing;
    const history = spend ? await this.deps.store.runs(routine.id) : [];
    const limit = spend?.runLimit(routine, history, routine.options.model);
    let conversationId: string | undefined;
    let stopped: string | undefined;
    /** What it had used when last told: a run cut short may not say at the end. */
    let used: Usage | undefined;

    let run: RoutineRun = {
      id: newId('run'),
      routineId: routine.id,
      trigger,
      status: 'running',
      scheduledFor,
      startedAt: this.#now,
    };
    this.#running.set(routine.id, run.id);
    let reported:
      { status: 'done' | 'nothing-to-do' | 'needs-attention'; summary: string } | undefined;

    const report: HostTool<{
      status: z.ZodEnum<{
        done: 'done';
        'nothing-to-do': 'nothing-to-do';
        'needs-attention': 'needs-attention';
      }>;
      summary: z.ZodString;
    }> = {
      name: 'report_outcome',
      description:
        'Call exactly once at the end of this routine run to record what happened. `summary` is one short plain-language line the user will read in their routine history (max 120 characters, no preamble), e.g. "Sent your briefing: 3 meetings and rain after 4pm".',
      input: {
        status: z.enum(['done', 'nothing-to-do', 'needs-attention']),
        summary: z.string().min(1).max(200),
      },
      async run(args) {
        reported = args;
        return 'Recorded.';
      },
    };

    const update = async (patch: Partial<RoutineRun>) => {
      run = { ...run, ...patch };
      await this.deps.store.saveRun(run);
      this.deps.emit({ type: 'routine.run', run });
    };

    /** Past its limit: stop it cleanly, once (ADR 0057). */
    const stop = (why: string) => {
      if (stopped) return;
      stopped = why;
      if (conversationId)
        void this.deps.conversations.interrupt(conversationId).catch(() => undefined);
    };

    try {
      const started = await this.deps.conversations.start({
        title: routine.title,
        text: routine.prompt,
        options: routine.options,
        origin: { kind: 'routine', routineId: routine.id, runId: run.id },
        extras: {
          systemExtra: runBrief(routine, trigger, this.#now),
          tools: [report as HostTool],
          permissionMode: trustModes[routine.trust],
          onConversation: async (id) => {
            conversationId = id;
          },
          onStatus: (s) => {
            if (s === 'awaiting-permission' && run.status === 'running')
              void update({ status: 'needs-you' });
            if (s === 'running' && run.status === 'needs-you') void update({ status: 'running' });
          },
          ...(spend &&
            limit && {
              onUsage: (usage, from) => {
                used = usage;
                const why = spend.over(limit, billing, usage, from.model);
                if (why) stop(why);
              },
            }),
        },
      });
      conversationId = started.conversationId;
      // Over its limit before the conversation was known: stop it now.
      if (stopped) void this.deps.conversations.interrupt(conversationId).catch(() => undefined);
      await update({ conversationId });
      const turn = await started.result;
      const cost = spend
        ? await spend
            .cost(
              turn.usage ?? used,
              { engine: turn.engine ?? engine.id, model: turn.model },
              allowed.before,
            )
            .catch(() => undefined)
        : undefined;
      if (cost) await spend?.count(routine.id, cost).catch(() => undefined);
      const final: Partial<RoutineRun> =
        stopped && turn.outcome !== 'error'
          ? { status: 'needs-you', guard: 'run', outcome: stopped }
          : turn.outcome === 'interrupted'
            ? { status: 'stopped', outcome: 'Stopped before it finished.' }
            : turn.outcome === 'error'
              ? { status: 'failed', error: turn.error ?? 'Something went wrong.' }
              : {
                  status:
                    reported?.status === 'nothing-to-do'
                      ? 'nothing-to-do'
                      : reported?.status === 'needs-attention'
                        ? 'needs-you'
                        : 'succeeded',
                  outcome: tidySentence(
                    reported?.summary ?? firstLine(turn.finalText) ?? 'Done.',
                    160,
                  ),
                };
      await update({
        ...final,
        finishedAt: this.#now,
        usage: turn.usage ?? used,
        ...(cost && { cost }),
      });
    } catch (error) {
      await update({ status: 'failed', finishedAt: this.#now, error: (error as Error).message });
    } finally {
      this.#running.delete(routine.id);
      await this.#afterRun(routine.id);
    }
    return run;
  }

  /**
   * A spending guard held this run (ADR 0057): it's said once, not every time
   * it comes round. At the monthly limit it skips until the 1st (or a higher
   * limit); for room on a plan it waits and goes once the window has room.
   */
  async #guarded(
    routine: StoredRoutine,
    trigger: RoutineRun['trigger'],
    scheduledFor: number | undefined,
    allowed: Extract<Allowed, { ok: false }>,
  ): Promise<RoutineRun | undefined> {
    const [last] = await this.deps.store.runs(routine.id);
    const said =
      last?.status === 'skipped' &&
      last.guard === allowed.guard &&
      (allowed.guard === 'month'
        ? monthKey(last.startedAt) === monthKey(this.#now)
        : this.#roomWait.has(routine.id));
    if (allowed.guard === 'plan-room')
      this.#roomWait.set(routine.id, {
        ...(allowed.until !== undefined && { until: allowed.until }),
        ...(scheduledFor !== undefined && { scheduledFor }),
      });
    if (said) return undefined;
    const run = await this.#record(routine, {
      trigger,
      status: 'skipped',
      scheduledFor,
      guard: allowed.guard,
      outcome: allowed.message,
    });
    await this.#afterRun(routine.id);
    return run;
  }

  /** One-off routines are done after their run; everything re-broadcasts. */
  async #afterRun(routineId: string) {
    const routine = await this.deps.store.get(routineId);
    if (!routine) return;
    if (routine.schedule.type === 'once' && routine.status === 'active') {
      await this.#changed(
        await this.deps.store.save({ ...routine, status: 'completed', updatedAt: this.#now }),
      );
      return;
    }
    await this.#changed(routine);
  }

  async #record(
    routine: StoredRoutine,
    fields: Pick<RoutineRun, 'trigger' | 'status'> & Partial<RoutineRun>,
  ): Promise<RoutineRun> {
    const now = this.#now;
    const run: RoutineRun = {
      id: newId('run'),
      routineId: routine.id,
      startedAt: now,
      finishedAt: now,
      ...fields,
    };
    await this.deps.store.saveRun(run);
    this.deps.emit({ type: 'routine.run', run });
    return run;
  }

  // ── Agent tools ────────────────────────────────────────────────────────

  /** Tools for ordinary chats: the agent drafts routines; the user turns them on. */
  tools(ctx: {
    conversationId: string;
    append: (event: ConversationEventInput) => void;
  }): HostTool[] {
    const card = (routine: Routine, action: 'proposed' | 'updated' | 'paused' | 'deleted') =>
      ctx.append({ type: 'routine', routineId: routine.id, action, title: routine.title });

    const create: HostTool = {
      name: 'create_routine',
      description: [
        'Draft a routine: a task Conch runs automatically on a schedule on this computer (while Conch is running).',
        'Use it when the user wants something done regularly or later ("every morning…", "each Friday…", "remind me at 5pm…").',
        'The user sees a card and turns it on themselves — never claim it is already active.',
        'Drafts always ask before acting; the user can give a routine more trust from its card. You can’t.',
        'Write title, summary and prompt in this exact style:',
        '- title: 2–5 words, sentence case, no emoji or punctuation at the end. e.g. "Morning briefing".',
        '- summary: one plain sentence (max ~15 words) saying what the user gets, e.g. "A short summary of today’s calendar and the weather."',
        '- prompt: complete, self-contained instructions for a future run that has no memory of this chat: what to do, where to look, and what to write back. Plain language.',
        'Prefer the simplest schedule type (daily, weekly, monthly, interval, once) over cron. Times are 24h HH:MM in the user’s timezone.',
        'Set light: true only when the job is simple enough for a small, cheaper model to do as well (a reminder, a yes/no check, copying something over). Leave it off for anything that writes, summarises or judges: briefings, digests, research.',
      ].join('\n'),
      input: {
        title: z.string().min(1).max(60),
        summary: z.string().max(200),
        prompt: z.string().min(1).max(20_000),
        schedule: Schedule,
        light: z.boolean().optional(),
      },
      run: async (args) => {
        // Never quietly create a second copy of something the user already has.
        const wanted = tidyTitle((args as { title: string }).title).toLowerCase();
        const existing = (await this.list()).find(
          (r) => r.status !== 'completed' && r.title.toLowerCase() === wanted,
        );
        if (existing) {
          card(existing, 'updated');
          return `The user already has a routine called “${existing.title}” [${existing.id}] — ${existing.scheduleText}, ${existing.status}. Don’t create a duplicate: tell them it exists and offer to change it with update_routine (or ask if they want a second, differently named one).`;
        }
        try {
          const { light, ...draft } = args as {
            title: string;
            summary: string;
            prompt: string;
            schedule: Schedule;
            light?: boolean;
          };
          const routine = await this.create(
            {
              title: draft.title,
              summary: draft.summary,
              prompt: draft.prompt,
              schedule: draft.schedule,
              // A simple job on the provider's small model: cheaper, never pricier (ADR 0057).
              ...(light && { options: await this.#lightOptions() }),
              // Only a person can grant trust — an agent that read something hostile
              // must not be able to schedule itself an unsupervised future.
              trust: 'ask',
              timezone: localTimezone(),
              status: 'draft',
            },
            { createdBy: 'agent', sourceConversationId: ctx.conversationId },
          );
          card(routine, 'proposed');
          const next = routine.nextRunAt
            ? new Date(routine.nextRunAt).toISOString()
            : 'not scheduled';
          return `Drafted routine ${routine.id} “${routine.title}” — ${routine.scheduleText} (first run ${next}). The user now sees a card with “Turn on” and “Try it now”. Briefly confirm what it will do and when; don’t repeat the whole card.`;
        } catch (error) {
          return `Couldn’t create the routine: ${(error as Error).message} Adjust and try again.`;
        }
      },
    };

    const list: HostTool = {
      name: 'list_routines',
      description: 'List the user’s routines with their ids, schedules, status and last outcome.',
      input: {},
      run: async () => {
        const routines = await this.list();
        if (!routines.length) return 'The user has no routines yet.';
        return routines
          .map(
            (r) =>
              `[${r.id}] ${r.title} — ${r.scheduleText} — ${r.status}` +
              (r.lastRun
                ? ` — last: ${r.lastRun.status}${r.lastRun.outcome ? ` (${r.lastRun.outcome})` : ''}`
                : ''),
          )
          .join('\n');
      },
    };

    const update: HostTool = {
      name: 'update_routine',
      description:
        'Change an existing routine (by id from list_routines): its title, summary, prompt or schedule, or pause it (status "paused"). Only change what the user asked for. You can’t turn routines on — the user does that from the card. Changing the instructions pauses it until the user reviews and turns it back on.',
      input: {
        id: z.string(),
        title: z.string().min(1).max(60).optional(),
        summary: z.string().max(200).optional(),
        prompt: z.string().min(1).max(20_000).optional(),
        schedule: Schedule.optional(),
        status: z.enum(['paused']).optional(),
      },
      run: async (args) => {
        const { id, ...given } = args as { id: string } & UpdateRoutineBody;
        // Only what the tool offers: never trust, a provider, or what a run may spend.
        const patch: UpdateRoutineBody = {
          ...(given.title !== undefined && { title: given.title }),
          ...(given.summary !== undefined && { summary: given.summary }),
          ...(given.prompt !== undefined && { prompt: given.prompt }),
          ...(given.schedule !== undefined && { schedule: given.schedule }),
          ...(given.status === 'paused' && { status: 'paused' as const }),
        };
        try {
          const current = await this.#require(id);
          // New instructions from the agent need a person's review before they
          // run unattended again, and never keep extra trust.
          const rewritten = patch.prompt !== undefined && patch.prompt !== current.prompt;
          const routine = await this.update(id, {
            ...patch,
            ...(rewritten && {
              trust: 'ask',
              ...(current.status === 'active' && { status: 'paused' as const }),
            }),
          });
          card(routine, patch.status === 'paused' ? 'paused' : 'updated');
          if (rewritten && current.status === 'active')
            return `Updated “${routine.title}”. Because its instructions changed, it’s paused until the user reviews it and turns it back on — tell them.`;
          return `Updated “${routine.title}” — ${routine.scheduleText}, ${routine.status}.`;
        } catch (error) {
          return `Couldn’t update the routine: ${(error as Error).message}`;
        }
      },
    };

    const remove: HostTool = {
      name: 'delete_routine',
      description:
        'Delete a routine by id. Only when the user clearly asks to delete it (pausing is often better).',
      input: { id: z.string() },
      run: async (args) => {
        const { id } = args as { id: string };
        try {
          const { routine } = await this.detail(id);
          await this.remove(id);
          card(routine, 'deleted');
          return `Deleted “${routine.title}”.`;
        } catch (error) {
          return `Couldn’t delete the routine: ${(error as Error).message}`;
        }
      },
    };

    return [create, list, update, remove];
  }

  /** Short context for every chat so the agent knows what already exists. */
  async promptSection(): Promise<string> {
    const routines = (await this.list()).filter((r) => r.status !== 'completed');
    const lines = routines
      .slice(0, 30)
      .map((r) => `- [${r.id}] ${r.title} — ${r.scheduleText} (${r.status})`);
    return [
      '# Routines',
      'You can create routines with create_routine: tasks Conch runs automatically on a schedule, as a fresh unattended conversation each time. Reach for it whenever the user wants something recurring or at a later time. Check the list below first to avoid duplicates, and update an existing routine instead when that fits.',
      lines.length ? `The user’s routines:\n${lines.join('\n')}` : 'The user has no routines yet.',
    ].join('\n');
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /** The default provider's small model, for a simple job; nothing when it has none. */
  async #lightOptions(): Promise<{ engine?: EngineId; model?: string }> {
    const engine = this.deps.engine();
    const small = await cheapModel(engine).catch(() => undefined);
    return small?.model ? { engine: engine.id, model: small.model } : {};
  }

  #validate(schedule: Schedule, timezone: string) {
    try {
      validate(schedule, timezone, this.#now);
    } catch (error) {
      if (error instanceof ScheduleError) throw new RoutineError('invalid', error.message);
      throw error;
    }
  }

  async #require(id: string): Promise<StoredRoutine> {
    const routine = await this.deps.store.get(id);
    if (!routine) throw new RoutineError('not-found', 'That routine no longer exists.');
    return routine;
  }

  async #view(stored: StoredRoutine): Promise<Routine> {
    const runs = await this.deps.store.runs(stored.id);
    const { lastScheduledFor: _l, anchor, ...rest } = stored;
    const nextRunAt =
      stored.status === 'active'
        ? nextRuns(stored.schedule, stored.timezone, { from: this.#now, anchor })[0]
        : undefined;
    const spend = await this.deps.spend?.view(stored, runs).catch(() => undefined);
    return Routine.parse({
      ...rest,
      scheduleText: describe(stored.schedule, stored.timezone),
      nextRunAt,
      lastRun: runs[0],
      runCount: runs.length,
      ...(spend && { spend }),
    });
  }

  async #changed(stored: StoredRoutine): Promise<Routine> {
    const routine = await this.#view(stored);
    this.deps.emit({ type: 'routine.changed', routine });
    this.#schedule();
    return routine;
  }
}

/** The system prompt addition for an unattended run. */
function runBrief(routine: StoredRoutine, trigger: RoutineRun['trigger'], now: number): string {
  const when = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: routine.timezone,
  }).format(now);
  return [
    '# This is a routine run',
    `You are running the user’s routine “${routine.title}” (${describe(routine.schedule, routine.timezone)}). It is ${when}.${trigger === 'catch-up' ? ' This run is catching up on a time that was missed while Conch wasn’t running.' : ''}`,
    'Nobody is watching live — the user will read the result later. Do the task fully and independently. Your final message is what they’ll read: make it the result itself, clear and concise, with no preamble about being a routine.',
    'Finish by calling report_outcome once: "done" when you did the task, "nothing-to-do" when there was genuinely nothing to act on, "needs-attention" when the user must look at something.',
  ].join('\n');
}

function firstLine(text: string): string | undefined {
  const line = text
    .split('\n')
    .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
    .find(Boolean);
  return line || undefined;
}

function tidyTitle(title: string): string {
  const t = title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]+$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function tidySentence(text: string, max = 200): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  const cut = t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}
