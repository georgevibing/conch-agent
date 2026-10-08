/**
 * The check-in (ADR 0107): Conch looks at what's new every half hour outside
 * quiet hours, and tells you only what one of your standing orders asks to
 * hear about, saying why.
 *
 * It's built from what routines already have, not beside them:
 *
 * - **Looking costs nothing.** The When-routines' own mail and calendar
 *   sources (ADR 0056) find what's new with no model: a Gmail search from
 *   where it last looked, the next two hours of the calendar. No standing order
 *   that asks to hear about something, and it doesn't look at all.
 * - **Only something new wakes a model**, the provider's cheapest, with no
 *   tools (`judge.ts`). It's spending like a routine's only-if check: asked of
 *   and counted by `RoutineSpend` (ADR 0057), so the monthly limit and room on
 *   a plan hold it, and what it waited for is looked at once they allow.
 * - **It never acts.** It reads and tells. "You may archive newsletters" is
 *   for chats and routine runs, under their permission mode; a check-in that
 *   read someone's email can't do anything about it but name it to you.
 * - **Quiet hours** (22:00–07:00 unless you choose): it doesn't look; the
 *   first look after them covers the night, since mail is searched from where
 *   it last looked.
 * - **Few, and never twice.** Each thing once (by its source's id), at most
 *   three notifications a look and twelve a day; past that, what it found is
 *   listed under Told you, without a sound.
 *
 * `checkin.json` keeps your choices and what it told you (kept in backups);
 * `checkin/state.json` keeps where each source looked and what waits
 * (derived: a restored backup starts looking from now).
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import {
  CHECK_IN_EVERY_DEFAULT,
  type CheckInStatus,
  inQuietHours,
  QUIET_HOURS_DEFAULT,
  QuietHours,
  ToldThing,
  type CheckInBody,
  type StandingOrder,
  type Usage,
} from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';
import type { CheapModel } from '../routines/triggers/onlyif';
import {
  SourceError,
  type Happening,
  type TriggerOf,
  type TriggerSource,
} from '../routines/triggers/types';
import { judge, PER_LOOK } from './judge';
import type { StandingOrderStore } from './orders';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Notifications a day at most; the rest are listed quietly. */
export const DAILY_TELLS = 12;
/** A look reaches back at most this far, however long Conch was off. */
const BACKLOG_MS = DAY;
/** Things kept waiting for a model or the spending guards, at most. */
const MAX_WAITING = 30;
const KEEP_TOLD = 50;
/** A meeting this close is worth a heads-up, if an order asks about it. */
const CALENDAR_AHEAD_MINUTES = 120;

const MAIL: TriggerOf<'mail'> = { kind: 'mail', from: [], words: [] };
const CALENDAR: TriggerOf<'calendar'> = {
  kind: 'calendar',
  minutesBefore: CALENDAR_AHEAD_MINUTES,
  withOthers: false,
  words: [],
};

const Settings = z.object({
  on: z.boolean().default(true),
  quiet: QuietHours.default(QUIET_HOURS_DEFAULT),
  everyMinutes: z.number().int().min(15).max(240).default(CHECK_IN_EVERY_DEFAULT),
  told: z.array(ToldThing).default([]),
  month: z
    .object({
      key: z.string().default(''),
      looks: z.number().int().nonnegative().default(0),
      woke: z.number().int().nonnegative().default(0),
      usd: z.number().nonnegative().default(0),
    })
    .default({ key: '', looks: 0, woke: 0, usd: 0 }),
});
type Settings = z.infer<typeof Settings>;

const Waiting = z.object({
  id: z.string(),
  at: z.number(),
  label: z.string(),
  detail: z.string(),
  link: z.string().optional(),
  source: z.enum(['mail', 'calendar']),
  tries: z.number().int().nonnegative().default(0),
});
type Waiting = z.infer<typeof Waiting>;

const State = z.object({
  since: z.number().optional(),
  lastLookAt: z.number().optional(),
  mail: z.record(z.string(), z.unknown()).default({}),
  calendar: z.record(z.string(), z.unknown()).default({}),
  seen: z.array(z.string()).default([]),
  waiting: z.array(Waiting).default([]),
  problem: z
    .object({
      message: z.string(),
      fix: z
        .object({ label: z.string(), place: z.string(), focus: z.string().optional() })
        .optional(),
    })
    .optional(),
  held: z.string().optional(),
});
type State = z.infer<typeof State>;

