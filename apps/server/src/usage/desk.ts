/**
 * What chats need to count and hold spending (ADR 0073), from the rest of
 * Conch: how each provider charges, the month's ledger and budget, the models
 * already set up (to offer one that costs less), and which chat a task was
 * sent from.
 */
import {
  canUseApps,
  modelOf,
  type EngineId,
  type ModelCatalog,
  type SpendLimitKind,
  type SpendModel,
  type TurnCost,
  type Usage,
} from '@conch/protocol';

import type { SpendDesk } from '../conversations/spend';
import type { Engine } from '../engines/types';
import { money } from '../routines/spend';
import { type Billings, priceUsage, turnCost, type BillingInfo } from './billing';
import { costAt, priceOf } from './prices';
import type { UsageService } from './service';

/** A reply that costs less than this is never worth a word before it. */
export const ESTIMATE_FROM_USD = 0.25;
/** …nor one that costs less than this many times the last one. */
export const ESTIMATE_TIMES = 2;
/** A model is "cheaper" when its input costs at most this share of the chat's. */
const CHEAPER_SHARE = 1 / 3;

/** "(recommended)" says nothing on a card. */
const plainLabel = (label: string) => label.replace(/\s*\(recommended\)\s*$/i, '');

export class ChatSpendDesk implements SpendDesk {
  constructor(
    private readonly deps: {
      billings: Billings;
      usage: () => UsageService;
      /** Every connected provider's models. */
      catalog: () => Promise<ModelCatalog>;
      engineFor: (id: EngineId) => Engine;
      /** A task, by id: the chat it was sent from. */
      task: (id: string) => Promise<{ parentConversationId?: string } | undefined>;
    },
  ) {}

  billing(engine: Engine): Promise<BillingInfo> {
    return this.deps.billings.quick(engine);
  }

  month() {
    return this.deps.usage().month();
  }

  record(cost: TurnCost | undefined, usage: Usage | undefined, options?: { tell?: boolean }) {
    return this.deps.usage().recordTurn(usage, cost, options);
  }

  cost(usage: Usage | undefined, info: BillingInfo, model: string | undefined, engine: EngineId) {
    // A plan's window as the usage meter last read it: never a new read as a reply ends.
    const seen =
      info.billing === 'plan' && !info.usage ? this.deps.usage().seen(engine) : undefined;
    return turnCost(
      usage,
      seen ? { ...info, source: seen.source || info.source, usage: seen } : info,
      model,
    );
  }

  usd(usage: Usage, model: string | undefined) {
    return priceUsage(usage, model).usd;
  }

  async raiseBudget(usd: number) {
    await this.deps.usage().setBudget(usd);
  }

  async parentOf(taskId: string) {
    return (await this.deps.task(taskId).catch(() => undefined))?.parentConversationId;
  }

  /**
   * A model to carry on with at a limit, from the ones already set up: one on
   * this computer, then one on a plan (neither spends money), then, for a
   * chat's own limit, one on a key that costs a third as much or less. One
   * that can use apps first when the chat's can.
   */
  async cheaper(
    from: { engine: Engine; model?: string },
    limit: SpendLimitKind,
  ): Promise<SpendModel | undefined> {
    const catalog = await this.deps.catalog().catch(() => undefined);
    if (!catalog) return undefined;
    const ready = catalog.providers.filter((p) => !p.message && p.models.length);
    const current = ready.find((p) => p.engine === from.engine.id);
    const currentModel = current && modelOf(current, from.model);
    const wantsApps = Boolean(current && currentModel && canUseApps(current, currentModel));
    const currentPrice = priceOf(currentModel?.id ?? from.model);

    type Pick = SpendModel & { able: boolean; rank: number; price?: number };
    const picks: Pick[] = [];
    for (const provider of ready) {
      if (provider.engine === from.engine.id && !currentPrice) continue;
      const engine = this.deps.engineFor(provider.engine);
      const info = await this.deps.billings.of(engine).catch((): BillingInfo => ({}));
      const why: SpendModel['why'] | undefined = provider.local
        ? 'local'
        : info.billing === 'plan'
          ? 'plan'
          : info.billing === 'metered' && limit === 'chat'
            ? 'cheaper'
            : undefined;
      if (!why) continue;
      for (const model of provider.models) {
        if (provider.engine === from.engine.id && model.id === from.model) continue;
        if (model.id === 'default' && provider.models.length > 1) continue;
        const price = priceOf(model.id);
        if (
          why === 'cheaper' &&
          !(price && currentPrice && price.input <= currentPrice.input * CHEAPER_SHARE)
        )
          continue;
        picks.push({
          engine: provider.engine,
          model: model.id,
          label: plainLabel(model.label),
          provider: provider.label,
          why,
          able: canUseApps(provider, model),
          rank: why === 'local' ? 0 : why === 'plan' ? 1 : 2,
          ...(price && { price: price.input }),
        });
      }
    }
    picks.sort(
      (a, b) =>
        Number(wantsApps && !a.able) - Number(wantsApps && !b.able) ||
        a.rank - b.rank ||
        // Of the cheaper ones, the most capable: the dearest that's still cheap.
        (b.price ?? 0) - (a.price ?? 0) ||
        Number(b.engine === from.engine.id) - Number(a.engine === from.engine.id),
    );
    const best = picks[0];
    if (!best) return undefined;
    const { able: _able, rank: _rank, price: _price, ...model } = best;
    return model;
  }

  /**
   * One sentence when the model just picked makes a reply on this chat cost a
   * lot more: a reply like the last one, at the new model's list price, with
   * nothing from the cache (a new model starts without it). Nothing when it's
   * small, no dearer, free, on a plan, or unpriced.
   */
  async estimate(input: {
    to: { engine: Engine; model?: string };
    last: { usage: Usage; cost?: TurnCost };
  }): Promise<string | undefined> {
    const info = await this.deps.billings.of(input.to.engine).catch((): BillingInfo => ({}));
    if (info.billing !== 'metered') return undefined;
    const catalog = await this.deps.catalog().catch(() => undefined);
    const provider = catalog?.providers.find((p) => p.engine === input.to.engine.id);
    const model = provider ? modelOf(provider, input.to.model) : undefined;
    const price = priceOf(model?.id ?? input.to.model);
    if (!price) return undefined;
    const reply = costAt(price, {
      inputTokens: input.last.usage.inputTokens,
      outputTokens: input.last.usage.outputTokens,
    });
    const before = input.last.cost;
    const lastUsd = before?.billing === 'metered' ? before.usd : before ? 0 : undefined;
    if (reply < ESTIMATE_FROM_USD) return undefined;
    if (lastUsd !== undefined && lastUsd > 0 && reply < lastUsd * ESTIMATE_TIMES) return undefined;
    const label = model ? plainLabel(model.label) : (input.to.model ?? input.to.engine.label);
    const then =
      before?.billing === 'metered' && before.usd !== undefined
        ? ` The last one cost ${money(before.usd)}.`
        : before?.billing === 'plan'
          ? ` The last one was on your ${before.plan?.source ? `${before.plan.source} ` : ''}plan.`
          : before?.billing === 'free'
            ? ' The last one was free.'
            : '';
    return `With a chat this long, each reply from ${label} costs about ${money(reply)}.${then}`;
  }
}
