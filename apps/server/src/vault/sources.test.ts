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

describe('recently used and edited, for every manager', () => {
  it('remembers when another manager’s item was used here, and KeePassXC’s own edit date', async () => {
    const { service } = await vault({
      exec: exec([], {
        'keepassxc-cli': (args) => {
          if (args[0] === 'ls') return 'Root\n';
          if (args[0] === 'export')
            return `"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"\n"Root","Forum","ada","kp-secret-1","https://forum.example","","","0","2026-09-01T10:00:00Z","2026-01-01T10:00:00Z"\n`;
          return undefined as unknown as string;
        },
      }),
    });
    const database = join(await mkdtemp(join(tmpdir(), 'conch-kdbx-')), 'Passwords.kdbx');
    await (await import('node:fs/promises')).writeFile(database, 'x');
    await service.setSource('keepassxc', { enabled: true, database });
    await service.unlockSource('keepassxc', 'db-password');
    let [forum] = (await service.list()).items;
    expect(forum).toMatchObject({ title: 'Forum', updatedAt: Date.parse('2026-09-01T10:00:00Z') });
    expect(forum?.usedAt).toBeUndefined();
    await service.reveal(forum?.id ?? '', 'password', undefined, 'copied');
    [forum] = (await service.list()).items;
    expect(forum?.usedAt).toBeGreaterThan(Date.now() - 5_000);
  });
});

describe('kept unlocked', () => {
  const keepass = (calls: Call[]) =>
    exec(calls, {
      'keepassxc-cli': (args) => {
        if (args[0] === 'ls') return 'Root\n';
        if (args[0] === 'export')
          return `"Group","Title","Username","Password","URL","Notes","TOTP"\n"Root","Forum","ada","kp-secret-1","https://forum.example","",""\n`;
        return undefined as unknown as string;
      },
    });
  // keepassxc-cli checks the password it's given on stdin.
  const checking = (calls: Call[], right: string): Exec => {
    const inner = keepass(calls);
    return {
      find: inner.find,
      run: async (file, args, options) =>
        options?.input === `${right}\n`
          ? inner.run(file, args, options)
          : {
              stdout: '',
              stderr: 'Error while reading the database: Invalid credentials',
              code: 1,
            },
    };
  };

  it('opens by itself after a restart, sealed with this computer’s key, until it’s locked', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-kept-'));
    const database = join(home, 'Passwords.kdbx');
    await (await import('node:fs/promises')).writeFile(database, 'x');
    const first = new VaultService({ home, keystore: 'file', exec: checking([], 'db-password') });
    await first.setSource('keepassxc', { enabled: true, database });
    await first.unlockSource('keepassxc', 'db-password', true);
    const file = await (
      await import('node:fs/promises')
    ).readFile(join(home, 'vault', 'remembered.json'), 'utf8');
    expect(file).not.toContain('db-password');

    // Conch starts again: nobody types anything.
    const calls: Call[] = [];
    const again = new VaultService({
      home,
      keystore: 'file',
      exec: checking(calls, 'db-password'),
    });
    const status = (await again.sourceStatus()).find((s) => s.id === 'keepassxc');
    expect(status).toMatchObject({ state: 'ready', keptUnlocked: true });
    expect((await again.list()).items.map((i) => i.title)).toContain('Forum');
    expectNoSecretsIn(calls, ['db-password']);

    // Locking means locked, after the next restart too.
    await again.lockSource('keepassxc');
    const third = new VaultService({ home, keystore: 'file', exec: checking([], 'db-password') });
    expect((await third.sourceStatus()).find((s) => s.id === 'keepassxc')?.state).toBe('locked');
  });

  it('is never shown as locked while it opens itself, to anyone asking at the same time', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-kept-'));
    const database = join(home, 'Passwords.kdbx');
    await (await import('node:fs/promises')).writeFile(database, 'x');
    const first = new VaultService({ home, keystore: 'file', exec: checking([], 'db-password') });
    await first.setSource('keepassxc', { enabled: true, database });
    await first.unlockSource('keepassxc', 'db-password', true);
    // Opening a database takes a moment (keepassxc-cli derives its key).
    const fast = checking([], 'db-password');
    const slow: Exec = {
      find: fast.find,
      run: async (file, args, options) => {
        await new Promise((r) => setTimeout(r, 150));
        return fast.run(file, args, options);
      },
    };
    let changed = 0;
    const again = new VaultService({ home, keystore: 'file', exec: slow, emit: () => changed++ });
    const [a, b] = await Promise.all([again.sourceStatus(), again.sourceStatus()]);
    for (const list of [a, b]) expect(list.find((s) => s.id === 'keepassxc')?.state).toBe('ready');
    // And it says so, for Repair everything to look again.
    expect(changed).toBeGreaterThan(0);
  });

  it('says so when the kept password stopped working, and forgets it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-kept-'));
    const database = join(home, 'Passwords.kdbx');
    await (await import('node:fs/promises')).writeFile(database, 'x');
    const first = new VaultService({ home, keystore: 'file', exec: checking([], 'old-password') });
    await first.setSource('keepassxc', { enabled: true, database });
    await first.unlockSource('keepassxc', 'old-password', true);
    const changed = new VaultService({
      home,
      keystore: 'file',
      exec: checking([], 'new-password'),
    });
    const status = (await changed.sourceStatus()).find((s) => s.id === 'keepassxc');
    expect(status).toMatchObject({
      state: 'locked',
      message: expect.stringMatching(/Unlock it again/),
    });
    expect(status?.keptUnlocked).toBeUndefined();
  });
});

