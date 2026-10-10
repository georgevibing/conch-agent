/**
 * How many tasks start, and which (ADR 0128). Not a fixed count: every time
 * something changes (a task finishes, one is added, the computer's readings
 * move, a provider asks to slow down), `schedule` works out what fits now.
 *
 * - **This computer.** Each task has a cost (processor and memory) from its
 *   estimate and from how its provider runs: a program of its own on this
 *   computer, a model here, or a model somewhere else. What's working must fit
 *   what the computer can spare (`allocatable`), and the next one must also
 *   fit what the live readings say is free, less what tasks that started a
 *   moment ago will soon use (they aren't in the readings yet). Automatic work
 *   only starts when the gateway's own admission says it may (ADR 0094,
 *   `recovery/pace.ts` through `GatewayRecovery.allowsWork`).
 * - **Bounds.** Never more than a ceiling from the processor count; and when
 *   nothing of Conch's is working, one always may (a heavy task bigger than
 *   the whole budget still runs, alone).
 * - **Hysteresis.** Once a task waited for memory or the processor, the next
 *   needs a quarter more than its cost free before it starts, so a reading
 *   that wobbles doesn't start and hold work by turns.
 * - **Order.** Fair across chats: the next is from the chat with the fewest
 *   working, oldest first, so one chat's big batch can't starve another's one
 *   task. Parts of one batch start together when all of them fit. One that has
 *   waited long is first, and what it needs is kept for it.
 * - **Conflicts.** Two tasks that change the same thing never run together,
 *   and one the planner put after another waits for it.
 * - **Providers.** Each has a pace of its own (`ProviderPace`): it halves when
 *   the provider says slow down or is overloaded, waits as long as it asked,
 *   and comes back one at a time after a calm spell.
 *
 * Everything that waits says why, in a few words, and when that's known.
 */
import type {
  EngineId,
  TaskCapacity,
  TaskEstimate,
  TaskKind,
  TaskWaitReason,
  TaskWaiting,
  TaskWeight,
} from '@conch/protocol';

import type { WorkloadPace } from '../recovery/pace';
import { memoryReserve, type ResourceSnapshot } from '../recovery/resources';

/** How a provider's work sits on this computer. */
export type Footprint = 'process' | 'remote' | 'local-model';

export interface Cost {
  /** Processors, as a share of one. */
  cpu: number;
  /** Bytes. */
  memory: number;
}

const MiB = 1024 * 1024;
const BASE: Record<TaskWeight, Cost> = {
  light: { cpu: 0.25, memory: 192 * MiB },
  medium: { cpu: 0.5, memory: 384 * MiB },
  heavy: { cpu: 1, memory: 1024 * MiB },
};
const OVERHEAD: Record<Footprint, Cost> = {
  // Its own program here (a coding agent, a vendor's CLI): a process and its memory.
  process: { cpu: 0.25, memory: 256 * MiB },
  // A model somewhere else: Conch only streams what it says.
  remote: { cpu: 0.05, memory: 32 * MiB },
  // A model on this computer: it shares the processor (and memory) with everything else.
  'local-model': { cpu: 0.5, memory: 512 * MiB },
};

/** What a task with this estimate asks of this computer while it works. */
export function costOf(
  estimate: Pick<TaskEstimate, 'weight' | 'uses'>,
  footprint: Footprint,
): Cost {
  const base = BASE[estimate.weight];
  let { cpu, memory } = base;
  const uses = new Set(estimate.uses);
  if (uses.has('cpu')) cpu *= 2;
  if (uses.has('memory')) memory *= 2;
  if (uses.has('disk')) cpu += 0.25;
  // Mostly waiting on the network or the model: little of this computer.
  if (uses.size > 0 && [...uses].every((use) => use === 'network' || use === 'model')) {
    cpu *= 0.5;
    memory *= 0.5;
  }
  // A model somewhere else does the thinking: only what the task runs here counts.
  if (footprint === 'remote' && !uses.has('cpu') && !uses.has('disk')) cpu *= 0.5;
  return { cpu: cpu + OVERHEAD[footprint].cpu, memory: memory + OVERHEAD[footprint].memory };
}

