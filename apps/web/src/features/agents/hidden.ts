import type { AgentList } from '@conch/protocol';
import { create } from 'zustand';

interface Hidden {
  /** Agents on their way out (`remove.ts`): hidden everywhere until they're gone, or back. */
  ids: readonly string[];
  hide(id: string): void;
  show(id: string): void;
}

export const useHiddenAgents = create<Hidden>((set) => ({
  ids: [],
  hide: (id) => set((s) => ({ ids: s.ids.includes(id) ? s.ids : [...s.ids, id] })),
  show: (id) => set((s) => ({ ids: s.ids.filter((x) => x !== id) })),
}));

/** The list as it looks while some are on their way out: another default if the default is. */
export function withoutHidden(list: AgentList, hidden: readonly string[]): AgentList {
  if (!hidden.length) return list;
  const agents = list.agents.filter((a) => !hidden.includes(a.id));
  if (!agents.length) return list;
  const defaultId = agents.some((a) => a.id === list.defaultId)
    ? list.defaultId
    : (agents[0]?.id ?? list.defaultId);
  return {
    agents: agents.map((a) =>
      a.isDefault === (a.id === defaultId) ? a : { ...a, isDefault: a.id === defaultId },
    ),
    defaultId,
  };
}
