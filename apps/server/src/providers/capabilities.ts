import type { Engine } from '../engines/types';

/** Fallback never silently exchanges an action-capable provider for chat only. */
export async function canCarryTools(from: Engine, to: Engine): Promise<boolean> {
  const [source, target] = await Promise.all([from.capabilities(), to.capabilities()]);
  const needed = source.tools ?? {
    host: from.hostTools !== false,
    files: Boolean(from.attachments?.files),
    shell: false,
    approvals: true,
  };
  const offered = target.tools ?? {
    host: to.hostTools !== false,
    files: Boolean(to.attachments?.files),
    shell: false,
    approvals: true,
  };
  if (needed.host && (!offered.host || target.models[0]?.tools === false)) return false;
  if (needed.files && !offered.files) return false;
  if (needed.shell && !offered.shell) return false;
  return !needed.approvals || offered.approvals;
}
