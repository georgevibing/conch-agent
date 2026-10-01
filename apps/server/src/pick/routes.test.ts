import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { Access } from '../security';
import { registerPickRoutes } from './routes';

async function app(access: Access | undefined, picked?: string) {
  const pick = vi.fn(() => Promise.resolve(picked));
  const server = Fastify();
  server.addHook('onRequest', async (request) => {
    request.access = access;
  });
  registerPickRoutes(server, pick);
  await server.ready();
  return { server, pick };
}

describe('the Open dialog', () => {
  it('shows on this computer, for a purpose the gateway knows, and a cancel is an answer', async () => {
    const { server, pick } = await app({ kind: 'local' } as Access, '/Users/ada/Passwords.kdbx');
    const res = await server.inject({
      method: 'POST',
      url: '/api/pick',
      payload: { purpose: 'keepassxc-database' },
    });
    expect(res.json()).toEqual({ path: '/Users/ada/Passwords.kdbx' });
    // The page names a purpose; the prompt and file types are the gateway's own.
    expect(pick).toHaveBeenCalledWith(
      expect.objectContaining({ extensions: ['kdbx'], kind: 'file' }),
    );
    const bad = await server.inject({
      method: 'POST',
      url: '/api/pick',
      payload: { purpose: 'anything', prompt: 'x' },
    });
    expect(bad.statusCode).toBe(400);
    const { server: cancelled } = await app({ kind: 'local' } as Access, undefined);
    const none = await cancelled.inject({
      method: 'POST',
      url: '/api/pick',
      payload: { purpose: 'workspace' },
    });
    expect(none.json()).toEqual({});
  });

  it('never opens for another device', async () => {
    const { server, pick } = await app({ kind: 'session' } as Access, '/x');
    const res = await server.inject({
      method: 'POST',
      url: '/api/pick',
      payload: { purpose: 'workspace' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'not-here' });
    expect(pick).not.toHaveBeenCalled();
  });
});
