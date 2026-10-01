/**
 * Passwords keeping things safe with the person in the loop (ADR 0025):
 * the lock, cards in the chat, reads with a yes, Conch's own keys sealed and
 * shown, and the agent's own tools kept away from all of it.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationEventInput, VaultRequest } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AskRequest, ToolContext } from '../conversations/manager';
import type { Engine, HostTool, PermissionDecision } from '../engines/types';
import { hostToolText } from '../engines/types';
import { protectedPaths, touchesProtected } from '../lib/protect';
import { deviceSealer, registerSealer, unregisterSealer } from '../lib/sealed';
import { SettingsStore } from '../settings/store';
import { VaultService } from './service';
import { vaultTools } from './tools';

async function vault() {
  const home = await mkdtemp(join(tmpdir(), 'conch-secure-'));
  return { home, service: new VaultService({ home, keystore: 'file' }) };
}

const login = {
  type: 'login' as const,
  title: 'Bank',
  fields: [
    { label: 'Username', kind: 'text' as const, role: 'username' as const, value: 'ada' },
    {
      label: 'Password',
      kind: 'secret' as const,
      role: 'password' as const,
      value: 'river-otter-copper-42!',
    },
  ],
  urls: ['https://bank.example'],
};

function chat(answers: PermissionDecision[] = []) {
  const events: ConversationEventInput[] = [];
  const asked: AskRequest[] = [];
  const abort = new AbortController();
  const ctx: ToolContext = {
    conversationId: 'c_test',
    append: (event) => events.push(event),
    engine: { hostTools: true } as unknown as Engine,
    permissionMode: 'default',
    ask: (request) => {
      asked.push(request);
      return Promise.resolve(answers.shift() ?? 'deny');
    },
    signal: abort.signal,
  };
  const requests = () =>
    events.flatMap((e) => (e.type === 'vault.request' ? [e.request as VaultRequest] : []));
  return { ctx, events, asked, abort, requests };
}

const tool = (service: VaultService, ctx: ToolContext, name: string) => {
  const t = vaultTools(service, ctx).find((x) => x.name === name) as HostTool;
  return async (args: Record<string, unknown>) => hostToolText(await t.run(args as never));
};

afterEach(() => vi.useRealTimers());

describe('the lock', () => {
  // Several scrypt runs (128 MB each): slow when the whole suite runs at once.
  it(
    'locks with a password: items hidden, wrong guesses slowed, and it opens again',
    { timeout: 60_000 },
    async () => {
      const { home, service } = await vault();
      await service.create(login);
      await service.setLock({ enabled: true, password: 'tide pool seven' });
      // Without the device key the password alone opens nothing: it's mixed in.
      const file = JSON.parse(await readFile(join(home, 'vault', 'vault.json'), 'utf8'));
      expect(file.wrap).toBeUndefined();
      expect(file.lock.kdf).toMatchObject({ name: 'scrypt', N: 2 ** 17 });

      await service.lock();
      const locked = await service.list();
      expect(locked.status.lock).toMatchObject({ enabled: true, locked: true });
      expect(locked.items.filter((i) => i.source === 'conch')).toHaveLength(0);

      for (let i = 0; i < 5; i++)
        await expect(service.unlock('wrong one!')).rejects.toThrow(/isn’t the password/);
      await expect(service.unlock('tide pool seven')).rejects.toThrow(/Too many wrong passwords/);

      // A fresh start (the wait is in memory) with the right one.
      const again = new VaultService({ home, keystore: 'file' });
      await again.unlock('tide pool seven');
      expect((await again.list()).items.map((i) => i.title)).toEqual(['Bank']);
      await again.setLock({ enabled: false });
      const plain = new VaultService({ home, keystore: 'file' });
      expect((await plain.list()).items).toHaveLength(1);
    },
  );

  it('is useless without this computer’s key, whatever the password', async () => {
    const { home, service } = await vault();
    await service.create(login);
    await service.setLock({ enabled: true, password: 'tide pool seven' });
    await writeFile(join(home, 'vault', 'device.key'), `${'cd'.repeat(32)}\n`);
    const elsewhere = new VaultService({ home, keystore: 'file' });
    await expect(elsewhere.unlock('tide pool seven')).rejects.toThrow(/isn’t the password/);
  });

  it('closes by itself after the idle time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { service } = await vault();
    await service.create(login);
    await service.setLock({ enabled: true, password: 'tide pool seven', autoLockMinutes: 5 });
    expect(await service.isLocked()).toBe(false);
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(await service.isLocked()).toBe(true);
    service.stop();
  });

  it('shows an Unlock card when the agent needs it, and carries on once it’s open', async () => {
    const { service } = await vault();
    await service.create(login);
    await service.setLock({ enabled: true, password: 'tide pool seven' });
    await service.lock();
    const c = chat();
    const finding = tool(service, c.ctx, 'passwords_find')({});
    await vi.waitFor(() =>
      expect(c.requests()[0]).toMatchObject({ kind: 'unlock', state: 'waiting' }),
    );
    await service.unlock('tide pool seven');
    expect(await finding).toContain('Bank');
    expect(c.requests().at(-1)).toMatchObject({ kind: 'unlock', state: 'done' });
  });

  it('keeps a passphrase backup from leaving without its key', async () => {
    const { service } = await vault();
    await service.create(login);
    await service.setLock({ enabled: true, password: 'tide pool seven' });
    await service.lock();
    await expect(service.backupFiles()).rejects.toThrow(/Unlock Passwords first/);
  });
});

describe('asking in the chat', () => {
  it('saves what the person types, and the agent only learns its id', async () => {
    const { service } = await vault();
    const c = chat();
    const asking = tool(
      service,
      c.ctx,
      'passwords_request',
    )({
      title: 'GitHub',
      type: 'login',
      site: 'https://github.com/login',
      reason: 'To open your pull requests',
    });
    await vi.waitFor(() =>
      expect(c.requests()[0]).toMatchObject({ kind: 'save', site: 'github.com', state: 'waiting' }),
    );
    const id = c.requests()[0]?.requestId ?? '';
    const itemId = await service.answer(id, {
      title: 'GitHub',
      fields: [
        { label: 'Username', kind: 'text', role: 'username', value: 'ada' },
        { label: 'Password', kind: 'secret', role: 'password', value: 'gh-secret-value-123' },
      ],
    });
    const result = await asking;
    expect(result).toContain(`id=${itemId}`);
    expect(result).not.toContain('gh-secret-value');
    expect(JSON.stringify(c.events)).not.toContain('gh-secret-value');
    expect((await service.detail(itemId)).urls).toEqual(['https://github.com']);
    expect(c.requests().at(-1)).toMatchObject({ state: 'done', itemId });
  });

  it('a no, or the turn ending, is final, and the agent is told not to ask in the chat', async () => {
    const { service } = await vault();
    const c = chat();
    const asking = tool(
      service,
      c.ctx,
      'passwords_request',
    )({ title: 'Key', type: 'apiKey', reason: 'Weather' });
    await vi.waitFor(() => expect(c.requests()).toHaveLength(1));
    service.decline(c.requests()[0]?.requestId ?? '');
    expect(await asking).toMatch(/chose not to give it\. Don’t ask for it again in the chat/);

    const d = chat();
    const waiting = tool(
      service,
      d.ctx,
      'passwords_request',
    )({ title: 'Key', type: 'apiKey', reason: 'Weather' });
    await vi.waitFor(() => expect(d.requests()).toHaveLength(1));
    d.abort.abort();
    expect(await waiting).toMatch(/Nobody filled in the card/);
    await expect(
      service.answer(d.requests()[0]?.requestId ?? '', { title: 'x', fields: [] }),
    ).rejects.toThrow(/isn’t waiting/);
  });
});

describe('reading with a yes', () => {
  it('asks with what and why, says when it’s a secret, and remembers “Always”', async () => {
    const { service } = await vault();
    const card = await service.create({
      type: 'card',
      title: 'Everyday Visa',
      fields: [{ label: 'PIN', kind: 'pin', role: 'cardPin', value: '4821' }],
    });
    const c = chat(['deny', 'allow-always']);
    const read = tool(service, c.ctx, 'passwords_read');
    expect(
      await read({ item: card.id, field: 'PIN', reason: 'The bank’s phone menu asks for it' }),
    ).toMatch(/said no/);
    expect(c.asked[0]?.vault).toMatchObject({
      action: 'read',
      itemTitle: 'Everyday Visa',
      fieldLabel: 'PIN',
      sensitive: true,
      reason: 'The bank’s phone menu asks for it',
    });
    expect(await read({ item: card.id, field: 'PIN', reason: 'again' })).toContain('4821');
    // Now it reads without asking.
    expect(await read({ item: card.id, field: 'pin', reason: 'once more' })).toContain('4821');
    expect(c.asked).toHaveLength(2);
    // And it's blanked from anything logged.
    expect(service.redactor()('the PIN is 4821')).toBe('the PIN is •••');
  });

  it('refuses an item the person said never to use', async () => {
    const { service } = await vault();
    const hidden = await service.create({ ...login, agentAccess: 'never' });
    const c = chat(['allow']);
    expect(await tool(service, c.ctx, 'passwords_read')({ item: hidden.id, reason: 'x' })).toMatch(
      /never to be used/,
    );
    expect(c.asked).toHaveLength(0);
  });
});

describe('payment cards', () => {
  it('fill on any real checkout, and always ask', async () => {
    const { service } = await vault();
    const card = await service.create({
      type: 'card',
      title: 'Everyday Visa',
      fields: [{ label: 'Number', kind: 'secret', role: 'cardNumber', value: '4111111111111111' }],
      agentAccess: 'allow',
    });
    expect(
      await service.fillPolicy({ itemId: card.id, host: 'shop.example', want: 'cardNumber' }),
    ).toMatchObject({ ask: true });
    expect(await service.cards()).toHaveLength(1);
  });
});

describe('Conch’s own keys', () => {
  it('are sealed on disk, a plain file from before is sealed when read, and they still read back', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-sealed-'));
    const service = new VaultService({ home, keystore: 'file' });
    await writeFile(
      join(home, 'secrets.json'),
      JSON.stringify({
        providers: { openrouter: { source: 'conch', value: 'sk-or-v1-plain-legacy', savedAt: 1 } },
      }),
    );
    registerSealer(
      home,
      deviceSealer(() => service.deviceKey()),
    );
    try {
      const settings = new SettingsStore(home);
      expect(await settings.providerSecret('openrouter')).toMatchObject({
        value: 'sk-or-v1-plain-legacy',
      });
      const onDisk = await readFile(join(home, 'secrets.json'), 'utf8');
      expect(onDisk).toMatch(/^\{"conch-sealed":1/);
      expect(onDisk).not.toContain('sk-or-v1');
      await settings.setProviderSecret('openrouter', {
        source: 'conch',
        value: 'sk-or-v1-new-one-123',
        savedAt: 2,
      });
      expect(await readFile(join(home, 'secrets.json'), 'utf8')).not.toContain('sk-or-v1');
      expect(await new SettingsStore(home).providerSecret('openrouter')).toMatchObject({
        value: 'sk-or-v1-new-one-123',
      });
    } finally {
      unregisterSealer(home);
    }
  });

  it('show in Passwords without their values, and reveal only for a person', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-system-'));
    const service = new VaultService({
      home,
      keystore: 'file',
      systemKeys: async () => [
        {
          id: 'sys_openrouter',
          title: 'OpenRouter key',
          usedBy: 'OpenRouter',
          hint: '…9abc',
          manage: { label: 'Open Providers', place: 'providers' },
          reveal: async () => 'sk-or-v1-system-9abc',
        },
      ],
    });
    const list = await service.list();
    expect(list.items).toEqual([
      expect.objectContaining({ id: 'sys_openrouter', source: 'system', readOnly: true }),
    ]);
    expect(JSON.stringify(list)).not.toContain('sk-or-v1');
    expect((await service.detail('sys_openrouter')).manage).toMatchObject({ place: 'providers' });
    expect(await service.reveal('sys_openrouter', 'key', undefined)).toBe('sk-or-v1-system-9abc');
    // Never offered to the agent.
    expect(await service.forAgent()).toEqual([]);
  });
});

describe('the agent’s own tools', () => {
  it('can’t name Passwords or Conch’s keys, however the path is written', () => {
    const paths = protectedPaths('/Users/ada/.conch');
    expect(touchesProtected({ file_path: '/Users/ada/.conch/vault/vault.json' }, paths)).toBe(true);
    expect(
      touchesProtected({ command: 'cat /Users/ada/.conch/secrets.json | base64' }, paths),
    ).toBe(true);
    expect(touchesProtected({ command: 'ls /Users/ada/.conch/conversations' }, paths)).toBe(false);
    expect(touchesProtected({ pattern: 'x', path: '/Users/ada/work' }, paths)).toBe(false);
  });
});
