/**
 * Models that can't use apps (ADR 0050). Some models only chat: they can't
 * call tools, so they can't use connected apps, files, commands or memory.
 * The picker says so, a chat that needs an app offers a model that can, and
 * routing never hands a turn that needs tools to one that can't.
 */
import { z } from 'zod';

import { EngineId } from './common';
import type { Capabilities, ModelInfo } from './engine';

/**
 * The model a provider answers with when a chat names `id`: that one, or —
 * when it names none, or `default` — the provider's own default entry, else
 * its first. `undefined` when the provider doesn't list the one named.
 */
export function modelOf(
  provider: Pick<Capabilities, 'models'>,
  id: string | undefined,
): ModelInfo | undefined {
  const named = provider.models.find((m) => m.id === id);
  if (named || (id && id !== 'default')) return named;
  return provider.models.find((m) => m.id === 'default') ?? provider.models[0];
}

/**
 * Whether a model can use apps, files and memory: its provider offers Conch's
 * tools, and the model itself isn't chat-only. Unknown counts as able: a false
 * "can't" would stop a chat that works.
 */
export function canUseApps(
  provider: Pick<Capabilities, 'tools'>,
  model: Pick<ModelInfo, 'tools'> | undefined,
): boolean {
  return provider.tools?.host !== false && model?.tools !== false;
}

/** One provider's offer, as much of it as choosing a model needs. */
type Offer = Pick<Capabilities, 'engine' | 'label' | 'models' | 'tools'> & { message?: string };

/** A model that can use apps, to switch a chat to. */
export const AppsModel = z.object({
  engine: EngineId,
  model: z.string().max(200),
  /** The model's name, as the picker shows it. */
  label: z.string().max(200),
  /** Its provider's name. */
  provider: z.string().max(200),
});
export type AppsModel = z.infer<typeof AppsModel>;

/**
 * The best model to switch to when the chat's can't use an app: one the
 * person already set up, never a new provider. The same provider first (its
 * default model, if that can, else its first named one that can), then the
 * default provider, then the rest in the order they're listed.
 */
export function appsModel(
  providers: readonly Offer[],
  from: { engine: EngineId; model?: string },
  defaults: { engine?: EngineId; model?: string } = {},
): AppsModel | undefined {
  const rank = (p: Offer) => (p.engine === from.engine ? 0 : p.engine === defaults.engine ? 1 : 2);
  const ordered = [...providers]
    .filter((p) => !p.message && p.tools?.host !== false)
    .sort((a, b) => rank(a) - rank(b));
  for (const provider of ordered) {
    const able = provider.models.filter(
      (m) => canUseApps(provider, m) && !(provider.engine === from.engine && m.id === from.model),
    );
    const preferred =
      provider.engine === defaults.engine
        ? able.find((m) => m.id === defaults.model && m.id !== 'default')
        : undefined;
    // "Default" says nothing about which model it is: a named one reads better.
    const pick = preferred ?? able.find((m) => m.id !== 'default') ?? able[0];
    if (pick)
      return {
        engine: provider.engine,
        model: pick.id,
        label: pick.label.replace(/\s*\(recommended\)\s*$/i, ''),
        provider: provider.label,
      };
  }
  return undefined;
}

/** Something a message needs that a chat-only model can't use: an app, or a skill's tools. */
export const AppNeed = z.object({
  kind: z.enum(['app', 'skill']),
  /** The app's or the skill's name, as people know it. */
  name: z.string().max(200),
  /** The catalog entry, for its mark. */
  catalogId: z.string().max(100).optional(),
});
export type AppNeed = z.infer<typeof AppNeed>;
