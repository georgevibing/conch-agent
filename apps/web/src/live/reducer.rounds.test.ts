/** Agents taking turns, as the chat folds them (ADR 0112). */
import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { reduceAll } from './reducer';

function log(...inputs: ConversationEventInput[]): ConversationEvent[] {
  return inputs.map(
    (e, seq) => ({ ...e, conversationId: 'c1', seq, at: 1000 + seq * 100 }) as ConversationEvent,
  );
}

const speakers = [
  { id: 'ag_research', name: 'Researcher' },
  { id: 'oa_travel1', name: 'Travel', outside: true },
  { id: 'ag_writer1', name: 'Writer' },
];

describe('a round in the chat', () => {
  it('keeps one card where it began, up to date as the floor passes', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: '@Researcher @Travel @Writer go' },
        { type: 'round', roundId: 'r1', state: 'started', speakers },
        { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Options.' },
        { type: 'round', roundId: 'r1', state: 'asking', speakers: [speakers[1] as never] },
      ),
    );
    const card = view.items.find((i) => i.kind === 'round');
    expect(card).toMatchObject({ passes: ['ag_research', 'oa_travel1'], asking: 'oa_travel1' });

    const after = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'go' },
        { type: 'round', roundId: 'r1', state: 'started', speakers },
        { type: 'round', roundId: 'r1', state: 'asking', speakers: [speakers[1] as never] },
        {
          type: 'peer.message',
          roundId: 'r1',
          outsideId: 'oa_travel1',
          name: 'Travel',
          text: 'Flights at 9.',
        },
        {
          type: 'agent',
          agentId: 'ag_writer1',
          name: 'Writer',
          round: { roundId: 'r1', turn: 3 },
        },
        { type: 'round', roundId: 'r1', state: 'ended', turns: 3, reason: 'done' },
      ),
    );
    const done = after.items.find((i) => i.kind === 'round');
    expect(done).toMatchObject({
      passes: ['ag_research', 'oa_travel1', 'ag_writer1'],
      ended: { reason: 'done', turns: 3 },
    });
    expect(done && 'asking' in done ? done.asking : undefined).toBeUndefined();
    expect(after.items.find((i) => i.kind === 'peer')).toMatchObject({
      name: 'Travel',
      text: 'Flights at 9.',
    });
    const handed = after.items.find((i) => i.kind === 'agent');
    expect(handed).toMatchObject({ round: { roundId: 'r1', turn: 3 } });
    expect(after.speaker).toEqual({ agentId: 'ag_writer1', name: 'Writer' });
  });

  it('a round that begins with an outside agent has nobody speaking yet', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: '@Travel flights' },
        { type: 'round', roundId: 'r2', state: 'started', speakers: [speakers[1] as never] },
      ),
    );
    expect(view.items.find((i) => i.kind === 'round')).toMatchObject({ passes: [] });
  });
});
