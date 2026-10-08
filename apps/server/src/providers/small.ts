/**
 * A cheap model for the small jobs Conch does around a chat — a story's
 * headline and "Why?" on a step (ADR 0103), the chat's title, quiet learning's
 * look (ADR 0088), a skill drafted from it (ADR 0058) — chosen for that chat.
 *
 * The chat's own provider first, on its smallest model: it has read the chat
 * already, and it's the plan or key the person chose for it. Then any other
 * connected provider with room, then a model on this computer. A private chat
 * (marked "Don't learn from this chat", a guest's, a routine's or a task's)
 * goes only to its own provider or one on this computer. A provider is asked
 * only when `allow` says it may be now: a plan that's nearly used up is left
 * for the person's own chats, and a provider that costs money stays within
 * its caps. Only when every one says no is the job not done, and the reason
 * names the plans that are nearly used up.
 */
import type { Completion, CompletionInput, Engine } from '../engines/types';
import type { LearningSpend } from '../learning/spend';

/** A provider's cheapest model, ready to answer one prompt. */
export interface SmallModel {
  engine: Engine;
  complete: (input: CompletionInput) => Promise<Completion>;
  model?: string;
}

/** Why there's no one to ask now. */
export type NotAsked = 'none' | 'budget' | 'cap' | 'plan-room';

export type Allowed = { ok: true } | { ok: false; reason: NotAsked };

/** The model to ask, or why none may be asked, with the plans nearly used up. */
export type SmallPick = { small: SmallModel } | { not: NotAsked; plans?: string[] };

/**
 * The providers to try for a chat, in order: its own, then the other
 * connected ones (the default first, as `ready` comes), then those on this
 * computer. Only providers that can answer a single prompt are listed.
 */
export function smallModelOrder(
  own: Engine | undefined,
  ready: readonly Engine[],
  options: { private: boolean },
): Engine[] {
  const able = ready.filter((engine) => engine.complete);
  const first = able.find((engine) => engine.id === own?.id);
  const rest = able.filter((engine) => engine !== first);
  return [
    ...(first ? [first] : []),
    ...(options.private ? [] : rest.filter((engine) => !engine.local)),
    ...rest.filter((engine) => engine.local),
  ];
}

/**
 * The first provider in `order` with a cheap model that may be asked now.
 * When none may, the reason is the first one's (the chat's own provider's),
 * and `plans` names every plan that's nearly used up.
 */
export async function pickSmallModel(
  order: readonly Engine[],
  deps: {
    /** The provider's cheapest model that can answer (`cheapModel`). */
    cheap: (engine: Engine) => Promise<Omit<SmallModel, 'engine'> | undefined>;
    /** May it be asked now (a plan with room, the month's budget, learning's cap)? */
    allow: (engine: Engine) => Promise<Allowed>;
  },
): Promise<SmallPick> {
  const refused: { engine: Engine; reason: NotAsked }[] = [];
  for (const engine of order) {
    const cheap = await deps.cheap(engine).catch(() => undefined);
    if (!cheap) continue;
    const allowed = await deps.allow(engine).catch((): Allowed => ({ ok: false, reason: 'none' }));
    if (allowed.ok) return { small: { engine, ...cheap } };
    refused.push({ engine, reason: allowed.reason });
  }
  const first = refused[0];
  if (!first) return { not: 'none' };
  const plans = refused.filter((r) => r.reason === 'plan-room').map((r) => r.engine.label);
  return { not: first.reason, ...(plans.length && { plans: [...new Set(plans)] }) };
}

/**
 * May a small job ask this provider now? Money stays within the month's
 * budget (a plan or this computer costs none); a plan needs room; and with
 * `learning`, money also stays within learning's monthly cap (ADR 0088). A
 * title (`plan`) is counted with its chat instead, so only the first two apply.
 */
export function smallAllow(
  deps: {
    spend: Pick<LearningSpend, 'allow' | 'room' | 'costsMoney'>;
    month: () => Promise<{ usd: number; budgetUsd?: number }>;
  },
  gate: 'learning' | 'plan' = 'learning',
): (engine: Engine) => Promise<Allowed> {
  return async (engine) => {
    if (await deps.spend.costsMoney(engine)) {
      const { usd, budgetUsd } = await deps.month();
      if (budgetUsd !== undefined && usd >= budgetUsd) return { ok: false, reason: 'budget' };
    }
    const allowed = await (gate === 'plan' ? deps.spend.room(engine) : deps.spend.allow(engine));
    return allowed.ok ? { ok: true } : { ok: false, reason: allowed.reason };
  };
}

/** "Claude Code", "Claude Code and Codex", "Claude Code, Codex and Gemini CLI". */
function named(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/** Words for why a small job wasn't done, naming the plans that are nearly used up. */
export function notAskedWords(why: NotAsked, plans: readonly string[] = []): string {
  if (why !== 'plan-room' || !plans.length) return NOT_ASKED_WORDS[why];
  return plans.length === 1
    ? `Your ${named(plans)} plan is nearly used up, so Conch is saving it for your chats.`
    : `Your ${named(plans)} plans are nearly used up, so Conch is saving them for your chats.`;
}

/** Words for each reason there's no answer, for the "Why?" card. */
export const NOT_ASKED_WORDS: Record<NotAsked | 'busy' | 'failed', string> = {
  none: 'None of your providers can answer this. Connect one in Settings → Providers.',
  budget: 'This month’s budget is spent, so Conch isn’t asking a model now.',
  cap: 'Small questions like this reached this month’s limit. Change it in Settings → Usage.',
  'plan-room': 'Your plan is nearly used up, so Conch is saving it for your chats.',
  busy: 'That’s a lot of questions at once. Ask again in a minute.',
  failed: 'Couldn’t get an answer just now. Try again in a moment.',
};
