/**
 * Who carries on at a usage limit (ADR 0023, ADR 0126): every plan and key
 * that could answer instead, one choice per account, each with whether it
 * has room, what it costs and the model it answers with, in Automatic's order.
 *
 * Asked by Settings (to show the choices) and by `Services.route` the moment
 * a provider is at its limit (to pick the first with room). Nothing here
 * spends: it reads what the providers and Conch's own ledger already know.
 */
import type {
  EngineId,
  EngineStatus,
  FallbackChoice,
  FallbackRoom,
  UsageSnapshot,
} from '@conch/protocol';
import { modelOf } from '@conch/protocol';

import type { Engine } from '../engines/types';
import { tightest, type BillingInfo } from './billing';
import { perReply } from './prices';

/** What the planner reads; each part may fail, and a failure only makes a choice less sure. */
export interface FallbackDeps {
  /** Every provider ready to answer, the default first. */
  ready(): Promise<Engine[]>;
  /** A provider's limits as last read (or read now, the first time). */
  snapshot(id: EngineId): Promise<UsageSnapshot | undefined>;
  /** How it charges: a plan, or money (`usage/billing.ts`). */
  billing(engine: Engine): Promise<BillingInfo>;
  /** This month's money through Conch, and the budget when one is set (ADR 0079). */
  month(): Promise<{ usd: number; budgetUsd?: number }>;
  /** Until when a provider that refused for a limit is passed over. */
  refusedUntil(id: EngineId): number | undefined;
  /** Whether `to` can carry a chat `from` answers, and with which model (`carryTools`). */
  carry(from: Engine, to: Engine): Promise<{ model?: string } | false>;
  /** "…4f2c" for a provider's saved key. */
  keyHint?(id: EngineId): Promise<string | undefined>;
  now?(): number;
}

/** One choice, and the provider that would answer for it. */
export interface FallbackCandidate {
  engine: Engine;
  choice: FallbackChoice;
}

/** Whose account a provider is: the same for two ways into one sign-in, with the same person. */
export function accountKey(engine: Pick<Engine, 'id' | 'sharesAccount'>, status?: EngineStatus) {
  const who = status?.auth?.email ?? status?.auth?.description ?? '';
  return `${engine.sharesAccount ?? engine.id}|${who.toLowerCase()}`;
}

/** Whether two providers are the same account, so one at its limit means both are. */
export function sameAccount(
  a: Pick<Engine, 'id' | 'sharesAccount'>,
  aStatus: EngineStatus | undefined,
  b: Pick<Engine, 'id' | 'sharesAccount'>,
  bStatus: EngineStatus | undefined,
): boolean {
  if (a.id === b.id) return true;
  if (!a.sharesAccount || a.sharesAccount !== b.sharesAccount) return false;
  return accountKey(a, aStatus) === accountKey(b, bStatus);
}

/**
 * Automatic's order. The person's own order comes first (`order`, by
 * provider: any of a choice's ways in counts); the rest follow ranked — plans
 * before keys, since a plan costs nothing more, then keys from the cheapest
 * reply up, one Conch can't price last. Within a kind, the order they came
 * in (the default provider first). The order doesn't move with room: Automatic
 * passes over one without room at the moment of the limit, so what the person
 * sees is what it does.
 */
export function rankChoices<T extends Pick<FallbackChoice, 'engines' | 'billing' | 'perReplyUsd'>>(
  choices: readonly T[],
  order: readonly string[] = [],
): T[] {
  const placed = (c: T) => {
    const at = c.engines.map((id) => order.indexOf(id)).filter((i) => i >= 0);
    return at.length ? Math.min(...at) : -1;
  };
  const natural = (c: T) => (c.billing === 'plan' ? 0 : 1);
  const price = (c: T) => (c.billing === 'plan' ? 0 : (c.perReplyUsd ?? Number.POSITIVE_INFINITY));
  return choices
    .map((choice, index) => ({ choice, index, placed: placed(choice) }))
    .sort((a, b) => {
      if (a.placed >= 0 || b.placed >= 0) {
        if (a.placed < 0) return 1;
        if (b.placed < 0) return -1;
        return a.placed - b.placed;
      }
      return (
        natural(a.choice) - natural(b.choice) ||
        price(a.choice) - price(b.choice) ||
        a.index - b.index
      );
    })
    .map((entry) => entry.choice);
}

/** The first choice Automatic would use right now: one with room, that can carry the chat. */
export function firstWithRoom<T extends Pick<FallbackChoice, 'room' | 'skip'>>(
  choices: readonly T[],
): T | undefined {
  return choices.find((c) => !c.skip && c.room !== 'none');
}

/** What a provider answers, or nothing when it can't say right now (never a throw). */
async function attempt<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

interface Entry {
  engine: Engine;
  status?: EngineStatus;
  billing: 'plan' | 'metered';
  account?: string;
  /** What tells this account apart from another with the same name. */
  who?: string;
  room: FallbackRoom;
  /** It can do what the chat needs (`carryTools`). */
  carries: boolean;
  leftPercent?: number;
  resetsAt?: number;
  perReplyUsd?: number;
  model?: { id: string; label: string };
  skip?: string;
}