export interface CheckInDeps {
  home: string;
  orders: StandingOrderStore;
  /** The When-routines' own sources (ADR 0056): absent, that kind isn't looked at. */
  sources: { mail?: TriggerSource<'mail'>; calendar?: TriggerSource<'calendar'> };
  /** The default provider's cheapest model (`cheapModel`). */
  model: CheapModel;
  /** Routine spending (ADR 0057): may a look that costs money go now, and what it cost (USD). */
  spend?: {
    allow(): Promise<{ ok: true } | { ok: false; message: string }>;
    record(usage: Usage | undefined, model?: string): Promise<number | undefined>;
  };
  /** Tell the person: Web Push and their chat apps. */
  tell: (thing: ToldThing, order: StandingOrder) => Promise<void>;
  /** Resource admission (ADR 0094): automatic work waits in recovery. */
  allowed?: () => boolean;
  timezone?: () => string;
  now?: () => number;
  heal?: Heal;
  /** A source that came back: a “Fixed on its own” note. */
  onHeal?: (message: string) => void;
  changed?: (status: CheckInStatus) => void;
}

/** Minutes past midnight on the person's clock. */
export function minutesIn(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (n('hour') % 24) * 60 + n('minute');
}

/** When quiet hours end, from `at` (within a day, to five minutes). */
export function quietEnds(at: number, quiet: QuietHours, timeZone: string): number {
  let t = at;
  for (let i = 0; i < 24 * 12 && inQuietHours(minutesIn(t, timeZone), quiet); i++) t += 5 * MINUTE;
  return t;
}

const monthKey = (at: number) => new Date(at).toISOString().slice(0, 7);
const short = (id: string) => createHash('sha256').update(id).digest('base64url').slice(0, 16);
const httpsLink = (link: string | undefined) => {
  if (!link) return undefined;
  try {
    return new URL(link).protocol === 'https:' && link.length <= 2000 ? link : undefined;
  } catch {
    return undefined;
  }
};

export class CheckIns {
  #settings?: Promise<Settings>;
  #state?: Promise<State>;
  #timer?: NodeJS.Timeout;
  #looking?: Promise<void>;
  readonly #mutex = new Mutex();

  constructor(private readonly deps: CheckInDeps) {}

