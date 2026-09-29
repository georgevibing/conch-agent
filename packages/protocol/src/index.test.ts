import { describe, expect, it } from 'vitest';

import { ClientCommand, isSessionEvent, ServerEvent } from './index';

describe('protocol', () => {
  it('applies defaults to client commands', () => {
    const cmd = ClientCommand.parse({ type: 'session.send', sessionId: 's1', text: 'hi' });
    expect(cmd).toEqual({ type: 'session.send', sessionId: 's1', text: 'hi', attachments: [] });
  });

  it('rejects unknown command types', () => {
    expect(ClientCommand.safeParse({ type: 'session.nuke', sessionId: 's1' }).success).toBe(false);
  });

  it('distinguishes ordered session events', () => {
    const delta = ServerEvent.parse({
      type: 'message.delta',
      sessionId: 's1',
      seq: 4,
      at: 0,
      messageId: 'm1',
      kind: 'text',
      delta: 'Hel',
    });
    const hello = ServerEvent.parse({ type: 'hello', protocolVersion: 1, serverVersion: '0.1.0' });
    expect(isSessionEvent(delta)).toBe(true);
    expect(isSessionEvent(hello)).toBe(false);
  });
});
