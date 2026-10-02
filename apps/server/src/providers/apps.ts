import {
  appsModel,
  canUseApps,
  modelOf,
  type AppNeed,
  type AppsModel,
  type EngineId,
  type ModelCatalog,
  type SkillPermissions,
} from '@conch/protocol';

import type { Engine } from '../engines/types';

export interface AppsNeeded {
  needs: AppNeed[];
  model: { engine: EngineId; id: string; label: string };
  switchTo?: AppsModel;
}

/**
 * What a message needs that the chat's model can't use (ADR 0050), and the
 * best model already set up that can — or nothing, when the model can use
 * apps or the message needs none. Read from the person's own words: the apps
 * they connected that it's about, and a skill they asked for that says it
 * needs tools.
 */
export async function appsNeeded(
  deps: {
    /** The connected apps a message is about (`IntegrationService.about`). */
    about(text: string): Promise<{ name: string; catalogId?: string }[]>;
    /** Every connected provider's models (`ProviderService.models`). */
    catalog(): Promise<ModelCatalog>;
    /** Your default provider and model. */
    defaults(): Promise<{ engine?: EngineId; model?: string }>;
  },
  input: {
    text: string;
    engine: Engine;
    model?: string;
    skill?: { title: string; permissions: SkillPermissions };
  },
): Promise<AppsNeeded | undefined> {
  const capabilities = await input.engine.capabilities();
  const model = modelOf(capabilities, input.model);
  // A model it doesn't list is the provider's to judge, not ours to stop.
  if (!model || (input.engine.hostTools !== false && canUseApps(capabilities, model)))
    return undefined;
  const needs: AppNeed[] = (await deps.about(input.text)).map((app) => ({
    kind: 'app',
    name: app.name,
    ...(app.catalogId && { catalogId: app.catalogId }),
  }));
  const skill = input.skill;
  // A skill that says it needs nothing (or says nothing) is only words to follow.
  if (skill?.permissions.declared && skill.permissions.capabilities.length)
    needs.push({ kind: 'skill', name: skill.title });
  if (!needs.length) return undefined;
  const [catalog, defaults] = await Promise.all([deps.catalog(), deps.defaults()]);
  const switchTo = appsModel(
    catalog.providers,
    { engine: input.engine.id, model: model.id },
    defaults,
  );
  return {
    needs,
    model: {
      engine: input.engine.id,
      id: model.id,
      label: model.label.replace(/\s*\(recommended\)\s*$/i, ''),
    },
    ...(switchTo && { switchTo }),
  };
}
