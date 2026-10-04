import type { ConversationEvent } from '@conch/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import { NEW, useLiveStore } from './store';

const event = (seq: number, e: Record<string, unknown>) =>
  ({ conversationId: 'c1', seq, at: 1000 + seq, ...e }) as ConversationEvent;

describe('Stop, in the store', () => {
  beforeEach(() => useLiveStore.setState({ views: {}, pending: {}, created: {}, stopping: {} }));

  it('stays stopped while the provider winds down, until the gateway ends the turn', () => {
    const live = useLiveStore.getState();
    live.apply(event(0, { type: 'user.message', messageId: 'u1', text: 'Go' }));
    live.apply(event(1, { type: 'status', status: 'running' }));
    live.stop('c1');
    expect('c1' in useLiveStore.getState().stopping).toBe(true);
    live.apply(event(2, { type: 'tool.finished', toolUseId: 't1', status: 'error' }));
    expect('c1' in useLiveStore.getState().stopping).toBe(true);
    live.apply(event(3, { type: 'turn.completed', outcome: 'interrupted' }));
    expect('c1' in useLiveStore.getState().stopping).toBe(false);
  });

  it('a new chat stopped before it had an id stays stopped under its id', () => {
    const live = useLiveStore.getState();
    live.addPending(NEW, { clientMessageId: 'u1', text: 'Go', at: 1 });
    live.stop(NEW);
    live.markCreated('u1', 'c1');
    const { stopping } = useLiveStore.getState();
    expect(NEW in stopping).toBe(false);
    expect('c1' in stopping).toBe(true);
  });

  it('nothing was running after all: the next idle settles it', () => {
    const live = useLiveStore.getState();
    live.stop('c1');
    live.apply(event(0, { type: 'status', status: 'idle' }));
    expect('c1' in useLiveStore.getState().stopping).toBe(false);
  });
});
