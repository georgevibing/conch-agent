/**
 * When… (ADR 0056): everything a routine that starts from what happens needs,
 * behind one object the routine service talks to: checking and describing
 * triggers, keeping them (`routines/when/`), the pulse that watches, and the
 * secrets of other apps' addresses.
 */
import type { TaintSource, Trigger, TriggerKind, WatchState, WhenPreview } from '@conch/protocol';
import { WHEN_SCHEDULE } from '@conch/protocol';

import type { Heal } from '../../lib/recover';
import { newHookId, type HookSecrets } from './hook';
import { Pulse, type FiredBatch, type FireResult, type PulseRoutine, type Sources } from './pulse';
import type { Judge } from './onlyif';
import { WhenStore, type WhenFile } from './store';
import { TriggerError, type Happening, type PulseSpend } from './types';

export { Pulse, type FiredBatch, type FireResult } from './pulse';
export { TriggerError, type PulseSpend } from './types';

/** Whether a stored schedule is a When-routine's placeholder (ADR 0056). */
export function isWhenSchedule(schedule: { type: string; at?: string }): boolean {
  return schedule.type === 'once' && schedule.at === WHEN_SCHEDULE.at;
}

export interface WhenDeps {
  routinesDir: string;
  sources: Sources;
  secrets: HookSecrets;
  /** The address another app uses, while the door is on. */
  hookUrl?: (hookId: string) => string | undefined;
  judge?: Judge;
  spend?: PulseSpend;
  heal?: Heal;
  onHeal?: (message: string) => void;
  now?: () => number;
  beatMs?: number;
}

/** What the routine service gives the pulse. */
export interface WhenBinding {
  /** Every When-routine, on or not. */
  routines: () => Promise<PulseRoutine[]>;
  fire: (id: string, batch: FiredBatch) => Promise<FireResult>;
  /** Its watch state changed: show the routine again. */
  changed: (id: string) => void;
}

export class WhenRoutines {
  readonly store: WhenStore;
  readonly pulse: Pulse;
  #bound?: WhenBinding;

  constructor(private readonly deps: WhenDeps) {
    this.store = new WhenStore(deps.routinesDir, deps.heal);
    this.pulse = new Pulse({
      store: this.store,
      sources: deps.sources,
      routines: () => this.#bound?.routines() ?? Promise.resolve([]),
      fire: (id, batch) => this.#bound?.fire(id, batch) ?? Promise.resolve('gone' as const),
      ...(deps.judge && { judge: deps.judge }),
      ...(deps.spend && { spend: deps.spend }),
      ...(deps.now && { now: deps.now }),
      ...(deps.onHeal && { onHeal: deps.onHeal }),
      onChange: (id) => this.#bound?.changed(id),
      ...(deps.beatMs && { beatMs: deps.beatMs }),
    });
  }

  /** The routine service, once it exists (it and the pulse need each other). */
  bind(bound: WhenBinding) {
    this.#bound = bound;
  }

  start() {
    return this.pulse.start();
  }

  stop() {
    this.pulse.stop();
  }

  /** Follow a change to the routines now, instead of on the next beat. */
  sync() {
    void this.pulse.sync().catch(() => undefined);
  }

  // ── Triggers ───────────────────────────────────────────────────────────

  /**
   * Check and complete a trigger before it's saved. An address another app
   * uses keeps the id it has; a new one gets a fresh one (never chosen by
   * anyone, the assistant included).
   */
  async prepare(input: {
    routineId: string;
    when: Trigger;
    onlyIf?: string;
    current?: Trigger;
  }): Promise<WhenFile> {
    const source = this.pulse.source(input.when.kind);
    if (!source) throw new TriggerError('Conch can’t start a routine from that yet.');
    let when: Trigger = input.when;
    if (when.kind === 'hook')
      when = {
        kind: 'hook',
        hookId:
          input.current?.kind === 'hook' && input.current.hookId
            ? input.current.hookId
            : newHookId(),
      };
    if (source.validate)
      when = await (source.validate as (t: Trigger, c: { routineId?: string }) => Promise<Trigger>)(
        when,
        { routineId: input.routineId },
      );
    const onlyIf = input.onlyIf?.trim();
    return { when, ...(onlyIf && { onlyIf }) };
  }