/** A plan's room from its windows; a key's from its own limit and the month's budget. */
function roomOf(
  billing: 'plan' | 'metered',
  snapshot: UsageSnapshot | undefined,
  info: BillingInfo,
  month: { usd: number; budgetUsd?: number } | undefined,
  refused: number | undefined,
): Pick<Entry, 'room' | 'leftPercent' | 'resetsAt' | 'skip'> {
  if (refused !== undefined) return { room: 'none', resetsAt: refused, skip: 'At its limit' };
  if (snapshot?.blocked)
    return {
      room: 'none',
      ...(snapshot.blocked.until !== undefined && { resetsAt: snapshot.blocked.until }),
      skip: 'At its limit',
    };
  if (billing === 'plan') {
    const window = tightest(snapshot?.windows?.length ? snapshot.windows : info.usage?.windows);
    if (!window) return { room: 'unknown' };
    const left = Math.max(0, Math.min(100, 100 - window.usedPercent));
    const reset = window.resetsAt !== undefined ? { resetsAt: window.resetsAt } : {};
    if (left <= 0) return { room: 'none', leftPercent: 0, ...reset, skip: 'At its limit' };
    return { room: left <= 10 ? 'low' : 'room', leftPercent: Math.round(left), ...reset };
  }
  // Money: never past the month's budget, nor past the key's own limit where it has one.
  if (month?.budgetUsd !== undefined && month.usd >= month.budgetUsd)
    return { room: 'none', skip: 'This month’s budget is used up' };
  const extra = snapshot?.extra ?? info.usage?.extra;
  if (extra?.enabled && extra.limit !== undefined && (extra.used ?? 0) >= extra.limit)
    return { room: 'none', skip: 'At this key’s spending limit' };
  return { room: 'room' };
}

/**
 * Every account that could carry on for `from`, in Automatic's order. The
 * model on this computer isn't among them: it's the last resort, apart.
 */
export async function fallbackChoices(
  from: Engine,
  deps: FallbackDeps,
  order: readonly string[] = [],
): Promise<FallbackCandidate[]> {
  const ready = await deps.ready().catch(() => [] as Engine[]);
  const fromStatus = await attempt(() => from.detect());
  const month = await deps.month().catch(() => undefined);
  const others = ready.filter((engine) => engine.id !== from.id && !engine.local);
  const entries = await Promise.all(
    others.map(async (engine): Promise<Entry | undefined> => {
      const status = await attempt(() => engine.detect());
      if (status && status.state !== 'ready') return undefined;
      // Another way into the account at its limit is at the same limit.
      if (sameAccount(from, fromStatus, engine, status)) return undefined;
      const [info, snapshot, carried, caps, hint] = await Promise.all([
        deps.billing(engine).catch((): BillingInfo => ({})),
        deps.snapshot(engine.id).catch(() => undefined),
        deps.carry(from, engine).catch(() => false as const),
        attempt(() => engine.capabilities()),
        deps.keyHint?.(engine.id).catch(() => undefined),
      ]);
      const billing = info.billing === 'plan' || snapshot?.kind === 'plan' ? 'plan' : 'metered';
      // A refusal by another way into the same account counts too: one account, one limit.
      const twins = engine.sharesAccount
        ? others.filter((o) => o.sharesAccount === engine.sharesAccount)
        : [engine];
      const refused = twins
        .map((o) => deps.refusedUntil(o.id))
        .find((t): t is number => t !== undefined);
      const room = roomOf(billing, snapshot, info, month, refused);
      const model = caps ? modelOf(caps, carried ? carried.model : undefined) : undefined;
      const account =
        status?.auth?.description ?? (hint ? `Key ${hint}` : (info.source ?? undefined));
      return {
        engine,
        ...(status && { status }),
        billing,
        ...(account && { account }),
        ...((status?.auth?.email ?? hint) && { who: status?.auth?.email ?? hint }),
        ...room,
        ...(billing === 'metered' && model && { perReplyUsd: perReply(model.id) }),
        ...(model && { model: { id: model.id, label: model.label } }),
        carries: carried !== false,
        ...(carried === false && { skip: `Can’t do all ${from.label} does in a chat` }),
      };
    }),
  );

  // One choice per account: Codex and Codex CLI, signed in as one person, are one.
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (!entry) continue;
    const key = accountKey(entry.engine, entry.status);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const merged = [...groups.values()].flatMap((group) => {
    // The one that answers: the first that can carry the chat.
    const lead = group.find((e) => e.carries) ?? group[0];
    if (!lead) return [];
    const name = group.map((e) => e.engine.label).reduce((a, b) => (b.length < a.length ? b : a));
    return [{ lead, group, name }];
  });

  // The same name twice (two accounts, two keys): each says whose it is.
  const counts = new Map<string, number>();
  for (const { name } of merged) counts.set(name, (counts.get(name) ?? 0) + 1);
  const choices = merged.map(({ lead, group, name }): FallbackCandidate => {
    const twice = (counts.get(name) ?? 0) > 1;
    const perReplyUsd = lead.perReplyUsd;
    const choice: FallbackChoice = {
      id: lead.engine.id,
      engines: [lead.engine.id, ...group.filter((e) => e !== lead).map((e) => e.engine.id)],
      name: twice && lead.who ? `${name} · ${lead.who}` : name,
      // Named by whose it is already: the account says only the rest ("ChatGPT Plus").
      ...(lead.account && {
        account: (twice && lead.who
          ? lead.account.replace(` · ${lead.who}`, '')
          : lead.account
        ).slice(0, 200),
      }),
      billing: lead.billing,
      room: lead.room,
      ...(lead.leftPercent !== undefined && { leftPercent: lead.leftPercent }),
      ...(lead.resetsAt !== undefined && { resetsAt: lead.resetsAt }),
      ...(perReplyUsd !== undefined && { perReplyUsd: Math.round(perReplyUsd * 10_000) / 10_000 }),
      ...(lead.model && { model: lead.model }),
      ...(lead.skip && { skip: lead.skip }),
    };
    return { engine: lead.engine, choice };
  });
  const leads = new Map(choices.map((c) => [c.choice, c.engine]));
  return rankChoices(
    choices.map((c) => c.choice),
    order,
  ).flatMap((choice) => {
    const engine = leads.get(choice);
    return engine ? [{ engine, choice }] : [];
  });
}
