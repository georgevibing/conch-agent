import type { Agent, AgentId, AgentList } from '@conch/protocol';
import { AgentPicker } from '@conch/nacre';

import { useAgents } from './api';
import { pickable } from './ChatAgent';

/** What it's called where something is given an agent of its own: a routine, a chat app. */
export const ANSWERED_BY = 'Answered by';

/** Its own agent, when it has one that's still there; else none (the default answers). */
export function ownAgent(
  list: Pick<AgentList, 'agents'> | undefined,
  agentId: string | null | undefined,
): Agent | undefined {
  return agentId ? list?.agents.find((a) => a.id === agentId) : undefined;
}

/**
 * Who answers something that isn't a chat yet (ADR 0101): its own agent, or
 * the default one at the time. `own` is undefined for the default.
 */
export function useAnswering(agentId: string | null | undefined) {
  const { data: list } = useAgents();
  const own = ownAgent(list, agentId);
  const fallback = list?.agents.find((a) => a.id === list.defaultId);
  return {
    list,
    own,
    /** Who it is today. */
    agent: own ?? fallback,
    /** Worth choosing (and saying) only once there's more than one. */
    choosable: (list?.agents.length ?? 0) > 1 && Boolean(fallback),
  };
}

/**
 * The same picker as the chat's ("Answer with"), for a routine or a chat app:
 * every agent by its face and name, and first the default agent, which is
 * `null` (whoever is the default when it's needed). Nothing with one agent.
 */
export function AgentChoice({
  value,
  onValueChange,
}: {
  value: string | null | undefined;
  onValueChange: (agentId: AgentId | null) => void;
}) {
  const { list, own, choosable } = useAnswering(value);
  const fallback = list?.agents.find((a) => a.id === list.defaultId);
  if (!list || !fallback || !choosable) return null;
  return (
    <AgentPicker
      variant="chip"
      heading="Answer with"
      agents={pickable(list.agents)}
      value={own?.id ?? null}
      label={(name) => `${ANSWERED_BY} ${name}. Choose another agent`}
      fallback={{
        label: 'Default agent',
        agent: { name: fallback.name, avatar: fallback.avatar },
        role: `${fallback.name}, while it’s the default`,
      }}
      onValueChange={(id: string | null) => {
        const agent = ownAgent(list, id);
        if ((agent?.id ?? null) !== (own?.id ?? null)) onValueChange(agent?.id ?? null);
      }}
    />
  );
}
