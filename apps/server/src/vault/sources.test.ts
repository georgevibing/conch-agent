import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseImport } from './importers';
import { fromBitwarden, isEs256Key, toCdp, toPasskey } from './passkeys';
import { VaultService } from './service';
import {
  DashlaneSource,
  type Exec,
  KeeperSource,
  KeychainSource,
  parseKeychainDump,
  ProtonPassSource,
} from './sources';

async function vault(deps: Partial<ConstructorParameters<typeof VaultService>[0]> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-sources-'));
  return { home, service: new VaultService({ home, keystore: 'file', ...deps }) };
}

const TOTP = 'otpauth://totp/Mail:ada?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=Mail';

function es256(): { pkcs8: string; jwk: Record<string, unknown> } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    pkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
    jwk: privateKey.export({ format: 'jwk' }) as Record<string, unknown>,
  };
}

interface Call {
  file: string;
  args: string[];
  env?: Record<string, string>;
  input?: string;
}

/** Programs that answer like the real ones (shapes read in each one's source). */
function exec(
  calls: Call[],
  answers: Record<
    string,
    (args: string[], env?: Record<string, string>) => string | { stderr: string }
  >,
): Exec {
  return {
    find: async (name) => `/fake/${name}`,
    run: async (file, args, options = {}) => {
      calls.push({
        file,
        args,
        ...(options.env && { env: options.env }),
        ...(options.input !== undefined && { input: options.input }),
      });
      const tool = file.split('/').pop() ?? '';
      const answer = answers[tool]?.(args, options.env);
      if (answer === undefined) return { stdout: '', stderr: 'unknown command', code: 1 };
      if (typeof answer === 'object') return { stdout: '', stderr: answer.stderr, code: 1 };
      return { stdout: answer, stderr: '', code: 0 };
    },
  };
}

/** Nothing secret is ever an argument; list output keeps no secret. */
function expectNoSecretsIn(calls: Call[], secrets: string[]) {
  for (const call of calls)
    for (const secret of secrets) expect(call.args.join(' ')).not.toContain(secret);
}

describe('Proton Pass', () => {
  const proton = (calls: Call[], signedIn = true) =>
    exec(calls, {
      'pass-cli': (args) => {
        if (!signedIn) return { stderr: 'This operation requires an authenticated client' };
        const cmd = args.slice(0, 2).join(' ');
        if (cmd === 'vault list')
          return JSON.stringify({
            vaults: [{ name: 'Personal', vault_id: 'v1', share_id: 'SHARE_one_1' }],
          });
        if (cmd === 'item list')
          return JSON.stringify({
            items: [
              {
                id: 'ITEM_mail_1',
                share_id: 'SHARE_one_1',
                vault_id: 'v1',
                state: 'Active',
                title: 'Mail',
                item_type: 'login',
                modify_time: '2026-09-01T10:00:00',
              },
            ],
          });
        if (cmd === 'item view')
          return JSON.stringify({
            item: {
              content: {
                title: 'Mail',
                note: 'Recovery codes are in the safe',
                content: {
                  Login: {
                    email: 'ada@example.com',
                    username: '',
                    password: 'proton-secret-value',
                    urls: ['https://mail.example'],
                    totp_uri: TOTP,
                    passkeys: [],
                  },
                },
                extra_fields: [{ name: 'PIN', content: { Hidden: '4821' } }],
              },
            },
            attachments: [],
          });
        return undefined as unknown as string;
      },
    });

  it('lists without secrets, reads one item through pass-cli, and says how to sign in', async () => {
    const calls: Call[] = [];
    const source = new ProtonPassSource(proton(calls));
    expect((await source.state()).state).toBe('ready');
    const items = await source.list();
    expect(items).toMatchObject([{ title: 'Mail', type: 'login', container: 'Personal' }]);
    expect(JSON.stringify(items)).not.toContain('proton-secret');
    const ref = items[0]?.ref ?? '';
    expect(ref).toMatch(/^pp_[A-Za-z0-9_-]+$/);
    const { fields } = await source.fields(ref);
    expect(JSON.stringify(fields)).not.toMatch(/proton-secret|4821/);
    expect(await source.value(ref, 'password')).toBe('proton-secret-value');
    expect(await source.totp(ref)).toMatch(/^\d{6}$/);
    expect((await source.full(ref)).fields.map((f) => f.label)).toEqual([
      'Email',
      'Password',
      'One-time code',
      'PIN',
    ]);
    expectNoSecretsIn(calls, ['proton-secret-value']);
    // Never left waiting at a prompt.
    expect(calls.every((c) => c.input === '')).toBe(true);

    const out = new ProtonPassSource(proton([], false));
    expect(await out.state()).toMatchObject({
      state: 'locked',
      message: expect.stringMatching(/pass-cli login/),
    });
  });
});

