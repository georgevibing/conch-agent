import type { EngineId } from '@conch/protocol';

import type { TranscriptItem } from '../../live/reducer';

/** Another provider carrying a chat on for its own (ADR 0023, ADR 0126). */
export interface Carried {
  /** The chat's own provider, offline or at its limit. */
  from: EngineId;
  /** Who answers for it now, and with which model when it's known. */
  engine: EngineId;
  model?: string;
}

/**
 * Who answers this chat for its own provider right now: the latest line where
 * another carried it on, while every reply since is that one's. Nothing once
 * its own provider answers again (the limit reset, it's back online), it was
 * switched back, someone switched models, or the move was for good — then the
 * chat's own choice says so.
 */
export function carriedBy(items: readonly TranscriptItem[]): Carried | undefined {
  const at = items.findLastIndex((i) => i.kind === 'routed' || i.kind === 'switched');
  const line = items[at];
  if (line?.kind !== 'routed' || line.stayed || line.back) return undefined;
  const answered = items.slice(at + 1).findLast((i) => i.kind === 'turn-end' && i.engine);
  if (answered?.kind !== 'turn-end') {
    return { from: line.from, engine: line.to, ...(line.model && { model: line.model }) };
  }
  if (answered.engine !== line.to) return undefined;
  const model = answered.model ?? line.model;
  return { from: line.from, engine: line.to, ...(model && { model }) };
}
