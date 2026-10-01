/**
 * The Passwords routes' guards (ADR 0025): seeing a value needs a sign-in
 * from the last five minutes, the vault is never reached from another site
 * or without signing in, and values are never cached.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cookieOf, gateway, PASSWORD, type Gateway } from '../test/session';

vi.setConfig({ testTimeout: 60_000 });

const opened: Gateway[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const g of opened.splice(0)) await g.app.close();
});

async function signedIn() {
  const g = await gateway();
  opened.push(g);
  const res = await g.app.inject({
    method: 'PUT',
    url: '/api/access/password',
    payload: { username: 'ada', password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  const cookie = cookieOf(res);
  const saved = await g.app.inject({
    method: 'POST',
    url: '/api/vault/items',
    headers: { cookie },
    payload: {
      type: 'login',
      title: 'Bank',
      fields: [
        { label: 'Password', kind: 'secret', role: 'password', value: 'river-otter-copper-42!' },
      ],
      urls: ['https://bank.example'],
    },
  });
  expect(saved.statusCode).toBe(200);
  const item = JSON.parse(saved.body) as { id: string; fields: { id: string }[] };
  return { g, cookie, id: item.id, fieldId: item.fields[0]?.id ?? '' };
}

describe('Passwords routes', () => {
  it('shows a value right after signing in, then asks again after five minutes', async () => {
    const { g, cookie, id, fieldId } = await signedIn();
    const reveal = () =>
      g.app.inject({
        method: 'POST',
        url: `/api/vault/items/${id}/reveal`,
        headers: { cookie },
        payload: { fieldId },
      });
    const fresh = await reveal();
    expect(fresh.statusCode).toBe(200);
    expect(fresh.headers['cache-control']).toBe('no-store');

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60_000);
    const stale = await reveal();
    expect(stale.statusCode).toBe(403);
    expect(JSON.parse(stale.body)).toMatchObject({ error: 'verify-required' });
    expect(stale.body).not.toContain('river-otter');
    // The list and the item's page still open: only values need the recent sign-in.
    expect((await g.app.inject({ url: '/api/vault', headers: { cookie } })).statusCode).toBe(200);
    expect(
      (await g.app.inject({ method: 'POST', url: '/api/vault/export', headers: { cookie } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await g.app.inject({ url: `/api/vault/items/${id}/history`, headers: { cookie } }))
        .statusCode,
    ).toBe(403);
  });

  it('refuses other sites, other ports and nobody signed in', async () => {
    const { g, cookie, id, fieldId } = await signedIn();
    const crossSite = await g.app.inject({
      method: 'POST',
      url: `/api/vault/items/${id}/reveal`,
      headers: { cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      payload: { fieldId },
    });
    expect(crossSite.statusCode).toBe(403);
    const otherPort = await g.app.inject({
      method: 'POST',
      url: `/api/vault/items/${id}/reveal`,
      headers: { cookie, origin: 'http://localhost:9999' },
      payload: { fieldId },
    });
    expect(otherPort.statusCode).toBe(403);
    expect((await g.app.inject('/api/vault')).statusCode).toBe(401);
  });

  it('refuses ids that could be paths, and sources that don’t exist', async () => {
    const { g, cookie } = await signedIn();
    expect(
      (await g.app.inject({ url: '/api/vault/items/..%2F..%2Fsettings', headers: { cookie } }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await g.app.inject({
          method: 'PATCH',
          url: '/api/vault/sources/lastpass',
          headers: { cookie },
          payload: { enabled: true },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('never lists a value, even for an item with every kind of secret', async () => {
    const { g, cookie } = await signedIn();
    await g.app.inject({
      method: 'POST',
      url: '/api/vault/items',
      headers: { cookie },
      payload: {
        type: 'card',
        title: 'Visa',
        fields: [
          { label: 'Number', kind: 'secret', role: 'cardNumber', value: '4111111111111111' },
          { label: 'Security code', kind: 'pin', role: 'cvv', value: 'cvv-seven-three-seven' },
          { label: 'PIN', kind: 'pin', role: 'cardPin', value: 'pin-nine-one-eight-two' },
        ],
      },
    });
    const list = (await g.app.inject({ url: '/api/vault', headers: { cookie } })).body;
    expect(list).toContain('•••• 1111');
    expect(list).not.toMatch(/4111111111111111|cvv-seven|pin-nine|river-otter/);
  });
});
