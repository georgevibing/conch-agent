import type { WorkPlaceInfo } from '@conch/protocol';
import type { WorkPlaceOption } from '@conch/nacre';

/** `openSettings('security', WORKPLACES_FOCUS)` brings Where work runs into view. */
export const WORKPLACES_FOCUS = 'workplaces';

/** `openSettings('security', CLOUD_KEY_FOCUS)`: Where work runs, the Daytona key's box ready to type in. */
export const CLOUD_KEY_FOCUS = 'workplaces-cloud-key';

/** `openSettings('security', CONTAINER_FOCUS)`: Where work runs, at what gets Docker or Podman. */
export const CONTAINER_FOCUS = 'workplaces-container';

/** Every focus that lands in Where work runs (it lives under Security → Advanced). */
export const WORKPLACES_FOCUSES = [WORKPLACES_FOCUS, CLOUD_KEY_FOCUS, CONTAINER_FOCUS];

/**
 * Where a place that needs setting up is set up, and the few words its row
 * says for it; nothing when it can be chosen as it is (ADR 0106).
 */
export function placeSetup(place: WorkPlaceInfo): { label: string; focus: string } | undefined {
  if (place.state !== 'needs-setup') return undefined;
  if (place.needsKey) return { label: 'Add a key', focus: CLOUD_KEY_FOCUS };
  if (place.need) return { label: 'Set it up', focus: CONTAINER_FOCUS };
  return undefined;
}

/** A place as the picker lists it; `setup` takes a place that needs setting up to Settings. */
export function placeOption(
  place: WorkPlaceInfo,
  setup?: WorkPlaceOption['setup'],
): WorkPlaceOption {
  return {
    value: place.id,
    kind: place.kind,
    label: place.name,
    description: place.description,
    state: place.state,
    ...(place.message && { message: place.message }),
    ...(setup && { setup }),
  };
}

/**
 * What to say when the chat's provider runs its own commands on this
 * computer whatever is chosen (Codex CLI), so the choice never pretends.
 */
export function runsItsOwn(provider: string | undefined): string {
  return `${provider ?? 'This provider'} runs its own commands on this computer, in its own sandbox, wherever you choose. Pick another provider for this chat to run work elsewhere.`;
}
