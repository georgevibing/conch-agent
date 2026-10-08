/**
 * 1Password through a service account (AGENTS.md § Adding a password manager,
 * § Secrets in a new feature): the token is tried before it's kept, kept
 * sealed, handed to `op` only in `OP_SERVICE_ACCOUNT_TOKEN`, and never comes
 * back out — not in a response, an error, an argument or a list. The pretend
 * `op` answers as 1Password's CLI documents: `op vault list` and
 * `op item list --vault` with a service account, errors as `[ERROR] <time> <words>`.
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { classify } from '../backup/manifest';
import { protectedPaths } from '../lib/protect';
import { deviceSealer, registerSealer, SEALED_FILES, unregisterSealer } from '../lib/sealed';
import { vaultCheck } from './doctor';
import { VaultService } from './service';
import { SERVICE_ACCOUNT_FILE } from './serviceAccount';
import type { Exec } from './sources';

// Written in two parts, so no scanner takes it for a real one (AGENTS.md agreement 6).
const TOKEN = 'ops_' + 'eyJzaWduSW5BZGRyZXNzIjoibXkuMXBhc3N3b3JkLmNvbSJ9FAKEFAKEFAKE';
const OTHER = 'ops_' + 'eyJzaWduSW5BZGRyZXNzIjoib3RoZXIuMXBhc3N3b3JkLmNvbSJ9OTHEROTHER';

interface Call {
  args: string[];
  env?: Record<string, string>;
}

const VAULTS = [
  { id: 'vlt1', name: 'Servers', content_version: 4 },
  { id: 'vlt2', name: 'Shared', content_version: 2 },
];

const ITEMS: Record<string, unknown[]> = {
  vlt1: [
    {
      id: 'itm1',
      title: 'Router',
      category: 'LOGIN',
      vault: { id: 'vlt1', name: 'Servers' },
      urls: [{ href: 'https://router.example' }],
      additional_information: 'admin',
    },
  ],
  vlt2: [
    {
      id: 'itm2',
      title: 'Team mail',
      category: 'LOGIN',
      vault: { id: 'vlt2', name: 'Shared' },
      urls: [{ href: 'https://mail.example' }],
    },
  ],
};

/**
 * A pretend `op`. With a token it acts as a service account (`accepts` says
 * which tokens it takes); without one, as the desktop app's integration.
 */
function fakeOp(
  calls: Call[],
  world: { accepts: Set<string>; echo?: boolean; itemError?: boolean },
): Exec {
  return {
    find: async (name) => (name === 'op' ? '/fake/op' : undefined),
    run: async (_file, args, options = {}) => {
      calls.push({ args, ...(options.env && { env: options.env }) });
      const ok = (value: unknown) => ({
        stdout: typeof value === 'string' ? value : JSON.stringify(value),
        stderr: '',
        code: 0,
      });
      const token = options.env?.OP_SERVICE_ACCOUNT_TOKEN;
      if (token !== undefined) {
        if (!world.accepts.has(token))
          return {
            stdout: '',
            stderr: `[ERROR] 2026/10/08 09:00:00 failed to session.DecodeSACredentials: invalid token${world.echo ? ` ${token}` : ''}\n`,
            code: 1,
          };
        const cmd = args.slice(0, 2).join(' ');
        if (cmd === 'vault list') return ok(VAULTS);
        const vault = args[args.indexOf('--vault') + 1] ?? '';
        if (cmd === 'item list') {
          // A service account names the vault every time.
          if (!args.includes('--vault'))
            return { stdout: '', stderr: '[ERROR] a vault is required', code: 1 };
          return ok(ITEMS[vault] ?? []);
        }
        if (cmd === 'item get' && world.itemError)
          return { stdout: '', stderr: `[ERROR] 2026/10/08 09:00:00 boom near ${token}`, code: 1 };
        if (cmd === 'item get')
          return ok({
            fields: [
              { id: 'username', type: 'STRING', purpose: 'USERNAME', value: 'admin' },
              { id: 'password', type: 'CONCEALED', purpose: 'PASSWORD', value: `pw-${vault}` },
            ],
          });
        return { stdout: '', stderr: '[ERROR] unknown command', code: 1 };
      }
      // The desktop app's integration.
      if (args[0] === 'account') return ok([{ url: 'my.1password.com' }]);
      if (args.join(' ') === 'item list --format json') return ok(ITEMS.vlt1);
      return { stdout: '', stderr: '[ERROR] unknown command', code: 1 };
    },
  };
}

async function setUp(
  world: { accepts: Set<string>; echo?: boolean; itemError?: boolean } = {
    accepts: new Set([TOKEN]),
  },
) {
  const home = await mkdtemp(join(tmpdir(), 'conch-1p-'));
  const calls: Call[] = [];
  const service = new VaultService({ home, keystore: 'file', exec: fakeOp(calls, world) });
  return { home, calls, service, world };
}

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) unregisterSealer(home);
});