describe('Dashlane', () => {
  const dashlane = (calls: Call[], locked = false) =>
    exec(calls, {
      dcli: (args, env) => {
        if (args[0] === 'status')
          return `Logged in: Yes\nLogin: ada@example.com\nLocked: ${locked ? 'Yes' : 'No'}\n`;
        if (locked && env?.DASHLANE_MASTER_PASSWORD !== 'dash-master')
          return { stderr: 'The master password is invalid' };
        if (args[0] === 'password')
          return JSON.stringify([
            {
              id: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
              title: 'Shop',
              login: 'ada',
              password: 'dash-secret-value',
              url: 'https://shop.example',
              note: 'dash-private-note',
              otpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
              modificationDatetime: '1756720000',
            },
          ]);
        if (args[0] === 'note')
          return JSON.stringify([
            {
              id: '{11111111-2222-3333-4444-555555555555}',
              title: 'Safe',
              content: 'dash-note-body',
            },
          ]);
        return undefined as unknown as string;
      },
    });

  it('keeps only names, accounts and sites from its list, and its password off the command line', async () => {
    const calls: Call[] = [];
    const source = new DashlaneSource(dashlane(calls, true));
    expect((await source.state()).state).toBe('locked');
    await expect(source.unlockWith('nope')).rejects.toThrow(/master password/);
    await source.unlockWith('dash-master');
    expect((await source.state()).state).toBe('ready');
    const items = await source.list();
    expect(items.map((i) => [i.title, i.type, i.subtitle])).toEqual([
      ['Shop', 'login', 'ada'],
      ['Safe', 'note', ''],
    ]);
    expect(JSON.stringify(items)).not.toMatch(/dash-secret|dash-private|dash-note-body|JBSWY/);
    const shop = items[0]?.ref ?? '';
    expect(shop).toBe('dl_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(await source.value(shop, 'password')).toBe('dash-secret-value');
    expect(await source.totp(shop)).toMatch(/^\d{6}$/);
    expect((await source.full(items[1]?.ref ?? '')).fields[0]?.value).toBe('dash-note-body');
    expectNoSecretsIn(calls, ['dash-master', 'dash-secret-value']);
    expect(
      calls
        .filter((c) => c.args[0] !== 'status')
        .every((c) => c.env?.DASHLANE_MASTER_PASSWORD === 'dash-master' || c.args[0] === 'note'),
    ).toBe(true);
    source.lock();
    expect((await source.state()).state).toBe('locked');
  });
});

describe('Keeper', () => {
  const key = es256();
  const keeper = (calls: Call[], persistent = true) =>
    exec(calls, {
      keeper: (args, env) => {
        if (!persistent && env?.KEEPER_PASSWORD !== 'keeper-master')
          return { stderr: 'Enter password for ada@example.com' };
        const cmd = args.slice(1);
        if (cmd[0] === 'list')
          return JSON.stringify([
            {
              record_uid: 'AbCdEfGhIjKlMnOpQrStUv',
              type: 'login',
              title: 'Forum',
              description: 'ada @ https://forum.example',
            },
          ]);
        if (cmd[0] === 'get')
          return JSON.stringify({
            record_uid: cmd[1],
            type: 'login',
            title: 'Forum',
            fields: [
              { type: 'login', value: ['ada'] },
              { type: 'password', value: ['keeper-secret-value'] },
              { type: 'url', value: ['https://forum.example'] },
              { type: 'oneTimeCode', value: [TOTP] },
              {
                type: 'passkey',
                value: [
                  {
                    privateKey: key.jwk,
                    credentialId: 'Y3JlZGVudGlhbC1pZC0x',
                    signCount: 3,
                    userId: 'dXNlci0x',
                    relyingParty: 'forum.example',
                    username: 'ada',
                  },
                ],
              },
            ],
            custom: [{ type: 'pinCode', label: 'Door', value: ['7731'] }],
            notes: '',
          });
        return undefined as unknown as string;
      },
    });

  it('runs in batch mode, reads one record with get, and keeps its passkey as PKCS#8', async () => {
    const calls: Call[] = [];
    const source = new KeeperSource(keeper(calls));
    expect((await source.state()).state).toBe('ready');
    const items = await source.list();
    expect(items).toMatchObject([
      {
        ref: 'kr_AbCdEfGhIjKlMnOpQrStUv',
        title: 'Forum',
        subtitle: 'ada',
        urls: ['https://forum.example'],
      },
    ]);
    const full = await source.full(items[0]?.ref ?? '');
    expect(full.fields.map((f) => [f.label, f.kind])).toEqual([
      ['Username', 'text'],
      ['Password', 'secret'],
      ['One-time code', 'totp'],
      ['Door', 'pin'],
    ]);
    expect(full.passkeys?.[0]).toMatchObject({
      rpId: 'forum.example',
      userName: 'ada',
      signCount: 3,
    });
    expect(isEs256Key(full.passkeys?.[0]?.privateKey ?? '')).toBe(true);
    expect(JSON.stringify(await source.fields(items[0]?.ref ?? ''))).not.toMatch(
      /keeper-secret|7731/,
    );
    expect(calls.every((c) => c.args[0] === '--batch-mode' && c.input === '')).toBe(true);
    // A record id that isn't one is never put on the command line.
    await expect(source.value('kr_../../etc', 'password')).rejects.toThrow(/isn’t known/);

    const withPassword = new KeeperSource(keeper(calls, false));
    expect((await withPassword.state()).state).toBe('locked');
    await withPassword.unlockWith('keeper-master');
    expect((await withPassword.state({ force: true })).state).toBe('ready');
    expectNoSecretsIn(calls, ['keeper-master', 'keeper-secret-value']);
  });
});

describe('the macOS Keychain', () => {
  const DUMP = `keychain: "/Users/ada/Library/Keychains/login.keychain-db"
version: 512
class: "inet"
attributes:
    0x00000007 <blob>="git.example"
    "acct"<blob>="ada"
    "mdat"<timedate>=0x32303236303930313130303030305A00  "20260901100000Z\\000"
    "path"<blob>=<NULL>
    "ptcl"<uint32>="htps"
    "srvr"<blob>="git.example"
keychain: "/Users/ada/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="Conch vault"
    "acct"<blob>="device"
    "svce"<blob>="Conch vault"
keychain: "/Users/ada/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="Chrome Safe Storage"
    "acct"<blob>="Chrome"
    "svce"<blob>="Chrome Safe Storage"
keychain: "/Users/ada/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="Home router"
    "acct"<blob>="admin"
    "svce"<blob>="Home router"
`;

  it('lists your own items by their attributes, never Conch’s key or apps’ own', async () => {
    expect(parseKeychainDump(DUMP).map((e) => [e.cls, e.service, e.account])).toEqual([
      ['inet', 'git.example', 'ada'],
      ['genp', 'Conch vault', 'device'],
      ['genp', 'Chrome Safe Storage', 'Chrome'],
      ['genp', 'Home router', 'admin'],
    ]);
    const calls: Call[] = [];
    const source = new KeychainSource(
      exec(calls, {
        security: (args) => {
          if (args[0] === 'dump-keychain') return DUMP;
          if (args[0] === 'find-internet-password') return 'keychain-secret-value\n';
          if (args[0] === 'find-generic-password') return 'router-secret\n';
          return undefined as unknown as string;
        },
      }),
      'darwin',
    );
    const items = await source.list();
    expect(items.map((i) => [i.title, i.type, i.urls])).toEqual([
      ['git.example', 'login', ['https://git.example']],
      ['Home router', 'apiKey', []],
    ]);
    // Attributes only: `-d` would decrypt everything.
    expect(calls[0]?.args).toEqual(['dump-keychain']);
    expect(await source.value(items[0]?.ref ?? '', 'password')).toBe('keychain-secret-value');
    expect(calls.at(-1)?.args).toEqual([
      'find-internet-password',
      '-s',
      'git.example',
      '-a',
      'ada',
      '-w',
    ]);
    expect(await new KeychainSource(exec([], {}), 'linux').state()).toMatchObject({
      state: 'missing',
    });
  });
});

describe('passkeys', () => {
  it('keeps only real ES256 keys, from a Bitwarden export too', () => {
    const { pkcs8 } = es256();
    expect(isEs256Key(pkcs8)).toBe(true);
    expect(isEs256Key('bm90LWEta2V5LWF0LWFsbC1qdXN0LXNvbWUtd29yZHMtaW4tYmFzZTY0')).toBe(false);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'der' })
      .toString('base64url');
    expect(
      toPasskey({ credentialId: 'Y3JlZGVudGlhbC1pZC0x', rpId: 'a.example', privateKey: rsa }),
    ).toBeUndefined();

    const input = fromBitwarden({
      credentialId: '0c1d2e3f-4a5b-6c7d-8e9f-a0b1c2d3e4f5',
      keyAlgorithm: 'ECDSA',
      keyCurve: 'P-256',
      keyValue: pkcs8,
      rpId: 'github.com',
      userHandle: 'dXNlci0x',
      userName: 'ada',
      counter: '7',
    });
    expect(input).toMatchObject({ rpId: 'github.com', signCount: 7, userName: 'ada' });
    // A GUID id is its 16 bytes.
    expect(Buffer.from(input?.credentialId ?? '', 'base64url').toString('hex')).toBe(
      '0c1d2e3f4a5b6c7d8e9fa0b1c2d3e4f5',
    );
    const passkey = input && toPasskey(input);
    expect(passkey && toCdp(passkey)).toMatchObject({
      rpId: 'github.com',
      isResidentCredential: true,
      signCount: 7,
    });

    const imported = parseImport(
      JSON.stringify({
        encrypted: false,
        items: [
          {
            type: 1,
            name: 'GitHub',
            login: {
              username: 'ada',
              password: 'pw-1234567890',
              uris: [{ uri: 'https://github.com' }],
              fido2Credentials: [
                {
                  credentialId: '0c1d2e3f-4a5b-6c7d-8e9f-a0b1c2d3e4f5',
                  keyValue: pkcs8,
                  rpId: 'github.com',
                  counter: '0',
                },
              ],
            },
          },
        ],
      }),
    );
    expect(imported.items[0]?.passkeys).toHaveLength(1);
  });

  it('signs in only on the passkey’s own site, and keeps a new one with its login', async () => {
    const { service } = await vault();
    const { pkcs8 } = es256();
    const imported = await service.import({
      format: 'bitwarden-json',
      commit: true,
      skipDuplicates: true,
      text: JSON.stringify({
        encrypted: false,
        items: [
          {
            type: 1,
            name: 'GitHub',
            login: {
              username: 'ada',
              password: 'pw-1234567890',
              uris: [{ uri: 'https://github.com' }],
              fido2Credentials: [
                {
                  credentialId: '0c1d2e3f-4a5b-6c7d-8e9f-a0b1c2d3e4f5',
                  keyValue: pkcs8,
                  rpId: 'github.com',
                  userName: 'ada',
                },
              ],
            },
          },
        ],
      }),
    });
    expect(imported.imported).toBe(1);
    expect(await service.passkeysFor('github.com.evil.example')).toEqual([]);
    expect(await service.passkeysFor('evilgithub.com')).toEqual([]);
    const [found] = await service.passkeysFor('www.github.com');
    expect(found).toMatchObject({ title: 'GitHub', userName: 'ada' });
    if (!found) return;
    await expect(
      service.passkeyPolicy(found.itemId, found.passkeyId, 'gitlab.com'),
    ).rejects.toThrow(/only uses a passkey on its own site/);
    const credential = await service.passkeyCredential(found.itemId, found.passkeyId, 'github.com');
    // The key is blanked from anything logged.
    expect(service.redactor()(`key=${credential.privateKey}`)).toBe('key=•••');
    await service.passkeyUsed(found.itemId, credential.credentialId, 4);
    const detail = await service.detail(found.itemId);
    expect(detail.passkey).toBe(true);
    expect(detail.passkeys).toEqual([
      expect.objectContaining({ rpId: 'github.com', usedAt: expect.any(Number) }),
    ]);
    expect(JSON.stringify(detail)).not.toContain(pkcs8);

    // A site makes one in Conch's browser: kept with the matching login, or as a new one.
    const fresh = es256();
    const cdp = (rpId: string, user: string) => ({
      credentialId: Buffer.from(`id-for-${rpId}-${user}`).toString('base64'),
      isResidentCredential: true,
      rpId,
      privateKey: Buffer.from(fresh.pkcs8, 'base64url').toString('base64'),
      userHandle: Buffer.from(user).toString('base64'),
      signCount: 0,
      userName: user,
    });
    await expect(service.savePasskey(cdp('github.com', 'ada'), 'evil.example')).rejects.toThrow(
      /isn’t for this site/,
    );
    expect(await service.savePasskey(cdp('github.com', 'ada'), 'github.com')).toMatchObject({
      itemId: found.itemId,
      created: false,
    });
    const made = await service.savePasskey(cdp('shop.example', 'ada'), 'shop.example');
    expect(made).toMatchObject({ title: 'shop.example', created: true });
    expect((await service.detail(found.itemId)).passkeys).toHaveLength(2);
    await service.removePasskey(
      made.itemId,
      (await service.detail(made.itemId)).passkeys[0]?.id ?? '',
    );
    expect((await service.detail(made.itemId)).passkey).toBe(false);
  });
});

