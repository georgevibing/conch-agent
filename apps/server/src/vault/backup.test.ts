/**
 * Passwords in backups (ADR 0025): only in a passphrase-locked backup, and
 * then they open on another computer; a plain backup never carries them.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyPendingRestore } from '../backup/restore';
import { gateway, type Gateway } from '../test/session';

vi.setConfig({ testTimeout: 90_000 });

const PASSPHRASE = 'seven lemons sail past the harbour';
const opened: Gateway[] = [];
async function open(home?: string) {
  const g = await gateway(home);
  opened.push(g);
  return g;
}
afterEach(async () => {
  for (const g of opened.splice(0)) await g.app.close();
});

async function backUp(g: Gateway, passphrase?: string): Promise<Buffer> {
  const created = await g.app.inject({
    method: 'POST',
    url: '/api/backups',
    payload: { chats: false, ...(passphrase && { passphrase }) },
  });
  expect(created.statusCode).toBe(200);
  const id = String((JSON.parse(created.body) as { id: string }).id);
  return (await g.app.inject(`/api/backups/${id}/download`)).rawPayload;
}

async function restoreInto(g: Gateway, file: Buffer, passphrase?: string): Promise<Gateway> {
  const uploaded = await g.app.inject({
    method: 'POST',
    url: '/api/backups/upload',
    headers: { 'content-type': 'application/octet-stream' },
    payload: file,
  });
  expect(uploaded.statusCode).toBe(200);
  const id = String((JSON.parse(uploaded.body) as { id: string }).id);
  const restored = await g.app.inject({
    method: 'POST',
    url: `/api/backups/${id}/restore`,
    payload: passphrase ? { passphrase } : { skipSecrets: true },
  });
  expect(restored.statusCode).toBe(200);
  await g.app.close();
  opened.splice(opened.indexOf(g), 1);
  expect((await applyPendingRestore(g.home)).kind).toBe('applied');
  return open(g.home);
}

const item = {
  type: 'login',
  title: 'Bank',
  fields: [
    { label: 'Username', kind: 'text', role: 'username', value: 'ada' },
    { label: 'Password', kind: 'secret', role: 'password', value: 'river-otter-copper-42!' },
  ],
  urls: ['https://bank.example'],
};

describe('passwords in backups', () => {
  it('come back on another computer from a passphrase backup, and the key never stays on disk', async () => {
    const a = await open();
    const saved = await a.app.inject({ method: 'POST', url: '/api/vault/items', payload: item });
    expect(saved.statusCode).toBe(200);
    const file = await backUp(a, PASSPHRASE);

    // Another computer: its own device key, so the vault file alone wouldn't open.
    let b = await open();
    await b.app.inject({
      method: 'POST',
      url: '/api/vault/items',
      payload: { ...item, title: 'Only here' },
    });
    b = await restoreInto(b, file, PASSPHRASE);
    const list = JSON.parse((await b.app.inject('/api/vault')).body) as {
      items: { id: string; title: string }[];
    };
    expect(list.items.map((i) => i.title)).toEqual(['Bank']);
    const detail = JSON.parse(
      (await b.app.inject(`/api/vault/items/${list.items[0]?.id}`)).body,
    ) as {
      fields: { id: string; role?: string }[];
    };
    const password = detail.fields.find((f) => f.role === 'password');
    const revealed = await b.app.inject({
      method: 'POST',
      url: `/api/vault/items/${list.items[0]?.id}/reveal`,
      payload: { fieldId: password?.id },
    });
    expect(JSON.parse(revealed.body)).toEqual({ value: 'river-otter-copper-42!' });
    // Moved into this computer's keystore, then deleted.
    expect(await readdir(join(b.home, 'vault'))).not.toContain('key.json');
  });

  it('never travel in a backup without a passphrase', async () => {
    const a = await open();
    await a.app.inject({ method: 'POST', url: '/api/vault/items', payload: item });
    const file = await backUp(a);
    let b = await open();
    await b.app.inject({
      method: 'POST',
      url: '/api/vault/items',
      payload: { ...item, title: 'Only here' },
    });
    b = await restoreInto(b, file);
    // What was here stays; nothing from the plain backup came in.
    const list = JSON.parse((await b.app.inject('/api/vault')).body) as {
      items: { title: string }[];
    };
    expect(list.items.map((i) => i.title)).toEqual(['Only here']);
  });
});
