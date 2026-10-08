/**
 * Agents taking turns, in the chat (ADR 0112): the round's card where it
 * began, and an outside agent's words as theirs.
 */
import { OUTSIDE_LIMITS, ROUND_END_WORDS, ROUND_LIMITS } from '@conch/protocol';
import { AgentRound, OutsideReply, toast, type RoundFace } from '@conch/nacre';

import { useState } from 'react';

import type { TranscriptItem } from '../../live/reducer';
import { Markdown } from '../chat/Markdown';
import { useAgents } from './api';
import { outsideApi } from './outside';

type RoundItemData = Extract<TranscriptItem, { kind: 'round' }>;
type PeerItemData = Extract<TranscriptItem, { kind: 'peer' }>;

/** A round that's said nothing for this long, with nothing running, ended with Conch (a restart). */
const QUIET_MS = OUTSIDE_LIMITS.answerMs + 60_000;

export function RoundItem({
  item,
  conversationId,
  running,
  now: given,
}: {
  item: RoundItemData;
  conversationId?: string;
  running: boolean;
  /** For tests. */
  now?: number;
}) {
  const { data: list } = useAgents();
  // When the page first drew it: a round quiet since long before then ended with Conch.
  const [seen] = useState(Date.now);
  const now = given ?? seen;
  const agentOf = (id: string) => list?.agents.find((a) => a.id === id);
  // Everyone named, then anyone an agent handed the floor to.
  const ids = [...new Set([...item.speakers.map((s) => s.id), ...item.passes])];
  const faces = ids.flatMap((id): RoundFace[] => {
    const named = item.speakers.find((s) => s.id === id);
    const agent = agentOf(id);
    if (named?.outside) return [{ id, name: named.name, outside: true }];
    const name = agent?.name ?? named?.name;
    return name ? [{ id, name, ...(agent?.avatar && { avatar: agent.avatar }) }] : [];
  });
  const quiet = !item.ended && !running && now - item.at > (item.asking ? QUIET_MS : 10_000);
  const ended = item.ended
    ? { words: ROUND_END_WORDS[item.ended.reason] }
    : quiet
      ? { words: '' }
      : undefined;
  const speaking = ended ? undefined : (item.asking ?? (running ? item.passes.at(-1) : undefined));
  return (
    <AgentRound
      faces={faces}
      passes={item.passes}
      {...(speaking && { speaking })}
      limit={ROUND_LIMITS.turns}
      {...(ended && { ended })}
      {...(!ended &&
        conversationId && {
          onStop: () =>
            void outsideApi
              .stopRound(conversationId)
              .catch((error: Error) => toast.error(error.message || 'The round didn’t stop.')),
        })}
    />
  );
}

/** What an outside agent said: someone else's words, drawn as theirs, loading nothing from elsewhere. */
export function PeerItem({ item }: { item: PeerItemData }) {
  return (
    <OutsideReply name={item.name} {...(item.failed && { failed: true })}>
      {item.failed ? item.text : <Markdown text={item.text} sealed />}
    </OutsideReply>
  );
}