describe('moving in from another password manager', () => {
  const key = es256();
  let bwItems: Record<string, unknown>[] = [];
  const bitwarden = (calls: Call[]) =>
    exec(calls, {
      bw: (args, env) => {
        if (args[0] === 'status')
          return JSON.stringify({ status: env?.BW_SESSION ? 'unlocked' : 'locked' });
        if (args[0] === 'unlock')
          return env?.CONCH_BW_PASSWORD === 'master'
            ? 'SESSION'
            : { stderr: 'Invalid master password.' };
        if (args.join(' ') === 'list items') return JSON.stringify(bwItems);
        if (args[0] === 'get' && args[1] === 'item')
          return JSON.stringify(bwItems.find((i) => i.id === args[2]) ?? {});
        return undefined as unknown as string;
      },
    });
  const item = (
    id: string,
    name: string,
    password: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    type: 1,
    name,
    revisionDate: new Date(Date.now() - 60_000).toISOString(),
    login: {
      username: 'ada',
      password,
      totp: TOTP,
      uris: [{ uri: `https://${name.toLowerCase()}.example` }],
      ...extra,
    },
  });

  async function copy(
    service: VaultService,
    options: Partial<{ ids: string[]; keepSynced: boolean; skipDuplicates: boolean }> = {},
  ) {
    const job = await service.transfer('bitwarden', {
      skipDuplicates: true,
      keepSynced: false,
      ...options,
    });
    return service.transfers.finished(job.jobId);
  }

  it('previews by name only, copies values through bw, skips duplicates, and brings passkeys', async () => {
    bwItems = [
      item('11111111-1111-1111-1111-111111111111', 'Mail', 'bw-mail-secret', {
        fido2Credentials: [
          {
            credentialId: '0c1d2e3f-4a5b-6c7d-8e9f-a0b1c2d3e4f5',
            keyValue: key.pkcs8,
            rpId: 'mail.example',
            userName: 'ada',
          },
        ],
      }),
      item('22222222-2222-2222-2222-222222222222', 'Bank', 'bw-bank-secret'),
    ];
    const calls: Call[] = [];
    const { service } = await vault({ exec: bitwarden(calls) });
    await service.create({
      type: 'login',
      title: 'Bank (mine)',
      fields: [
        { label: 'Username', kind: 'text', role: 'username', value: 'ada' },
        { label: 'Password', kind: 'secret', role: 'password', value: 'bw-bank-secret' },
      ],
      urls: ['https://bank.example'],
    });
    await expect(service.transferPreview('bitwarden')).rejects.toThrow(/Turn on Bitwarden/);
    await service.setSource('bitwarden', { enabled: true });
    await expect(service.transferPreview('bitwarden')).rejects.toThrow(/Unlock Bitwarden/);
    await service.unlockSource('bitwarden', 'master');

    const preview = await service.transferPreview('bitwarden');
    expect(preview).toMatchObject({
      found: 2,
      duplicates: 1,
      copiedBefore: 0,
      sourceName: 'Bitwarden',
    });
    expect(JSON.stringify(preview)).not.toMatch(/bw-.*-secret/);

    const done = await copy(service);
    expect(done).toMatchObject({
      state: 'done',
      total: 2,
      done: 2,
      copied: 1,
      skipped: 1,
      failed: [],
    });
    const conch = (await service.list()).items.filter((i) => i.source === 'conch');
    const mail = conch.find((i) => i.title === 'Mail');
    expect(mail).toMatchObject({ passkey: true, totp: true, readOnly: false });
    expect(
      await service.reveal(
        mail?.id ?? '',
        (await service.detail(mail?.id ?? '')).fields.find((f) => f.role === 'password')?.id ?? '',
        undefined,
      ),
    ).toBe('bw-mail-secret');
    expect((await service.detail(mail?.id ?? '')).origin).toMatchObject({
      source: 'bitwarden',
      syncing: false,
    });
    // Values went through bw's output, never its arguments.
    expectNoSecretsIn(calls, ['bw-mail-secret', 'master']);

    // Again: copied before, so nothing new.
    expect((await service.transferPreview('bitwarden')).copiedBefore).toBe(1);
    expect(await copy(service)).toMatchObject({ copied: 0 });
  });

  it('keeps copies up to date one way, leaves your edits alone, and moves removed items to Recently deleted', async () => {
    bwItems = [
      item('33333333-3333-3333-3333-333333333333', 'Forum', 'forum-secret-1'),
      item('44444444-4444-4444-4444-444444444444', 'Shop', 'shop-secret-1'),
      item('55555555-5555-5555-5555-555555555555', 'Wiki', 'wiki-secret-1'),
    ];
    const { service } = await vault({ exec: bitwarden([]) });
    await service.setSource('bitwarden', { enabled: true });
    await service.unlockSource('bitwarden', 'master');
    expect(await copy(service, { keepSynced: true })).toMatchObject({ copied: 3 });
    const status = (await service.sourceStatus()).find((s) => s.id === 'bitwarden');
    expect(status?.sync).toMatchObject({ enabled: true, copies: 3 });

    const byTitle = async (title: string) => {
      const found = (await service.list()).items.find(
        (i) => i.source === 'conch' && i.title === title && !i.deletedAt,
      );
      return found ? service.detail(found.id) : undefined;
    };
    // You edit Shop in Conch: it's yours now.
    const shop = await byTitle('Shop');
    if (!shop) throw new Error('no shop');
    await service.update(shop.id, {
      type: 'login',
      title: 'Shop',
      fields: shop.fields.map((f) => ({
        id: f.id,
        label: f.label,
        kind: f.kind,
        ...(f.role && { role: f.role }),
      })),
      urls: shop.urls,
      notes: 'my note',
    });
    expect((await byTitle('Shop'))?.origin?.syncing).toBe(false);

    // In Bitwarden: Forum's password changes, Shop changes too, Wiki is deleted.
    bwItems = [
      {
        ...item('33333333-3333-3333-3333-333333333333', 'Forum', 'forum-secret-2'),
        revisionDate: new Date(Date.now() + 60_000).toISOString(),
      },
      {
        ...item('44444444-4444-4444-4444-444444444444', 'Shop', 'shop-secret-2'),
        revisionDate: new Date(Date.now() + 60_000).toISOString(),
      },
    ];
    await service.syncDue('bitwarden', { force: true });
    const forum = await byTitle('Forum');
    const pw = (d: typeof forum) => d?.fields.find((f) => f.role === 'password')?.id ?? '';
    expect(await service.reveal(forum?.id ?? '', pw(forum), undefined)).toBe('forum-secret-2');
    // The old one is in its history, as for any change.
    expect((await service.history(forum?.id ?? '')).entries[0]?.value).toBe('forum-secret-1');
    const keptShop = await byTitle('Shop');
    expect(await service.reveal(keptShop?.id ?? '', pw(keptShop), undefined)).toBe('shop-secret-1');
    expect(await byTitle('Wiki')).toBeUndefined();
    expect((await service.list()).items.find((i) => i.title === 'Wiki')?.deletedAt).toBeTruthy();

    // A manager that suddenly lists nothing doesn't empty your vault.
    bwItems = [];
    await service.syncDue('bitwarden', { force: true });
    expect(await byTitle('Forum')).toBeTruthy();

    // Turning sync off keeps the copies.
    await service.setSync('bitwarden', false);
    expect((await service.sourceStatus()).find((s) => s.id === 'bitwarden')?.sync).toMatchObject({
      enabled: false,
      copies: 2,
    });
  });

  it('can be stopped part way, keeping what was copied', async () => {
    bwItems = Array.from({ length: 40 }, (_, n) =>
      item(
        `${String(n).padStart(8, '0')}-0000-0000-0000-000000000000`,
        `Site${n}`,
        `secret-${n}-abcdef`,
      ),
    );
    const { service } = await vault({ exec: bitwarden([]) });
    await service.setSource('bitwarden', { enabled: true });
    await service.unlockSource('bitwarden', 'master');
    const job = await service.transfer('bitwarden', { skipDuplicates: true, keepSynced: false });
    service.cancelTransfer(job.jobId);
    const done = await service.transfers.finished(job.jobId);
    expect(done?.state).toBe('cancelled');
    expect(done?.done).toBeLessThan(40);
  });
});