describe('KeePassXC’s own words', () => {
  it('says the password is wrong, and passes a key file as a path when there is one', async () => {
    const { KeePassXcSource } = await import('./sources');
    const calls: Call[] = [];
    const wrong: Exec = {
      find: async (name) => `/fake/${name}`,
      run: async (file, args, options) => {
        calls.push({ file, args, ...(options?.input && { input: options.input }) });
        return {
          stdout: '',
          stderr:
            'Enter password to unlock /Users/ada/P.kdbx: \nError while reading the database: Invalid credentials were provided, please try again.\n',
          code: 1,
        };
      },
    };
    const plain = new KeePassXcSource(async () => '/Users/ada/P.kdbx', wrong);
    await expect(plain.unlockWith('nope')).rejects.toThrow(/isn’t the database’s password/);
    const keyed = new KeePassXcSource(
      async () => '/Users/ada/P.kdbx',
      wrong,
      async () => '/Users/ada/P.keyx',
    );
    await expect(keyed.unlockWith('nope')).rejects.toThrow(/password and key file/);
    expect(calls.at(-1)?.args).toEqual(['ls', '-k', '/Users/ada/P.keyx', '/Users/ada/P.kdbx']);
    expectNoSecretsIn(calls, ['nope']);
  });
});

describe('Copy to another password manager (ADR 0062)', () => {
  const opList = [
    {
      id: 'aaaa1111',
      title: 'Mail',
      category: 'LOGIN',
      vault: { id: 'vaultprivate', name: 'Private' },
      additional_information: 'ada',
      urls: [{ href: 'https://mail.example', primary: true }],
    },
  ];
  const onePassword = (calls: Call[], created: unknown[], locked = false) =>
    exec(calls, {
      op: (args) => {
        const cmd = args.slice(0, 2).join(' ');
        if (cmd === 'account list') return locked ? '[]' : JSON.stringify([{ id: 'acct' }]);
        if (cmd === 'item list') return JSON.stringify(opList);
        if (cmd === 'item create') {
          const input = calls.at(-1)?.input ?? '';
          created.push(JSON.parse(input));
          return JSON.stringify({ id: 'new1' });
        }
        return undefined as unknown as string;
      },
    });

  async function withItems(service: VaultService) {
    const bank = await service.create({
      type: 'login',
      title: 'Bank',
      fields: [
        { label: 'Username', kind: 'text', role: 'username', value: 'ada' },
        { label: 'Password', kind: 'secret', role: 'password', value: 'bank-secret-123' },
        { label: 'PIN', kind: 'pin', value: '4242' },
      ],
      urls: ['https://bank.example'],
      notes: 'Branch in town',
      tags: ['money'],
    });
    const mail = await service.create({
      type: 'login',
      title: 'Mail',
      fields: [
        { label: 'Username', kind: 'text', role: 'username', value: 'ada' },
        { label: 'Password', kind: 'secret', role: 'password', value: 'mail-secret-456' },
      ],
      urls: ['https://mail.example'],
    });
    return { bank, mail };
  }

  it('makes new 1Password items from the JSON template on stdin, never in arguments, and leaves out ones it has', async () => {
    const calls: Call[] = [];
    const created: Record<string, unknown>[] = [];
    const { service } = await vault({ exec: onePassword(calls, created) });
    const { bank, mail } = await withItems(service);
    await service.setSource('1password', { enabled: true });
    // Its vaults come with the very first list, from what that list read.
    const first = await service.list({ looking: true });
    expect(first.status.sources.find((s) => s.id === '1password')).toMatchObject({
      accepts: true,
      places: [{ id: 'vaultprivate', name: 'Private' }],
    });

    const status = (await service.sourceStatus()).find((s) => s.id === '1password');
    expect(status).toMatchObject({
      accepts: true,
      places: [{ id: 'vaultprivate', name: 'Private' }],
    });

    const result = await service.copyOut('1password', {
      ids: [bank.id, mail.id],
      place: 'vaultprivate',
      skipDuplicates: true,
    });
    // Mail is already in 1Password (the same site and account).
    expect(result).toEqual({ copied: 1, skipped: 1, failed: [] });
    const create = calls.find((c) => c.args[1] === 'create');
    expect(create?.args).toEqual([
      'item',
      'create',
      '--vault',
      'vaultprivate',
      '--format',
      'json',
      '-',
    ]);
    expect(created[0]).toMatchObject({
      title: 'Bank',
      category: 'LOGIN',
      tags: ['money'],
      urls: [{ href: 'https://bank.example', primary: true }],
      fields: expect.arrayContaining([
        expect.objectContaining({ purpose: 'USERNAME', value: 'ada' }),
        expect.objectContaining({
          purpose: 'PASSWORD',
          type: 'CONCEALED',
          value: 'bank-secret-123',
        }),
        expect.objectContaining({ label: 'PIN', type: 'CONCEALED', value: '4242' }),
        expect.objectContaining({ purpose: 'NOTES', value: 'Branch in town' }),
      ]),
    });
    expectNoSecretsIn(calls, ['bank-secret-123', 'mail-secret-456', '4242']);

    // Asked to, it copies a duplicate too.
    expect(
      await service.copyOut('1password', { ids: [mail.id], skipDuplicates: false }),
    ).toMatchObject({ copied: 1 });
  });

  it('refuses a manager that is off, locked, or only read, and a vault id that is not one', async () => {
    const calls: Call[] = [];
    const { service } = await vault({ exec: onePassword(calls, [], true) });
    const { bank } = await withItems(service);
    const copy = (id: Parameters<VaultService['copyOut']>[0], place?: string) =>
      service.copyOut(id, { ids: [bank.id], skipDuplicates: false, ...(place && { place }) });
    await expect(copy('1password')).rejects.toThrow(/Turn on 1Password/);
    await service.setSource('1password', { enabled: true });
    await expect(copy('1password')).rejects.toThrow(/Integrate with 1Password CLI/);
    await service.setSource('keeper', { enabled: true }).catch(() => undefined);
    await expect(copy('keeper')).rejects.toThrow();
    expect(calls.some((c) => c.args[1] === 'create')).toBe(false);

    const ok = await vault({ exec: onePassword([], []) });
    const mine = await withItems(ok.service);
    await ok.service.setSource('1password', { enabled: true });
    expect(
      await ok.service.copyOut('1password', {
        ids: [mine.bank.id],
        place: 'not a vault',
        skipDuplicates: false,
      }),
    ).toMatchObject({ copied: 0, failed: [{ title: 'Bank' }] });
    // Only Conch's own items: another manager's id is nothing to copy.
    await expect(
      ok.service.copyOut('1password', { ids: ['op_vaultprivate_aaaa1111'], skipDuplicates: false }),
    ).rejects.toThrow(/aren’t in Conch/);
  });

  it('makes a Bitwarden login from the encoded item on stdin', async () => {
    const calls: Call[] = [];
    const created: Record<string, unknown>[] = [];
    const bw = exec(calls, {
      bw: (args, env) => {
        if (args[0] === 'status')
          return JSON.stringify({ status: env?.BW_SESSION ? 'unlocked' : 'locked' });
        if (args[0] === 'unlock') return 'SESSION';
        if (args.join(' ') === 'list items') return '[]';
        if (args.join(' ') === 'create item') {
          created.push(
            JSON.parse(Buffer.from(calls.at(-1)?.input ?? '', 'base64').toString('utf8')),
          );
          return '{}';
        }
        return undefined as unknown as string;
      },
    });
    const { service } = await vault({ exec: bw });
    const { bank } = await withItems(service);
    await service.setSource('bitwarden', { enabled: true });
    await service.unlockSource('bitwarden', 'master');
    expect(
      await service.copyOut('bitwarden', { ids: [bank.id], skipDuplicates: true }),
    ).toMatchObject({ copied: 1 });
    expect(created[0]).toMatchObject({
      type: 1,
      name: 'Bank',
      notes: 'Branch in town',
      login: {
        username: 'ada',
        password: 'bank-secret-123',
        uris: [{ uri: 'https://bank.example', match: null }],
      },
      fields: [{ name: 'PIN', value: '4242', type: 1 }],
    });
    expectNoSecretsIn(calls, ['bank-secret-123', '4242', 'master']);
  });

  it('keeps a card’s expiry it can’t read as a field, leaves out a note it already has, and never echoes a value in an error', async () => {
    const calls: Call[] = [];
    const created: Record<string, unknown>[] = [];
    let refuse = false;
    const bw = exec(calls, {
      bw: (args, env) => {
        if (args[0] === 'status')
          return JSON.stringify({ status: env?.BW_SESSION ? 'unlocked' : 'locked' });
        if (args[0] === 'unlock') return 'SESSION';
        if (args.join(' ') === 'list items')
          return JSON.stringify(
            created.map((c, i) => ({ ...c, id: `0000000${i}-0000-0000-0000-000000000000` })),
          );
        if (args.join(' ') === 'create item') {
          const item = JSON.parse(
            Buffer.from(calls.at(-1)?.input ?? '', 'base64').toString('utf8'),
          ) as Record<string, unknown>;
          if (refuse) return { stderr: `Bad value: ${JSON.stringify(item)}` };
          created.push(item);
          return '{}';
        }
        return undefined as unknown as string;
      },
    });
    const { service } = await vault({ exec: bw });
    const card = (expiry: string, title: string) =>
      service.create({
        type: 'card',
        title,
        fields: [
          { label: 'Number', kind: 'secret', role: 'cardNumber', value: '4242424242424242' },
          { label: 'Expiry', kind: 'monthYear', role: 'expiry', value: expiry },
        ],
      });
    const visa = await card('01/27', 'Visa');
    const odd = await card('2027-01', 'Amex');
    const note = await service.create({
      type: 'note',
      title: 'Safe',
      fields: [],
      notes: 'combination 1234',
    });
    await service.setSource('bitwarden', { enabled: true });
    await service.unlockSource('bitwarden', 'master');
    const copy = (id: string) => service.copyOut('bitwarden', { ids: [id], skipDuplicates: true });

    expect(await copy(visa.id)).toMatchObject({ copied: 1 });
    expect(created[0]).toMatchObject({ type: 3, card: { expMonth: '1', expYear: '2027' } });
    expect(await copy(odd.id)).toMatchObject({ copied: 1 });
    expect(created[1]).toMatchObject({
      card: { expMonth: null, expYear: null },
      fields: [{ name: 'Expiry', value: '2027-01', type: 0 }],
    });
    expect(await copy(note.id)).toMatchObject({ copied: 1 });
    // The same note again: it's there already (a note is its kind and its title).
    expect(await copy(note.id)).toMatchObject({ copied: 0, skipped: 1 });

    refuse = true;
    const failed = await service.copyOut('bitwarden', { ids: [visa.id], skipDuplicates: false });
    expect(failed.failed).toHaveLength(1);
    expect(JSON.stringify(failed)).not.toContain('4242424242424242');
  });
});