/** Never more than this many at once, however roomy the computer. */
export const MOST_AT_ONCE = 12;
/** "Start now" may go this far past the ceiling, and no further. */
export const START_NOW_EXTRA = 2;
/** A task that started this recently isn't in the readings yet: its cost is kept aside. */
export const WARM_MS = 60_000;
/** Waited this long: it goes first, and what it needs is kept for it. */
export const AGED_MS = 90_000;
/** Gateway, browser and the person's own apps: never handed to tasks. */
const GATEWAY = 512 * MiB;
/** Once tight, this much more than a task's cost must be free before it starts. */
const MARGIN = 1.25;

/** The most at once for this many processors: twice as many, from 2 to `MOST_AT_ONCE`. */
export function ceilingFor(cpuCount: number): number {
  return Math.max(2, Math.min(MOST_AT_ONCE, Math.floor(cpuCount) * 2));
}

/** What the gateway knows about this computer now. */
export interface Machine {
  /** Automatic work may start now (`GatewayRecovery.allowsWork`). */
  allowed: boolean;
  /** Work the person asked for just now may start while it's merely busy (`allowsPlanned`). */
  planned: boolean;
  cpuCount: number;
  /** The latest reading, when there is one: none in tests, and before the first sample. */
  snapshot?: Pick<ResourceSnapshot, 'totalBytes' | 'availableBytes' | 'loadPerCpu'>;
  /** The shared pace (ADR 0094), for why automatic work is held. */
  pace?: Pick<WorkloadPace, 'phase' | 'cause' | 'critical'>;
  /** Managed commands running (`ProcessService`): each is held to take half a processor. */
  commands?: number;
}

/** One task, as the scheduler sees it. */
export interface Slot {
  id: string;
  title: string;
  kind: TaskKind;
  /** The chat it came from (or its own, from none): fairness is across these. */
  chat: string;
  group?: string;
  engine: EngineId;
  /** The provider by name, for the words. */
  provider: string;
  footprint: Footprint;
  estimate: Pick<TaskEstimate, 'weight' | 'uses' | 'minutes'>;
  /** What it changes, each scoped to the folder it works in. */
  touches: readonly string[];
  /** Tasks it starts after. */
  after: readonly string[];
  createdAt: number;
  startedAt?: number;
  /** The person pressed "Start now". */
  startNow?: boolean;
}

/** A provider's room now. */
export interface ProviderRoom {
  limit: number;
  /** It asked to slow down until then. */
  retryAt?: number;
}

/** Hysteresis kept between passes. */
export interface Tight {
  memory?: boolean;
  cpu?: boolean;
}

export interface ScheduleInput {
  now: number;
  machine: Machine;
  running: readonly Slot[];
  queued: readonly Slot[];
  provider: (slot: Slot) => ProviderRoom;
  /** A fixed most-at-once per kind (tests; unset in Conch). */
  caps?: Partial<Record<TaskKind, number>>;
  tight?: Tight;
}

export interface Schedule {
  /** To start now, in this order. */
  start: string[];
  /** Why each of the rest waits. */
  waiting: Map<string, TaskWaiting>;
  capacity: TaskCapacity;
  tight: Tight;
  /** Look again by then (a provider's pause ends). */
  wakeAt?: number;
}

const ROOM_REASONS: ReadonlySet<TaskWaitReason> = new Set(['room', 'memory', 'cpu']);
const quoted = (title: string) => `“${title.length > 48 ? `${title.slice(0, 47)}…` : title}”`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ends = (slot: Slot) =>
  slot.startedAt !== undefined ? slot.startedAt + slot.estimate.minutes * 60_000 : undefined;

/** What a shared touch is, in a word: a file's name, "the same files" for a pair the planner set. */
function thing(touch: string): string {
  const plain = touch.slice(touch.indexOf('\u0000') + 1);
  if (plain.startsWith('pair:')) return 'the same files';
  const name = plain.replace(/\/+$/, '').split('/').at(-1) ?? plain;
  return name.length > 40 ? `${name.slice(0, 39)}…` : name;
}

