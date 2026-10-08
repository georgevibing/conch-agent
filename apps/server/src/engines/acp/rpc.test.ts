import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { AcpConnection } from './rpc';

function connection() {
  const input = new PassThrough();
  const output = new PassThrough();
  let closed = false;
  const acp = new AcpConnection(
    {
      input,
      output,
      close: () => {
        closed = true;
      },
    },
    'Gemini',
  );
  return { acp, output, closed: () => closed };
}

describe('an ACP agent that sends a photo back', () => {
  it('reads on past a 20 MB replayed photo, without closing', async () => {
    const { acp, output, closed } = connection();
    const updates: unknown[] = [];
    acp.onNotification((_method, params) => updates.push(params));
    const answer = acp.request('session/load', { sessionId: 's1' });
    const photo = Buffer.alloc(15_000_000, 9).toString('base64');
    const replay = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'image', mimeType: 'image/jpeg', data: photo },
        },
      },
    };
    const bytes = Buffer.from(`${JSON.stringify(replay)}\n{"jsonrpc":"2.0","id":1,"result":{}}\n`);
    for (let at = 0; at < bytes.length; at += 1_000_000)
      output.write(bytes.subarray(at, at + 1_000_000));
    await expect(answer).resolves.toEqual({});
    expect(updates).toEqual([
      {
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'image', mimeType: 'image/jpeg', data: '' },
        },
      },
    ]);
    expect(closed()).toBe(false);
    expect(acp.closed).toBe(false);
  });
});
