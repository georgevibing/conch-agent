import type { WorkPlaceInfo } from '@conch/protocol';
import type { WorkPlaceOption } from '@conch/nacre';

/** `openSettings('security', WORKPLACES_FOCUS)` brings Where work runs into view. */
export const WORKPLACES_FOCUS = 'workplaces';

/** A place as the picker lists it; `action` is its one next step when it isn't ready. */
export function placeOption(
  place: WorkPlaceInfo,
  action?: WorkPlaceOption['action'],
): WorkPlaceOption {
  return {
    value: place.id,
    kind: place.kind,
    label: place.name,
    description: place.description,
    state: place.state,
    ...(place.message && { message: place.message }),
    ...(action !== undefined && { action }),
  };
}

/**
 * What to say when the chat's provider runs its own commands on this
 * computer whatever is chosen (Codex CLI), so the choice never pretends.
 */
export function runsItsOwn(provider: string | undefined): string {
  return `${provider ?? 'This provider'} runs its own commands on this computer, in its own sandbox, wherever you choose. Pick another provider for this chat to run work elsewhere.`;
}
