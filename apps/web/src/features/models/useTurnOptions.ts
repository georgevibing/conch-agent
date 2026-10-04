import type {
  EffortChoice,
  EngineId,
  ModelInfo,
  PermissionMode,
  ProviderModels,
  TurnOptions,
} from '@conch/protocol';
import { EngineId as EngineIdSchema, honouredMode } from '@conch/protocol';
import { toast } from '@conch/nacre';

import { useAppState, useConversations, useModels, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useLive } from '../../live/LiveProvider';

export interface ResolvedTurnOptions {
  /** The provider that answers. */
  engine: EngineId | undefined;
  model: string;
  effort: EffortChoice;
  fastMode: boolean;
  permissionMode: PermissionMode;
}

/** The engine's default model id (Claude Code calls it `default`). */
const DEFAULT_MODEL = 'default';

/**
 * How a choice is keyed in the picker: a provider and one of its models. Model
 * ids can hold `/` and `:` (`qwen/qwen3:free`), so the separator is `|`.
 */
export const modelKey = (engine: string, model: string) => `${engine}|${model}`;

export function parseModelKey(key: string): { engine: EngineId; model: string } | undefined {
  const at = key.indexOf('|');
  if (at === -1) return undefined;
  const engine = EngineIdSchema.safeParse(key.slice(0, at));
  return engine.success ? { engine: engine.data, model: key.slice(at + 1) } : undefined;
}

export function findModel(
  provider: Pick<ProviderModels, 'models'> | undefined,
  id: string | undefined,
): ModelInfo | undefined {
  return (id && provider?.models.find((m) => m.id === id)) || provider?.models[0];
}

/**
 * One source of truth for "what will the next turn use": this conversation's
 * choices (or the new-chat draft) layered over the user's defaults — which
 * provider answers, which of its models, and how. Every connected provider
 * can be picked (ADR 0012); a model only means something to its own provider.
 */
export function useTurnOptions(conversationId?: string) {
  const { data: app } = useAppState();
  const { data: conversations } = useConversations();
  const models = useModels(Boolean(app));
  const draft = useUi((s) => s.draftOptions);
  const setDraft = useUi((s) => s.setDraftOptions);
  const live = useLive();
  const update = useUpdateSettings();

  const catalog = models.data;
  const prefs = app?.preferences;
  const overrides: TurnOptions = conversationId
    ? (conversations?.find((c) => c.id === conversationId)?.options ?? {})
    : draft;

  const defaultEngine = catalog?.default ?? prefs?.engine;
  const defaults: ResolvedTurnOptions = {
    engine: defaultEngine,
    model: prefs?.model ?? DEFAULT_MODEL,
    effort: prefs?.effort ?? 'auto',
    fastMode: prefs?.fastMode ?? false,
    permissionMode: prefs?.permissionMode ?? 'default',
  };

  const chosen = overrides.engine ?? defaultEngine;
  const providers = catalog?.providers ?? [];
  // The chosen provider if it's connected; otherwise the default, or whichever is.
  const provider =
    providers.find((p) => p.engine === chosen) ??
    providers.find((p) => p.engine === defaultEngine) ??
    providers[0];
  const engine = provider?.engine ?? chosen;
  const wanted =
    overrides.model && chosen === engine
      ? overrides.model
      : engine === defaultEngine
        ? defaults.model
        : undefined;
  const model = findModel(provider, wanted);

  const resolved: ResolvedTurnOptions = {
    engine,
    model: model?.id ?? wanted ?? DEFAULT_MODEL,
    effort: overrides.effort ?? defaults.effort,
    fastMode: overrides.fastMode ?? defaults.fastMode,
    permissionMode: overrides.permissionMode ?? defaults.permissionMode,
  };
  // Keep choices valid for the chosen model and provider: unsupported effort
  // falls back to auto, fast to off, and a mode it can't honour to its safest,
  // exactly as the gateway will run it.
  const modes = provider?.permissionModes ?? [];
  const effective: ResolvedTurnOptions = {
    ...resolved,
    effort:
      resolved.effort !== 'auto' && model && !model.efforts.includes(resolved.effort)
        ? 'auto'
        : resolved.effort,
    fastMode: resolved.fastMode && Boolean(model?.supportsFastMode),
    permissionMode: honouredMode(resolved.permissionMode, modes),
  };

  const set = (patch: TurnOptions) => {
    if (conversationId) live.configure(conversationId, patch);
    else setDraft({ ...draft, ...patch });
  };

  /** Pick a model — of this provider or another one. */
  const choose = (key: string) => {
    const parsed = parseModelKey(key);
    if (parsed) set({ engine: parsed.engine, model: parsed.model });
  };

  const makeDefault = (keys: (keyof ResolvedTurnOptions)[]) => {
    const preferences: Record<string, unknown> = {};
    for (const key of keys) preferences[key] = effective[key];
    // A default model belongs to a default provider.
    if (keys.includes('model') && effective.engine) preferences.engine = effective.engine;
    update.mutate(
      { preferences },
      { onError: (error) => toast.error(error.message || 'That didn’t save. Try again.') },
    );
  };

  const isDefault = (keys: (keyof ResolvedTurnOptions)[]) =>
    keys.every((k) => effective[k] === defaults[k]) &&
    (!keys.includes('model') || effective.engine === defaults.engine);

  /** Options to send with the first message of a new chat (then the draft resets). */
  const takeDraft = (): TurnOptions | undefined => {
    if (conversationId || Object.keys(draft).length === 0) return undefined;
    setDraft({});
    return draft;
  };

  return {
    /** Every connected provider's models. */
    catalog,
    /** The provider answering: its models, commands and permission modes. */
    capabilities: provider,
    loading: models.isLoading,
    model,
    options: effective,
    defaults,
    set,
    choose,
    makeDefault,
    isDefault,
    takeDraft,
  };
}
