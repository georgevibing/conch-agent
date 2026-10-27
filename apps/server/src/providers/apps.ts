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
/** Things people ask a coding assistant to do: several in one message is a job of many steps. */
const ACTS =
  /\b(fix|push|deploy|build|test|run|install|migrat\w*|refactor|write|creat\w*|updat\w*|delet\w*|remov\w*|clon\w*|commit|merg\w*|review|check|set\s+up|configur\w*|renam\w*|mov\w*|add|upgrad\w*|bump|releas\w*|publish|scan|audit|investigat\w*|research|clean|rebas\w*|ship|block|rotat\w*|monitor|verify|benchmark|profile|document|implement)\b/g;
/** Words that put steps in order. */
const ORDER =
  /\b(?:and\s+then|then|after\s+that|afterwards|once\s+(?:that|it)'?s?\s+done|first\b[^.]{0,80}\bthen|end\s+to\s+end|step\s+by\s+step|make\s+sure\b[^.]{0,40}\b(?:live|works|green))\b/;

/**
 * Whether a message asks for a job of many steps (2026-10-27), read cheaply by code: three
 * different things to do, two with words that order them, or a list of three or more.
 * "Tell me a joke" isn't one; "fix the test, push and deploy" is.
 */
export function looksLong(text: string): boolean {
  const lower = text.toLowerCase();
  const acts = new Set([...lower.matchAll(ACTS)].map((m) => (m[1] ?? '').replace(/\s+/g, ' ')));
  const listed = lower.split('\n').filter((line) => /^\s*(?:\d+[.)]|[-*•])\s+\S/.test(line));
  return acts.size >= 3 || (acts.size >= 2 && ORDER.test(lower)) || listed.length >= 3;
}

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
  // A long job for a model that calls tools only in words (2026-10-27): it can, step by step,
  // but one with its own tool calls does it better. Offered only when there's one to switch to.
  const job = !needs.length && input.engine.hostTools !== false && looksLong(input.text);
  if (!needs.length && !job) return undefined;
  const [catalog, defaults] = await Promise.all([deps.catalog(), deps.defaults()]);
  const switchTo = appsModel(
    catalog.providers,
    { engine: input.engine.id, model: model.id },
    defaults,
  );
  if (job) {
    if (!switchTo) return undefined;
    needs.push({ kind: 'job', name: 'a long job' });
  }
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
