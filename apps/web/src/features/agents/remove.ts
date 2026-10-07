/**
 * Deleting an agent, with a moment to change your mind (ADR 0101): it goes
 * from every picker, the chat and Settings at once, and a toast offers Undo.
 * Only when the toast has gone is the gateway told, so Undo puts back exactly
 * what was there: its id, its picture, the chats that are with it.
 */
import type { Agent } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { agentKeys, agentsApi } from './api';
import { useHiddenAgents } from './hidden';

/** How long Undo is offered (ms). */
export const UNDO_FOR = 6000;

/** Deletions not sent yet: a page closing sends them on its way out. */
const waiting = new Map<string, ReturnType<typeof setTimeout>>();

function sendNow(id: string) {
  void fetch(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true });
}

if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => {
    for (const [id, timer] of waiting) {
      clearTimeout(timer);
      sendNow(id);
    }
    waiting.clear();
  });

/** Delete an agent, with Undo. Never the last one: the gallery doesn't offer it. */
export function useRemoveAgent() {
  const client = useQueryClient();
  return (agent: Pick<Agent, 'id' | 'name'>) => {
    const { hide, show } = useHiddenAgents.getState();
    hide(agent.id);
    const bring = () => {
      const timer = waiting.get(agent.id);
      if (timer) clearTimeout(timer);
      waiting.delete(agent.id);
      show(agent.id);
    };
    waiting.set(
      agent.id,
      setTimeout(() => {
        waiting.delete(agent.id);
        agentsApi.remove(agent.id).then(
          async () => {
            await client.invalidateQueries({ queryKey: agentKeys.list });
            show(agent.id);
          },
          (error: unknown) => {
            show(agent.id);
            toast.error(
              error instanceof Error ? error.message : `${agent.name} couldn’t be deleted.`,
            );
          },
        );
      }, UNDO_FOR),
    );
    toast(`${agent.name} deleted`, {
      duration: UNDO_FOR,
      action: { label: 'Undo', onClick: bring },
    });
  };
}