/** Work out what starts now, and why the rest waits. Pure: same input, same answer. */
export function schedule(input: ScheduleInput): Schedule {
  const { now, machine } = input;
  const cpuCount = Math.max(1, machine.cpuCount);
  const ceiling = ceilingFor(cpuCount);
  const snap = machine.snapshot;
  const reserve = snap ? memoryReserve(snap.totalBytes) : 0;
  const allocatable: Cost = {
    cpu: Math.max(1, cpuCount - 1 - Math.max(0, machine.commands ?? 0) * 0.5),
    memory: snap ? Math.max(0, snap.totalBytes - reserve - GATEWAY) : Infinity,
  };
  const tight: Tight = {};
  const cost = new Map<string, Cost>();
  const costFor = (slot: Slot) => {
    let found = cost.get(slot.id);
    if (!found) cost.set(slot.id, (found = costOf(slot.estimate, slot.footprint)));
    return found;
  };

  // Everything working, and what this pass adds.
  const active: Slot[] = [...input.running];
  const used: Cost = { cpu: 0, memory: 0 };
  const warming: Cost = { cpu: 0, memory: 0 };
  const byChat = new Map<string, number>();
  const byEngine = new Map<string, number>();
  const byKind = new Map<TaskKind, number>();
  const add = (slot: Slot, at: number | undefined) => {
    const c = costFor(slot);
    used.cpu += c.cpu;
    used.memory += c.memory;
    // Not in the readings yet: kept aside from what they say is free.
    if (at === undefined || now - at < WARM_MS) {
      warming.cpu += c.cpu;
      warming.memory += c.memory;
    }
    byChat.set(slot.chat, (byChat.get(slot.chat) ?? 0) + 1);
    byEngine.set(slot.engine, (byEngine.get(slot.engine) ?? 0) + 1);
    byKind.set(slot.kind, (byKind.get(slot.kind) ?? 0) + 1);
  };
  for (const slot of input.running) add(slot, slot.startedAt);

  const free = (): Cost => ({
    memory: snap ? snap.availableBytes - reserve * 2 - warming.memory : Infinity,
    cpu: snap ? cpuCount * 0.9 - snap.loadPerCpu * cpuCount - warming.cpu : Infinity,
  });
  const kept: Cost = { cpu: 0, memory: 0 };
  const queuedIds = new Set(input.queued.map((slot) => slot.id));
  const going = new Set([...input.running.map((slot) => slot.id), ...queuedIds]);
  const start: string[] = [];
  const started = new Set<string>();
  const waiting = new Map<string, TaskWaiting>();

  /** About when one of what's working should finish. */
  const nextEnd = (slots: readonly Slot[]) => {
    const times = slots.flatMap((slot) => {
      const end = ends(slot);
      return end !== undefined && end > now ? [end] : [];
    });
    return times.length ? Math.min(...times) : undefined;
  };
  const wait = (
    slot: Slot,
    reason: TaskWaitReason,
    words: string,
    extra: Partial<TaskWaiting> = {},
  ): TaskWaiting => ({
    reason,
    words,
    canStartNow: false,
    ...extra,
    ...(slot.startNow && { canStartNow: false }),
  });
  const heavy = () => active.filter((slot) => slot.estimate.weight === 'heavy').length;
  const busy = () =>
    active.filter((slot) => slot.estimate.weight === 'heavy' || slot.estimate.uses.includes('cpu'))
      .length;
  const commands = Math.max(0, machine.commands ?? 0);
  const memoryWords = () =>
    heavy()
      ? `Waiting for memory: ${plural(heavy(), 'heavy task', 'heavy tasks')} working`
      : 'Waiting for memory to free up on this computer';
  const cpuWords = () =>
    busy()
      ? `Waiting for the processor: ${plural(busy(), 'busy task', 'busy tasks')} working`
      : commands
        ? `Waiting for the processor: ${plural(commands, 'command', 'commands')} running`
        : 'Waiting for the processor: this computer is busy';
  const roomWords = () => {
    const [only] = active;
    return active.length === 1 && only
      ? `Starts when ${quoted(only.title)} finishes`
      : `Starts when one of the ${active.length} working finishes`;
  };

  /** Why `slot` can't start now, or undefined when it can. */
  const check = (slot: Slot): TaskWaiting | undefined => {
    // 1. After another of its batch.
    const before = slot.after.filter((id) => going.has(id) && id !== slot.id);
    if (before.length) {
      const first = [...input.running, ...input.queued].find((s) => s.id === before[0]);
      const words = first
        ? before.length === 1
          ? `Starts after ${quoted(first.title)}`
          : `Starts after ${quoted(first.title)} and ${plural(before.length - 1, 'other', 'others')}`
        : 'Starts after another task of its batch';
      const end = first && nextEnd([first]);
      return wait(slot, 'after', words, {
        on: before.slice(0, 12),
        ...(end && { expectedAt: end }),
      });
    }
    // 2. Changes what's being changed: after whoever has it, working or ahead in line.
    if (slot.touches.length) {
      const mine = new Set(slot.touches);
      const holder =
        active.find((other) => other.touches.some((t) => mine.has(t))) ??
        input.queued.find(
          (other) =>
            other.id !== slot.id &&
            !started.has(other.id) &&
            (other.createdAt < slot.createdAt ||
              (other.createdAt === slot.createdAt && other.id < slot.id)) &&
            other.touches.some((t) => mine.has(t)),
        );
      if (holder) {
        const shared = holder.touches.find((t) => mine.has(t)) ?? '';
        const working = active.includes(holder);
        const end = working ? nextEnd([holder]) : undefined;
        return wait(
          slot,
          'conflict',
          `${working ? 'Starts when' : 'Starts after'} ${quoted(holder.title)}${working ? ' finishes' : ''}: both change ${thing(shared)}`,
          { on: [holder.id], ...(end && { expectedAt: end }) },
        );
      }
    }
    // 3. The gateway's own admission (ADR 0094): nothing automatic starts while it says no.
    const forced = slot.startNow === true;
    if (!machine.allowed && !(forced && machine.planned)) {
      const pace = machine.pace;
      if (pace?.cause === 'memory') return wait(slot, 'memory', memoryWords());
      if (pace?.cause === 'cpu')
        return wait(slot, 'cpu', cpuWords(), { canStartNow: machine.planned });
      return wait(
        slot,
        'recovering',
        pace?.cause === 'recovery'
          ? 'Waiting while Conch recovers'
          : 'Checking this computer has room',
      );
    }
    // 4. Its provider's pace.
    const room = input.provider(slot);
    if (room.retryAt !== undefined && room.retryAt > now)
      return wait(slot, 'provider', `${slot.provider} asked Conch to slow down`, {
        retryAt: room.retryAt,
      });
    const withIt = byEngine.get(slot.engine) ?? 0;
    if (withIt >= Math.max(1, room.limit))
      return wait(slot, 'provider-busy', `${slot.provider} is already doing ${withIt} at once`, {
        on: active
          .filter((s) => s.engine === slot.engine)
          .map((s) => s.id)
          .slice(0, 12),
        ...(nextEnd(active.filter((s) => s.engine === slot.engine)) && {
          expectedAt: nextEnd(active.filter((s) => s.engine === slot.engine)),
        }),
      });
    // 5. A fixed most per kind (tests).
    const cap = input.caps?.[slot.kind];
    if (cap !== undefined && !forced && (byKind.get(slot.kind) ?? 0) >= cap)
      return wait(slot, 'room', roomWords(), {
        canStartNow: machine.planned,
        ...(nextEnd(active) && { expectedAt: nextEnd(active) }),
      });
    // 6. The ceiling. "Start now" may go a little past it, never far.
    if (active.length >= ceiling + (forced ? START_NOW_EXTRA : 0))
      return wait(slot, 'room', roomWords(), {
        canStartNow: !forced && machine.planned && active.length < ceiling + START_NOW_EXTRA,
        ...(nextEnd(active) && { expectedAt: nextEnd(active) }),
      });
    // 7. The floor: with nothing working, one always may.
    if (active.length === 0) return undefined;
    const c = costFor(slot);
    // 8. Live memory: never pushed past, not even by "Start now".
    const f = free();
    const memoryNeed = c.memory * (input.tight?.memory ? MARGIN : 1) + (forced ? 0 : kept.memory);
    if (memoryNeed > f.memory) {
      tight.memory = true;
      return wait(slot, 'memory', memoryWords(), {
        ...(nextEnd(active) && { expectedAt: nextEnd(active) }),
      });
    }
    if (forced) return undefined;
    // 9. What this computer can spare for tasks at all.
    if (
      used.cpu + c.cpu + kept.cpu > allocatable.cpu ||
      used.memory + c.memory + kept.memory > allocatable.memory
    )
      return wait(slot, 'room', roomWords(), {
        canStartNow: machine.planned && active.length < ceiling + START_NOW_EXTRA,
        ...(nextEnd(active) && { expectedAt: nextEnd(active) }),
      });
    // 10. The processor, live. A light one starts while it's only a little busy.
    const cpuNeed = c.cpu * (input.tight?.cpu ? MARGIN : 1) + kept.cpu;
    if (cpuNeed > Math.max(0.5, f.cpu)) {
      tight.cpu = true;
      return wait(slot, 'cpu', cpuWords(), {
        canStartNow: machine.planned && active.length < ceiling + START_NOW_EXTRA,
        ...(nextEnd(active) && { expectedAt: nextEnd(active) }),
      });
    }
    return undefined;
  };

  const admit = (slot: Slot) => {
    start.push(slot.id);
    started.add(slot.id);
    active.push(slot);
    add(slot, undefined);
  };
  const aged = (slot: Slot) => slot.startNow || now - slot.createdAt >= AGED_MS;

  // Fair order, looked at afresh after each start: aged first ("Start now" first of all),
  // then the chat with the fewest working, then the oldest.
  const open = () => input.queued.filter((slot) => !started.has(slot.id) && !waiting.has(slot.id));
  const rank = (a: Slot, b: Slot) =>
    Number(Boolean(b.startNow)) - Number(Boolean(a.startNow)) ||
    Number(aged(b)) - Number(aged(a)) ||
    (byChat.get(a.chat) ?? 0) - (byChat.get(b.chat) ?? 0) ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id);
  for (;;) {
    const next = open().sort(rank)[0];
    if (!next) break;
    const why = check(next);
    if (why) {
      waiting.set(next.id, why);
      // Head of the line, waiting for room: what it needs is kept for it.
      if (aged(next) && ROOM_REASONS.has(why.reason)) {
        const c = costFor(next);
        kept.cpu += c.cpu;
        kept.memory += c.memory;
      }
      continue;
    }
    admit(next);
    // The rest of its batch starts with it when all of it fits now.
    if (next.group) {
      const rest = open()
        .filter((slot) => slot.group === next.group)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      if (rest.length && fitsTogether(rest)) for (const slot of rest) admit(slot);
    }
  }

  /** Would all of `slots` start, one after another, from here? Leaves nothing changed. */
  function fitsTogether(slots: readonly Slot[]): boolean {
    const saved = {
      used: { ...used },
      warming: { ...warming },
      byChat: new Map(byChat),
      byEngine: new Map(byEngine),
      byKind: new Map(byKind),
      active: active.length,
      start: start.length,
      started: new Set(started),
      tight: { ...tight },
    };
    let ok = true;
    for (const slot of slots) {
      if (check(slot)) {
        ok = false;
        break;
      }
      admit(slot);
    }
    used.cpu = saved.used.cpu;
    used.memory = saved.used.memory;
    warming.cpu = saved.warming.cpu;
    warming.memory = saved.warming.memory;
    byChat.clear();
    for (const [k, v] of saved.byChat) byChat.set(k, v);
    byEngine.clear();
    for (const [k, v] of saved.byEngine) byEngine.set(k, v);
    byKind.clear();
    for (const [k, v] of saved.byKind) byKind.set(k, v);
    active.length = saved.active;
    start.length = saved.start;
    started.clear();
    for (const id of saved.started) started.add(id);
    delete tight.memory;
    delete tight.cpu;
    Object.assign(tight, saved.tight);
    return ok;
  }

  // Look again when a provider's pause ends.
  const retries = [...waiting.values()].flatMap((w) => (w.retryAt ? [w.retryAt] : []));
  const wakeAt = retries.length ? Math.min(...retries) : undefined;

  // How many at once now, in a number: what's working when room is what holds the rest
  // back; otherwise about how many tasks of a usual size would fit.
  const roomBound = [...waiting.values()].some((w) => ROOM_REASONS.has(w.reason));
  const typical = costOf(
    { weight: 'medium', uses: [] },
    [...input.running, ...input.queued][0]?.footprint ?? 'process',
  );
  const f = free();
  const fit = Math.min(
    ceiling,
    Math.floor(allocatable.cpu / typical.cpu),
    Math.floor(allocatable.memory / typical.memory),
    active.length + Math.max(0, Math.floor(f.memory / typical.memory)),
    active.length + Math.max(0, Math.floor(f.cpu / typical.cpu)),
  );
  const atOnce = !machine.allowed || roomBound ? active.length : Math.max(active.length, fit, 1);
  const holding = [...waiting.values()].find(
    (w) => ROOM_REASONS.has(w.reason) || w.reason === 'recovering',
  );
  return {
    start,
    waiting,
    tight,
    ...(wakeAt !== undefined && { wakeAt }),
    capacity: {
      atOnce,
      working: active.length,
      waiting: waiting.size,
      ...(holding && {
        words:
          holding.reason === 'recovering'
            ? holding.words
            : holding.reason === 'memory'
              ? `${active.length} at once while memory is short`
              : holding.reason === 'cpu'
                ? `${active.length} at once while the processor is busy`
                : `${active.length} at once on this computer right now`,
      }),
    },
  };
}

