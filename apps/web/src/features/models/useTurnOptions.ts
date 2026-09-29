import type {
  Capabilities,
  EffortChoice,
  ModelInfo,
  PermissionMode,
  TurnOptions,
} from '@conch/protocol';

import {
  useAppState,
  useCapabilities,
  useConversations,
  useUpdateSettings,
} from '../../api/queries';
import { useUi } from '../../app/ui';
import { useLive } from '../../live/LiveProvider';

export interface ResolvedTurnOptions {
  model: string;
  effort: EffortChoice;
  fastMode: boolean;
  permissionMode: PermissionMode;
}

/** The engine's default model id (Claude Code calls it `default`). */
const DEFAULT_MODEL = 'default';

export function findModel(
  capabilities: Capabilities | undefined,
  id: string,
): ModelInfo | undefined {
  return capabilities?.models.find((m) => m.id === id) ?? capabilities?.models[0];
}

/**
 * One source of truth for "what will the next turn use": this conversation's
 * overrides (or the new-chat draft) layered over the user's defaults.
 */
export function useTurnOptions(conversationId?: string) {
  const { data: app } = useAppState();
  const { data: conversations } = useConversations();
  const capabilities = useCapabilities(app?.engine.state === 'ready');
  const draft = useUi((s) => s.draftOptions);
  const setDraft = useUi((s) => s.setDraftOptions);
  const live = useLive();
  const update = useUpdateSettings();

  const prefs = app?.preferences;
  const overrides: TurnOptions = conversationId
    ? (conversations?.find((c) => c.id === conversationId)?.options ?? {})
    : draft;

  const defaults: ResolvedTurnOptions = {
    model: prefs?.model ?? DEFAULT_MODEL,
    effort: prefs?.effort ?? 'auto',
    fastMode: prefs?.fastMode ?? false,
    permissionMode: prefs?.permissionMode ?? 'default',
  };
  const resolved: ResolvedTurnOptions = {
    model: overrides.model ?? defaults.model,
    effort: overrides.effort ?? defaults.effort,
    fastMode: overrides.fastMode ?? defaults.fastMode,
    permissionMode: overrides.permissionMode ?? defaults.permissionMode,
  };

  const model = findModel(capabilities.data, resolved.model);
  // Keep choices valid for the chosen model: unsupported effort falls back to auto, fast to off.
  const effective: ResolvedTurnOptions = {
    ...resolved,
    effort:
      resolved.effort !== 'auto' && model && !model.efforts.includes(resolved.effort)
        ? 'auto'
        : resolved.effort,
    fastMode: resolved.fastMode && Boolean(model?.supportsFastMode),
  };

  const set = (patch: TurnOptions) => {
    if (conversationId) live.configure(conversationId, patch);
    else setDraft({ ...draft, ...patch });
  };

  const makeDefault = (keys: (keyof ResolvedTurnOptions)[]) => {
    const preferences = Object.fromEntries(keys.map((k) => [k, effective[k]]));
    update.mutate({ preferences });
  };

  const isDefault = (keys: (keyof ResolvedTurnOptions)[]) =>
    keys.every((k) => effective[k] === defaults[k]);

  /** Options to send with the first message of a new chat (then the draft resets). */
  const takeDraft = (): TurnOptions | undefined => {
    if (conversationId || Object.keys(draft).length === 0) return undefined;
    setDraft({});
    return draft;
  };

  return {
    capabilities: capabilities.data,
    loading: capabilities.isLoading,
    model,
    options: effective,
    defaults,
    set,
    makeDefault,
    isDefault,
    takeDraft,
  };
}