  describe(when: Trigger): string {
    const source = this.pulse.source(when.kind);
    return source ? (source.describe as (t: Trigger) => string)(when) : 'When something happens';
  }

  async preview(when: Trigger, onlyIf?: string): Promise<WhenPreview> {
    try {
      const prepared = await this.prepare({
        routineId: 'preview',
        when: when.kind === 'hook' ? { kind: 'hook' } : when,
        ...(onlyIf && { onlyIf }),
      });
      const source = this.pulse.source(prepared.when.kind);
      const note = source?.note
        ? (source.note as (t: Trigger) => string)(prepared.when)
        : undefined;
      return {
        valid: true,
        text:
          this.describe(prepared.when) + (prepared.onlyIf ? `, only if ${prepared.onlyIf}` : ''),
        ...(note && { note }),
      };
    } catch (error) {
      return {
        valid: false,
        text: this.describe(when),
        error: error instanceof TriggerError ? error.message : 'That doesn’t work yet.',
      };
    }
  }

  load(routineId: string): Promise<WhenFile | undefined> {
    return this.store.get(routineId);
  }

  async save(routineId: string, file: WhenFile, options: { reset: boolean }) {
    await this.store.set(routineId, file);
    if (options.reset) await this.pulse.reset(routineId);
    this.sync();
  }

  async forget(routineId: string) {
    const file = await this.store.get(routineId).catch(() => undefined);
    await this.pulse.reset(routineId);
    await this.store.remove(routineId);
    if (file?.when.kind === 'hook' && file.when.hookId)
      await this.deps.secrets.remove(file.when.hookId).catch(() => undefined);
    this.sync();
  }

  /** Start counting again from now (turned back on). */
  async restart(routineId: string) {
    await this.pulse.reset(routineId);
    this.sync();
  }

  async watch(routine: PulseRoutine): Promise<WatchState> {
    const state = await this.pulse.state(routine);
    if (routine.when.kind !== 'hook' || !routine.when.hookId) return state;
    const address = this.deps.hookUrl?.(routine.when.hookId);
    const signed = Boolean(await this.deps.secrets.get(routine.when.hookId).catch(() => undefined));
    return { ...state, ...(address && { address }), signed };
  }

  /** A new secret for another app's address: shown once. */
  async newSecret(routineId: string): Promise<string> {
    const file = await this.store.get(routineId);
    if (file?.when.kind !== 'hook' || !file.when.hookId)
      throw new TriggerError('Only a routine another app starts has a secret.');
    return this.deps.secrets.create(file.when.hookId);
  }

  /** The most recent matching thing, for “Try it now”. */
  async sample(routine: PulseRoutine): Promise<Happening | undefined> {
    const source = this.pulse.source(routine.when.kind);
    if (!source?.sample) return undefined;
    const seen = await this.store.seen(routine.id).catch(() => undefined);
    return (source.sample as NonNullable<typeof source.sample>)({
      routineId: routine.id,
      title: routine.title,
      trigger: routine.when as never,
      since: seen?.since ?? Date.now(),
      state: structuredClone(seen?.source ?? {}),
      now: this.deps.now?.() ?? Date.now(),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => undefined);
  }

  taint(when: Trigger): TaintSource {
    const source = this.pulse.source(when.kind);
    return source
      ? (source.taint as (t: Trigger) => TaintSource)(when)
      : { kind: 'app', label: 'something from outside' };
  }

  kinds(): TriggerKind[] {
    return Object.keys(this.deps.sources) as TriggerKind[];
  }
}
