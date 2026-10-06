import { setImmediate } from 'node:timers/promises';

import type { ServerEvent } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { Emitter } from '../lib/emitter';
import { chat } from './session';

function fixture(instant = false) {
  const events = new Emitter<ServerEvent>();
  const finish = (id: string) =>
    events.emit({
      type: 'conversation.event',
      event: {
        type: 'turn.completed',
        conversationId: id,
        seq: 2,
        at: Date.now(),
        outcome: 'success',
      },
    });
  const respond = vi.fn();
  const services = {
    conversations: {
      events,
      respond,
      send: async (input: { clientMessageId: string }) => {
        events.emit({
          type: 'conversation.event',
          event: {
            type: 'user.message',
            conversationId: 'wanted',
            seq: 0,
            at: Date.now(),
            messageId: input.clientMessageId,
            text: 'Work',
          },
        });
        if (instant) finish('wanted');
        return { id: 'wanted' };
      },
    },
  } as unknown as Parameters<typeof chat>[0];
  return { services, events, finish, respond };
}

describe('the used-Conch chat fixture', () => {
  it('waits for its own reply while unrelated background work finishes or asks for permission', async () => {
    const f = fixture();
    let completed = false;
    const pending = chat(f.services, 'Work').then((result) => {
      completed = true;
      return result;
    });
    f.events.emit({
      type: 'conversation.event',
      event: {
        type: 'permission.requested',
        conversationId: 'background',
        seq: 1,
        at: Date.now(),
        permissionId: 'p1',
        toolName: 'Bash',
        input: {},
        summary: 'Run command',
      },
    });
    f.finish('background');
    await setImmediate();
    expect(completed).toBe(false);
    expect(f.respond).not.toHaveBeenCalled();
    f.finish('wanted');
    expect(await pending).toMatchObject({ id: 'wanted' });
  });

  it('does not miss an immediate reply before send resolves', async () => {
    const f = fixture(true);
    expect(await chat(f.services, 'Work')).toMatchObject({ id: 'wanted' });
  });
});