/** A provider's own pace (ADR 0128): halve on "slow down", come back one at a time. */
interface PaceState {
  limit: number;
  base: number;
  strikes: number;
  retryAt?: number;
  lastStrike?: number;
  raisedAt?: number;
}

/** How many at once a provider takes to begin with, by how it runs. */
export const PROVIDER_START: Record<Footprint, number> = {
  'local-model': 1,
  process: 6,
  remote: 8,
};
/** Calm this long after a "slow down" before it gets one more. */
export const CALM_MS = 120_000;
/** Then one more every this long. */
export const STEP_MS = 60_000;
const FIRST_PAUSE_MS = 20_000;
const LONGEST_PAUSE_MS = 120_000;

/**
 * Each provider's pace: additive increase, multiplicative decrease. A
 * rate limit or an overload halves how many it's given at once (never below
 * one) and pauses new work for as long as it asked, or 20s, doubling with
 * each strike up to two minutes (so a provider's own limit still reaches the
 * fallback, ADR 0126). After two calm minutes, one more at a time, each a
 * minute apart, back to where it started. Only ever in memory: a restart
 * starts afresh.
 */
export class ProviderPace {
  readonly #state = new Map<string, PaceState>();

  constructor(private readonly now: () => number = Date.now) {}

  #of(engine: string, footprint: Footprint): PaceState {
    let state = this.#state.get(engine);
    if (!state) {
      const base = PROVIDER_START[footprint];
      this.#state.set(engine, (state = { limit: base, base, strikes: 0 }));
    }
    return state;
  }

  room(engine: string, footprint: Footprint): ProviderRoom {
    const state = this.#of(engine, footprint);
    const now = this.now();
    if (state.lastStrike !== undefined && state.limit < state.base) {
      const calm = now - state.lastStrike >= CALM_MS;
      const stepped = state.raisedAt === undefined || now - state.raisedAt >= STEP_MS;
      if (calm && stepped) {
        state.limit += 1;
        state.raisedAt = now;
      }
    }
    if (state.lastStrike !== undefined && now - state.lastStrike >= CALM_MS * 5) state.strikes = 0;
    return {
      limit: state.limit,
      ...(state.retryAt !== undefined && state.retryAt > now && { retryAt: state.retryAt }),
    };
  }

  /** The provider said slow down, or is overloaded. */
  slowDown(engine: string, footprint: Footprint, retryAfterMs?: number): ProviderRoom {
    const state = this.#of(engine, footprint);
    const now = this.now();
    state.limit = Math.max(1, Math.floor(state.limit / 2));
    state.strikes = Math.min(state.strikes + 1, 6);
    const pause = Math.min(
      LONGEST_PAUSE_MS,
      Math.max(5_000, retryAfterMs ?? FIRST_PAUSE_MS * 2 ** (state.strikes - 1)),
    );
    state.retryAt = Math.max(state.retryAt ?? 0, now + pause);
    state.lastStrike = now;
    state.raisedAt = undefined;
    return this.room(engine, footprint);
  }
}
