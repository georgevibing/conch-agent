/**
 * Typing `@` in the composer lists who can be brought in (ADR 0112): your
 * agents, then outside agents. Choosing one writes its whole name, so the
 * message names it exactly; several named in one message take turns.
 */
import { mentionTyped } from '@conch/protocol';
import { AgentAvatar, Avatar, useCommandMenu, type CommandItem } from '@conch/nacre';
import { useMemo, useState } from 'react';

import { useAgents } from './api';
import { useOutsideAgents } from './outside';

export function useMentions({
  draft,
  setDraft,
}: {
  draft: string;
  setDraft: (text: string) => void;
}) {
  const { data: list } = useAgents();
  const { data: outside } = useOutsideAgents();
  // Escape closes the list for what's typed now; typing on opens it again.
  const [dismissed, setDismissed] = useState<string>();

  const items = useMemo<CommandItem[]>(
    () => [
      ...(list?.agents ?? []).map((agent) => ({
        id: agent.id,
        name: agent.name,
        ...(agent.role && { description: agent.role }),
        group: 'Your agents',
        icon: <AgentAvatar name={agent.name} avatar={agent.avatar} size="xs" decorative />,
      })),
      ...(outside?.agents ?? []).map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description || 'An outside agent',
        group: 'Outside agents',
        icon: <Avatar name={agent.name} size="xs" aria-hidden />,
      })),
    ],
    [list, outside],
  );

  // A command is the slash menu's; with only one agent there's nobody to bring in.
  const typed = draft.startsWith('/') ? undefined : mentionTyped(draft);
  const query = typed && dismissed !== draft && items.length > 1 ? typed.query : null;

  const menu = useCommandMenu({
    items,
    query,
    label: 'Agents to bring in',
    empty: 'No agent by that name.',
    onSelect: (item) => {
      if (!typed) return;
      setDraft(`${draft.slice(0, typed.at)}@${item.name} `);
    },
    onClose: () => setDismissed(draft),
  });
  return { open: query !== null, menu };
}