describe('KeePassXC', () => {
  it('answers Show and Copy from what its list already read, and forgets it on lock', async () => {
    const { KeePassXcSource } = await import('./sources');
    const calls: Call[] = [];
    const source = new KeePassXcSource(
      () => Promise.resolve('/Users/ada/Passwords.kdbx'),
      exec(calls, {
        'keepassxc-cli': (args) => {
          if (args[0] === 'ls') return 'Root\n';
          if (args[0] === 'export')
            return `"Group","Title","Username","Password","URL","Notes","TOTP"\n"Root","Forum","ada","kp-secret-value","https://forum.example","","${TOTP}"\n`;
          if (args[0] === 'show') return 'kp-secret-value\n';
          return undefined as unknown as string;
        },
      }),
    );
    await source.unlockWith('db-password');
    const [item] = await source.list();
    const before = calls.length;
    expect(await source.value(item?.ref ?? '', 'password')).toBe('kp-secret-value');
    expect(await source.totp(item?.ref ?? '')).toMatch(/^\d{6}$/);
    // No second run of keepassxc-cli: it re-derives the key each time, which is the slow part.
    expect(calls.length).toBe(before);
    expect(JSON.stringify(item)).not.toContain('kp-secret-value');
    expectNoSecretsIn(calls, ['db-password', 'kp-secret-value']);
    source.lock();
    await expect(source.value(item?.ref ?? '', 'password')).rejects.toThrow();
  });
});