  get #now() {
    return (this.deps.now ?? Date.now)();
  }

  get #zone() {
    return this.deps.timezone?.() ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }

  get #settingsPath() {
    return join(this.deps.home, 'checkin.json');
  }

  get #statePath() {
    return join(this.deps.home, 'checkin', 'state.json');
  }

  #readSettings(): Promise<Settings> {
    this.#settings ??= readStore(this.#settingsPath, Settings, {
      onRepair: () => this.deps.heal?.('routines', 'Repaired the check-in’s settings'),
    }).then((r) => r.value);
    return this.#settings;
  }

  #readState(): Promise<State> {
    // Only bookkeeping: a damaged file starts looking from now, said once.
    this.#state ??= readStore(this.#statePath, State, {
      onRepair: () => this.deps.heal?.('routines', 'Started the check-in’s bookkeeping again'),
    }).then((r) => r.value);
    return this.#state;
  }

  async #save(settings: Settings, state: State) {
    this.#settings = Promise.resolve(settings);
    this.#state = Promise.resolve(state);
    await writeJson(this.#settingsPath, settings);
    await writeJson(this.#statePath, state);
    this.deps.changed?.(await this.status());
  }

  async status(): Promise<CheckInStatus> {
    const [settings, state, orders] = await Promise.all([
      this.#readSettings(),
      this.#readState(),
      this.deps.orders.active('tell'),
    ]);
    const now = this.#now;
    const month = settings.month.key === monthKey(now) ? settings.month : undefined;
    const quietNow = inQuietHours(minutesIn(now, this.#zone), settings.quiet);
    const every = settings.everyMinutes * MINUTE;
    const base = {
      on: settings.on,
      quiet: settings.quiet,
      everyMinutes: settings.everyMinutes,
      ...(state.lastLookAt && { lastLookAt: state.lastLookAt }),
      month: { looks: month?.looks ?? 0, woke: month?.woke ?? 0, usd: month?.usd ?? 0 },
      told: settings.told.slice(0, KEEP_TOLD),
    };
    if (!settings.on) return { ...base, state: 'off' };
    if (!orders.length)
      return {
        ...base,
        state: 'resting',
        message: 'Tell Conch something you want to hear about, and it starts looking.',
      };
    if (state.problem)
      return {
        ...base,
        state: 'needs-you',
        message: state.problem.message,
        ...(state.problem.fix && { fix: state.problem.fix }),
      };
    const next = quietNow
      ? quietEnds(now, settings.quiet, this.#zone)
      : Math.max(now, (state.lastLookAt ?? 0) + every);
    if (state.held) return { ...base, state: 'held', message: state.held, nextLookAt: next };
    if (quietNow)
      return {
        ...base,
        state: 'quiet',
        message: 'Quiet hours: it looks again once they’re over.',
        nextLookAt: next,
      };
    return { ...base, state: 'watching', nextLookAt: next };
  }

  /** A person's choices (`PUT /api/checkin`): on or off, quiet hours, how often. */
  async configure(body: CheckInBody): Promise<CheckInStatus> {
    await this.#mutex.run(async () => {
      const [settings, state] = await Promise.all([this.#readSettings(), this.#readState()]);
      const next: Settings = {
        ...settings,
        ...(body.on !== undefined && { on: body.on }),
        ...(body.quiet && { quiet: body.quiet }),
        ...(body.everyMinutes !== undefined && { everyMinutes: body.everyMinutes }),
      };
      // Turned off: when it's back, it starts from then, not with everything since.
      const fresh = body.on === false ? { ...state, since: undefined, waiting: [] } : state;
      await this.#save(next, fresh);
    });
    return this.status();
  }

  /** Something it told you, put away from the list. */
  async forget(id: string): Promise<CheckInStatus> {
    await this.#mutex.run(async () => {
      const [settings, state] = await Promise.all([this.#readSettings(), this.#readState()]);
      await this.#save({ ...settings, told: settings.told.filter((t) => t.id !== id) }, state);
    });
    return this.status();
  }

  /**
   * One look. `now`: a person pressed Look now, so neither the half hour nor
   * quiet hours hold it (spending still does). One at a time.
   */
  look({ now = false }: { now?: boolean } = {}): Promise<void> {
    this.#looking ??= this.#mutex
      .run(() => this.#look(now))
      .finally(() => {
        this.#looking = undefined;
      });
    return this.#looking;
  }

  async #look(asked: boolean): Promise<void> {
    const [settings, state] = await Promise.all([this.#readSettings(), this.#readState()]);
    if (!settings.on) return;
    const orders = await this.deps.orders.active('tell');
    // Nothing anyone asked to hear about: nothing is looked at, nothing spent.
    if (!orders.length) return;
    const now = this.#now;
    if (!asked) {
      if (inQuietHours(minutesIn(now, this.#zone), settings.quiet)) return;
      if (state.lastLookAt && now - state.lastLookAt < settings.everyMinutes * MINUTE - 5_000)
        return;
      if (this.deps.allowed && !this.deps.allowed()) return;
    }
    const month = settings.month.key === monthKey(now) ? settings.month : undefined;
    settings.month = {
      key: monthKey(now),
      looks: (month?.looks ?? 0) + 1,
      woke: month?.woke ?? 0,
      usd: month?.usd ?? 0,
    };
    state.since ??= now;
    state.lastLookAt = now;
    const since = Math.max(state.since, now - BACKLOG_MS);

    // What's new, with no model.
    const found: Waiting[] = [];
    const failures: SourceError[] = [];
    let tried = 0;
    const signal = AbortSignal.timeout(60_000);
    const gather = async <K extends 'mail' | 'calendar'>(
      kind: K,
      source: TriggerSource<K> | undefined,
      trigger: TriggerOf<K>,
    ) => {
      if (!source?.check) return;
      tried += 1;
      try {
        const result = await source.check({
          routineId: 'check-in',
          title: 'Check-in',
          trigger,
          since,
          state: { ...state[kind] },
          now,
          signal,
        });
        if (result.state) state[kind] = result.state;
        for (const h of result.happenings) found.push(this.#waiting(kind, h));
      } catch (error) {
        failures.push(
          error instanceof SourceError
            ? error
            : new SourceError('retry', 'It couldn’t look just now. Conch will look again.'),
        );
      }
    };
    await gather('mail', this.deps.sources.mail, MAIL);
    await gather('calendar', this.deps.sources.calendar, CALENDAR);

    // Only a person can fix it when nothing it reads can be read.
    const had = state.problem;
    const stuck = tried > 0 && failures.length === tried;
    const needsYou = failures.find((f) => f.kind === 'needs-you');
    if (tried === 0 || (stuck && needsYou)) {
      state.problem = {
        message:
          tried === 0 || failures.every((f) => f.kind === 'needs-you')
            ? 'Connect Gmail or Google Calendar so the check-in has something to look at.'
            : (needsYou?.message ?? 'It can’t look right now.'),
        fix: needsYou?.fix ?? { label: 'Open Apps', place: 'integrations' },
      };
    } else if (!stuck) {
      delete state.problem;
      if (had) this.deps.onHeal?.('The check-in can look again');
    }

    const seen = new Set(state.seen);
    for (const thing of found) {
      if (seen.has(thing.id)) continue;
      seen.add(thing.id);
      state.waiting.push(thing);
    }
    state.seen = [...seen].slice(-500);
    state.waiting = state.waiting.slice(-MAX_WAITING);
    if (!state.waiting.length) {
      delete state.held;
      return this.#save(settings, state);
    }

    // Something new: is it worth a cheap look now?
    const allowed = (await this.deps.spend?.allow().catch(() => ({ ok: true }) as const)) ?? {
      ok: true,
    };
    if (!allowed.ok) {
      state.held = allowed.message;
      return this.#save(settings, state);
    }
    delete state.held;
    const batch = state.waiting.slice(0, PER_LOOK);
    const judged = await judge(this.deps.model, orders, batch, signal);
    const usd = await this.deps.spend?.record(judged.usage, judged.model).catch(() => undefined);
    if (judged.ok || judged.reason !== 'no-model') settings.month.woke += 1;
    if (usd) settings.month.usd += usd;
    if (!judged.ok) {
      if (judged.reason === 'no-model') {
        state.held = 'No connected provider can read it right now. It waits for one.';
        return this.#save(settings, state);
      }
      // Tried twice and still nothing readable: let it go rather than ask forever.
      const ids = new Set(batch.map((b) => b.id));
      state.waiting = state.waiting
        .map((w) => (ids.has(w.id) ? { ...w, tries: w.tries + 1 } : w))
        .filter((w) => w.tries < 2);
      return this.#save(settings, state);
    }
    const done = new Set(batch.map((b) => b.id));
    state.waiting = state.waiting.filter((w) => !done.has(w.id));

    let today = settings.told.filter((t) => !t.quiet && t.at > now - DAY).length;
    const told: { thing: ToldThing; order: StandingOrder }[] = [];
    for (const pick of judged.picks) {
      const thing = batch[pick.item];
      const order = orders[pick.order];
      if (!thing || !order) continue;
      const link = httpsLink(thing.link);
      const quiet = today >= DAILY_TELLS;
      if (!quiet) today += 1;
      told.push({
        order,
        thing: {
          id: short(thing.id),
          at: now,
          source: thing.source,
          label: thing.label.replace(/\s+/g, ' ').slice(0, 200),
          ...(pick.note && { note: pick.note }),
          why: `You asked: “${order.text}”`.slice(0, 300),
          orderId: order.id,
          ...(link && { link }),
          ...(quiet && { quiet: true }),
        },
      });
    }
    settings.told = [...told.map((t) => t.thing).reverse(), ...settings.told].slice(0, KEEP_TOLD);
    await this.#save(settings, state);
    for (const { thing, order } of told) {
      await this.deps.orders.told(order.id, now).catch(() => undefined);
      if (!thing.quiet) await this.deps.tell(thing, order).catch(() => undefined);
    }
  }

  #waiting(source: 'mail' | 'calendar', h: Happening): Waiting {
    return {
      id: h.id,
      at: h.at,
      label: h.label,
      detail: h.detail.slice(0, 1_500),
      ...(h.link && { link: h.link }),
      source,
      tries: 0,
    };
  }

  /** Every minute: a look when one is due. */
  start() {
    const tick = () => void this.look().catch(() => undefined);
    tick();
    this.#timer = setInterval(tick, MINUTE);
    this.#timer.unref?.();
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
  }
}
