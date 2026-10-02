import { canUseApps, modelOf, type Capabilities } from '@conch/protocol';

import type { Engine } from '../engines/types';

type Tools = NonNullable<Capabilities['tools']>;

function toolsOf(engine: Engine, capabilities: Capabilities): Tools {
  return (
    capabilities.tools ?? {
      host: engine.hostTools !== false,
      files: Boolean(engine.attachments?.files),
      shell: false,
      approvals: true,
    }
  );
}

/**
 * Whether `to` can carry a turn `from` was going to answer, without silently
 * exchanging an action-capable model for chat only (ADR 0036, ADR 0050).
 *
 * The models are the ones each would answer with (`modelOf`): a turn the
 * chat's own model could only chat in needs nothing more. When `to`'s model
 * can't use apps and `choose` is set (a provider that's free and stays on
 * this computer), another of its models that can is chosen instead; otherwise
 * it can't carry the turn. Returns the model to use (`undefined` for its own
 * choice), or `false`.
 */
export async function carryTools(
  from: Engine,
  to: Engine,
  options: { fromModel?: string; toModel?: string; choose?: boolean } = {},
): Promise<{ model?: string } | false> {
  const [source, target] = await Promise.all([from.capabilities(), to.capabilities()]);
  const keep = options.toModel ? { model: options.toModel } : {};
  const needed = toolsOf(from, source);
  // Only chat was possible here: anyone can carry that.
  if (modelOf(source, options.fromModel)?.tools === false) return keep;
  const offered = toolsOf(to, target);
  if (needed.files && !offered.files) return false;
  if (needed.shell && !offered.shell) return false;
  if (needed.approvals && !offered.approvals) return false;
  if (!needed.host) return keep;
  if (!offered.host) return false;
  if (canUseApps({ tools: offered }, modelOf(target, options.toModel))) return keep;
  const able = options.choose
    ? target.models.find((m) => m.id !== 'default' && canUseApps({ tools: offered }, m))
    : undefined;
  return able ? { model: able.id } : false;
}

/** Fallback never silently exchanges an action-capable provider for chat only. */
export async function canCarryTools(from: Engine, to: Engine): Promise<boolean> {
  return (await carryTools(from, to)) !== false;
}