/** The token never on a command line, never in anything Conch hands back. */
function expectNoToken(calls: Call[], ...things: unknown[]) {
  for (const call of calls) expect(call.args.join(' ')).not.toContain('ops_');
  for (const thing of things) expect(JSON.stringify(thing ?? null)).not.toContain(TOKEN);
}

describe('1Password through a service account', () => {
  it('tries the token, keeps it sealed, and never hands it back', async () => {
    const { home, calls, service } = await setUp();
    homes.push(home);
    registerSealer(
      home,
      deviceSealer(async () => Buffer.alloc(32, 7)),
    );

    // Not a token at all: refused before 1Password is asked anything.
    await expect(service.connectOnePassword('hunter2')).rejects.toThrow(/starts with ops_/);
    expect(calls).toEqual([]);

    // A token 1Password doesn't take: plain words, and not the token.
    const refused = await service.connectOnePassword(OTHER).catch((e: Error) => e);
    expect((refused as Error).message).toBe(
      '1Password didn’t accept the service account token. Replace it with a new one.',
    );
    expect((refused as Error).message).not.toContain('ops_');

    // Pasted with a line break in it, as a copy can bring.
    const done = await service.connectOnePassword(` ${TOKEN.slice(0, 20)}\n${TOKEN.slice(20)} `);
    expect(done.vaults).toEqual([
      { id: 'vlt1', name: 'Servers' },
      { id: 'vlt2', name: 'Shared' },
    ]);
    const onePassword = done.sources.find((s) => s.id === '1password');
    expect(onePassword).toMatchObject({
      state: 'ready',
      access: { mode: 'service-account', vaults: done.vaults },
    });
    expect(onePassword?.access?.shown).toBeUndefined();

    // Sealed on disk, out of the agent's reach, only in a passphrase-locked backup.
    const disk = await readFile(join(home, SERVICE_ACCOUNT_FILE), 'utf8');
    expect(disk).toContain('conch-sealed');
    expect(disk).not.toContain('ops_');
    expect(SEALED_FILES.has(SERVICE_ACCOUNT_FILE)).toBe(true);
    expect(protectedPaths(home)).toContain(join(home, SERVICE_ACCOUNT_FILE));
    expect(classify(SERVICE_ACCOUNT_FILE)).toMatchObject({ class: 'secret', group: 'secrets' });

    // A service account asks nobody: it's read even when nobody is looking at Passwords.
    const list = await service.list();
    expect(list.items.map((i) => [i.title, i.source, i.container])).toEqual([
      ['Router', '1password', 'Servers'],
      ['Team mail', '1password', 'Shared'],
    ]);
    const router = list.items.find((i) => i.title === 'Router');
    expect(await service.reveal(router?.id ?? '', 'password', undefined)).toBe('pw-vlt1');

    // Every `op` call carried the token in its own environment, and nowhere else.
    const withToken = calls.filter((c) => c.env?.OP_SERVICE_ACCOUNT_TOKEN === TOKEN);
    expect(withToken.length).toBeGreaterThan(2);
    for (const call of withToken) {
      expect(call.env?.OP_CONNECT_HOST).toBeUndefined();
      expect(call.env?.OP_CONNECT_TOKEN).toBeUndefined();
    }
    // The desktop app's check isn't made: there's no app here.
    expect(calls.some((c) => c.args[0] === 'account')).toBe(false);
    expectNoToken(
      calls,
      done,
      list,
      await service.status(),
      await service.detail(router?.id ?? ''),
    );
    // Known for redaction, so it can't reach a chat.
    expect(await service.secretValues()).toContain(TOKEN);
  });

  it('shows only the vaults chosen, and won’t read an item from another', async () => {
    const { calls, service } = await setUp();
    await service.connectOnePassword(TOKEN);
    const mail = (await service.list()).items.find((i) => i.title === 'Team mail');

    await expect(service.setOnePasswordVaults(['nope'])).rejects.toThrow(/at least one vault/);
    const sources = await service.setOnePasswordVaults(['vlt1']);
    expect(sources.find((s) => s.id === '1password')?.access).toMatchObject({
      mode: 'service-account',
      shown: ['vlt1'],
    });

    calls.length = 0;
    const list = await service.list();
    expect(list.items.map((i) => i.title)).toEqual(['Router']);
    const listed = calls.filter((c) => c.args.slice(0, 2).join(' ') === 'item list');
    expect(listed.map((c) => c.args[c.args.indexOf('--vault') + 1])).toEqual(['vlt1']);
    // An item from a vault Conch no longer shows: refused, without asking 1Password.
    await expect(service.reveal(mail?.id ?? '', 'password', undefined)).rejects.toThrow();
    expect(calls.some((c) => c.args.includes('vlt2'))).toBe(false);
    // Where Copy to can put an item: only the vaults shown.
    expect(list.status.sources.find((s) => s.id === '1password')?.places).toEqual([
      { id: 'vlt1', name: 'Servers' },
    ]);

    // Every vault chosen: every vault, including ones it's given later.
    const all = await service.setOnePasswordVaults(['vlt1', 'vlt2']);
    expect(all.find((s) => s.id === '1password')?.access?.shown).toBeUndefined();
  });

  it('fills only on the item’s own site, as every manager does', async () => {
    const { service } = await setUp();
    await service.connectOnePassword(TOKEN);
    const router = (await service.list()).items.find((i) => i.title === 'Router');
    const want = 'password' as const;
    expect(
      await service.fillValue({ itemId: router?.id ?? '', host: 'router.example', want }),
    ).toBe('pw-vlt1');
    await expect(
      service.fillPolicy({ itemId: router?.id ?? '', host: 'router.example.evil', want }),
    ).rejects.toThrow();
  });

  it('switches back to the app, and disconnects, forgetting the token', async () => {
    const { home, calls, service } = await setUp();
    await service.connectOnePassword(TOKEN);

    const app = await service.forgetOnePassword();
    expect(app.find((s) => s.id === '1password')).toMatchObject({
      state: 'ready',
      access: { mode: 'app' },
    });
    calls.length = 0;
    // The app asks for approval: only read while someone looks, as before.
    expect((await service.list()).items).toEqual([]);
    expect((await service.list({ looking: true })).items.map((i) => i.title)).toEqual(['Router']);
    expect(calls.every((c) => c.env?.OP_SERVICE_ACCOUNT_TOKEN === undefined)).toBe(true);
    expect(calls.map((c) => c.args.join(' '))).toContain('item list --format json');
    expect(await readFile(join(home, SERVICE_ACCOUNT_FILE), 'utf8')).not.toContain('ops_');

    await service.connectOnePassword(TOKEN);
    const off = await service.forgetOnePassword({ disconnect: true });
    expect(off.find((s) => s.id === '1password')).toMatchObject({
      state: 'off',
      access: { mode: 'app' },
    });
    expect(await readFile(join(home, SERVICE_ACCOUNT_FILE), 'utf8')).not.toContain('ops_');
  });

  it('a token that stops working needs you, with the way to replace it; a working one is ok', async () => {
    const { calls, service, world } = await setUp({ accepts: new Set([TOKEN]), echo: true });
    await service.connectOnePassword(TOKEN);
    const look = () =>
      vaultCheck(service).run({ repair: false, signal: new AbortController().signal });
    expect((await look()).find((i) => i.id === 'passwords:1password')).toMatchObject({
      state: 'ok',
      message: expect.stringContaining('service account'),
    });

    // Revoked on 1Password.com — and this `op` even says the token back.
    world.accepts.clear();
    service.onePassword.lock();
    const items = await look();
    const item = items.find((i) => i.id === 'passwords:1password');
    expect(item).toMatchObject({
      state: 'needs-you',
      message: '1Password didn’t accept the service account token. Replace it with a new one.',
      action: { kind: 'open', label: 'Replace the token', place: 'passwords', focus: '1password' },
    });
    const list = await service.list({ looking: true });
    expect(list.items).toEqual([]);
    expectNoToken(calls, items, list);
  });

  it('takes the token out of whatever 1Password says', async () => {
    const { calls, service, world } = await setUp({ accepts: new Set([TOKEN]) });
    await service.connectOnePassword(TOKEN);
    const router = (await service.list()).items.find((i) => i.title === 'Router');
    world.itemError = true;
    const error = (await service
      .reveal(router?.id ?? '', 'password', undefined)
      .catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/^1Password said: boom near/);
    expect(error.message).not.toContain(TOKEN.slice(4));
    expectNoToken(calls, error.message);
  });

  it('says it needs the 1Password command line tool, and gets it through the need', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-1p-'));
    const service = new VaultService({
      home,
      keystore: 'file',
      exec: { find: async () => undefined, run: async () => ({ stdout: '', stderr: '', code: 1 }) },
    });
    await expect(service.connectOnePassword(TOKEN)).rejects.toThrow(/command line tool/);
    await service.setSource('1password', { enabled: true });
    expect((await service.sourceStatus()).find((s) => s.id === '1password')).toMatchObject({
      state: 'missing',
      need: 'op',
    });
    const items = await vaultCheck(service).run({
      repair: false,
      signal: new AbortController().signal,
    });
    expect(items.find((i) => i.id === 'passwords:1password')).toMatchObject({
      state: 'needs-you',
      action: { kind: 'need', need: 'op', mode: 'install' },
    });
  });
});
