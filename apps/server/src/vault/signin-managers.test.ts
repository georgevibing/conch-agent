/**
 * How an account signs in, as each password manager keeps it (ADR 0133).
 * Every fake program answers in the shape its own source writes (the links
 * are in the ADR): no secret reaches a list or an argument, the faux
 * password field is gone, and Copy into Conch keeps how it signs in.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseImport } from './importers';
import { VaultService } from './service';
import {
  BitwardenSource,
  DashlaneSource,
  type Exec,
  KeePassXcSource,
  KeeperSource,
  OnePasswordSource,
  keepassPasskey,
  ProtonPassSource,
} from './sources';

async function vault(exec: Exec) {
  const home = await mkdtemp(join(tmpdir(), 'conch-signin-'));
  return { home, service: new VaultService({ home, keystore: 'file', exec }) };
}

interface Call {
  file: string;
  args: string[];
  env?: Record<string, string>;
  input?: string;
}

function exec(
  calls: Call[],
  answers: Record<string, (args: string[]) => string | { stderr: string; stdout?: string }>,
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
      const answer = answers[file.split('/').pop() ?? '']?.(args);
      if (answer === undefined) return { stdout: '', stderr: 'unknown command', code: 1 };
      if (typeof answer === 'object')
        return { stdout: answer.stdout ?? '', stderr: answer.stderr, code: 1 };
      return { stdout: answer, stderr: '', code: 0 };
    },
  };
}

function noSecrets(calls: Call[], text: string, secrets: string[]) {
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
    for (const call of calls) expect(call.args.join(' ')).not.toContain(secret);
  }
}

function es256() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    pkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    jwk: privateKey.export({ format: 'jwk' }) as Record<string, unknown>,
  };
}

const KEY = es256();

describe('1Password', () => {
  const VAULT = 'vlt1';
  const GOOGLE = 'googleitem0000000000000001';
  // `op item list` (no fields), then `op item get --format json` as op 2.34 writes it: an empty
  // field has no `value` (and a password no `entropy`), even with --reveal; "Sign in with" is
  // `{label: "sign in with", type: "UNKNOWN"}` (1Password/shell-plugins#600).
  const items: Record<string, Record<string, unknown>> = {
    hunt00000000000000000000001: {
      title: 'Product Hunt',
      category: 'LOGIN',
      fields: [
        { id: 'username', type: 'STRING', purpose: 'USERNAME', label: 'username' },
        {
          id: 'password',
          type: 'CONCEALED',
          purpose: 'PASSWORD',
          label: 'password',
          reference: 'op://Personal/Product Hunt/password',
          password_details: { strength: 'TERRIBLE' },
        },
        { id: 'notesPlain', type: 'STRING', purpose: 'NOTES', label: 'notesPlain' },
        { id: 'signin', type: 'UNKNOWN', label: 'sign in with' },
      ],
    },
    figma000000000000000000001: {
      title: 'Figma',
      category: 'LOGIN',
      fields: [
        {
          id: 'username',
          type: 'STRING',
          purpose: 'USERNAME',
          label: 'username',
          value: 'ada@gmail.com',
        },
        { id: 'password', type: 'CONCEALED', purpose: 'PASSWORD', label: 'password' },
        { id: 'signin', type: 'UNKNOWN', label: 'sign in with', value: GOOGLE },
      ],
    },
    webauthn00000000000000001: {
      title: 'webauthn.io',
      category: 'LOGIN',
      // A passkey-only login: the passkey isn't in op's output at all.
      fields: [
        { id: 'username', type: 'STRING', purpose: 'USERNAME', label: 'username', value: 'ada' },
        {
          id: 'password',
          type: 'CONCEALED',
          purpose: 'PASSWORD',
          label: 'password',
          password_details: { strength: 'TERRIBLE' },
        },
      ],
    },
    [GOOGLE]: {
      title: 'Google',
      category: 'LOGIN',
      fields: [
        {
          id: 'username',
          type: 'STRING',
          purpose: 'USERNAME',
          label: 'username',
          value: 'ada@gmail.com',
        },
        {
          id: 'password',
          type: 'CONCEALED',
          purpose: 'PASSWORD',
          label: 'password',
          value: 'op-google-password',
          entropy: 120,
          password_details: { entropy: 120, strength: 'FANTASTIC' },
        },
      ],
    },
  };
  const list = Object.entries(items).map(([id, i]) => ({
    id,
    title: i.title,
    category: 'LOGIN',
    vault: { id: VAULT, name: 'Personal' },
    urls: [
      {
        href:
          id === GOOGLE
            ? 'https://accounts.google.com'
            : `https://${String(i.title).toLowerCase().replace(/\s/g, '')}.com`,
      },
    ],
    additional_information: id === GOOGLE || id.startsWith('figma') ? 'ada@gmail.com' : '',
  }));
  const op = (calls: Call[]) =>
    exec(calls, {
      op: (args) => {
        if (args[0] === 'account') return '[{"url":"my.1password.com"}]';
        if (args.slice(0, 2).join(' ') === 'item list') return JSON.stringify(list);
        if (args.slice(0, 2).join(' ') === 'item get') return JSON.stringify(items[args[2] ?? '']);
        return undefined as unknown as string;
      },
    });

  it('drops the empty template password, and reads "Sign in with" and who it points at', async () => {
    const calls: Call[] = [];
    const source = new OnePasswordSource(op(calls));
    const listed = await source.list();
    const ref = (title: string) => listed.find((i) => i.title === title)?.ref ?? '';
    const hunt = await source.fields(ref('Product Hunt'));
    expect(hunt.fields).toEqual([]);
    // 1Password doesn't say whose here: "another account", until its words or its link do.
    expect(hunt.signIn).toEqual({ via: 'provider', provider: 'other' });
    const figma = await source.fields(ref('Figma'));
    expect(figma.fields.map((f) => f.role)).toEqual(['username']);
    expect(figma.signIn).toEqual({ via: 'provider', provider: 'google', account: 'ada@gmail.com' });
    // A passkey-only login: no password to show, and nothing to say how it signs in.
    const passkey = await source.fields(ref('webauthn.io'));
    expect(passkey.fields.map((f) => f.role)).toEqual(['username']);
    expect(passkey.signIn).toBeUndefined();
    // A real password stays a password, its value not in what's shown.
    const google = await source.fields(ref('Google'));
    expect(google.fields.map((f) => [f.role, f.value])).toEqual([
      ['username', 'ada@gmail.com'],
      ['password', undefined],
    ]);
    // From now on the list says how they sign in, without asking 1Password again.
    expect((await source.list()).find((i) => i.title === 'Figma')?.signIn?.provider).toBe('google');
    noSecrets(calls, JSON.stringify([hunt, figma, google]), ['op-google-password']);
  });

  it('keeps a password whose value op left out but whose strength it measured', async () => {
    const source = new OnePasswordSource(
      exec([], {
        op: (args) =>
          args[1] === 'list'
            ? JSON.stringify([list[3]])
            : JSON.stringify({
                title: 'Google',
                category: 'LOGIN',
                fields: [{ id: 'password', type: 'CONCEALED', purpose: 'PASSWORD', entropy: 120 }],
              }),
      }),
    );
    const [google] = await source.list();
    expect((await source.fields(google?.ref ?? '')).fields.map((f) => f.role)).toEqual([
      'password',
    ]);
  });

  it('copies a "Sign in with" item into Conch as that, in one read', async () => {
    const calls: Call[] = [];
    const { service } = await vault(op(calls));
    await service.setSource('1password', { enabled: true });
    const listed = (await service.list({ looking: true })).items;
    const figma = listed.find((i) => i.title === 'Figma');
    const detail = await service.detail(figma?.id ?? '');
    expect(detail.fields.map((f) => f.label)).toEqual(['username']);
    expect(detail.signInItem).toBe(listed.find((i) => i.title === 'Google')?.id);
    const job = await service.transfer('1password', { skipDuplicates: true, keepSynced: false });
    await service.transfers.finished(job.jobId);
    expect(service.transferJob(job.jobId)).toMatchObject({ state: 'done', failed: [] });
    const own = (await service.list()).items.filter((i) => i.source === 'conch');
    expect(own.find((i) => i.title === 'Figma')?.signIn).toEqual({
      via: 'provider',
      provider: 'google',
      account: 'ada@gmail.com',
    });
    expect(own.find((i) => i.title === 'Product Hunt')?.signIn).toEqual({
      via: 'provider',
      provider: 'other',
    });
    // One `op item get --reveal` an item, never one per field.
    const reveals = calls.filter((c) => c.args.includes('--reveal'));
    expect(reveals).toHaveLength(Object.keys(items).length);
  });
});

describe('Bitwarden', () => {
  // `bw list items` decrypts every item, passkeys' private keys included (list.command.ts).
  const items = [
    {
      id: '11111111-2222-3333-4444-555555555555',
      type: 1,
      name: 'Product Hunt',
      notes: 'Sign in with Google (ada@gmail.com)',
      login: {
        username: null,
        password: null,
        totp: null,
        uris: [{ uri: 'https://www.producthunt.com' }],
        fido2Credentials: [],
      },
    },
    {
      id: '22222222-2222-3333-4444-555555555555',
      type: 1,
      name: 'GitHub',
      notes: null,
      login: {
        username: 'ada',
        password: null,
        uris: [{ uri: 'https://github.com' }],
        fido2Credentials: [
          {
            credentialId: 'a7ab3ff4-2a69-4b2c-9b3f-5f7f0b5d3c1e',
            keyType: 'public-key',
            keyAlgorithm: 'ECDSA',
            keyCurve: 'P-256',
            keyValue: KEY.pkcs8,
            rpId: 'github.com',
            rpName: 'GitHub',
            userHandle: 'dXNlci1oYW5kbGU',
            userName: 'ada',
            counter: '3',
            discoverable: 'true',
            creationDate: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    },
    {
      id: '33333333-2222-3333-4444-555555555555',
      type: 1,
      name: 'Google',
      login: {
        username: 'ada@gmail.com',
        password: 'bw-google-password',
        uris: [{ uri: 'https://accounts.google.com' }],
      },
    },
  ];
  const bw = (calls: Call[]) =>
    exec(calls, {
      bw: (args) => {
        if (args[0] === 'status') return JSON.stringify({ status: 'unlocked' });
        if (args[0] === 'unlock') return 'SESSION';
        if (args.join(' ') === 'list items') return JSON.stringify(items);
        if (args[0] === 'get' && args[1] === 'item')
          return JSON.stringify(items.find((i) => i.id === args[2]));
        return undefined as unknown as string;
      },
    });

  it('a login with only a note saying so signs in with Google; one with only passkeys, with a passkey Conch can use', async () => {
    const calls: Call[] = [];
    const source = new BitwardenSource(bw(calls));
    await source.unlockWith('master');
    const list = await source.list();
    expect(list.find((i) => i.title === 'Product Hunt')?.signIn).toEqual({
      via: 'provider',
      provider: 'google',
      account: 'ada@gmail.com',
    });
    expect(list.find((i) => i.title === 'GitHub')).toMatchObject({
      passkey: true,
      signIn: { via: 'passkey', usable: true },
    });
    expect(list.find((i) => i.title === 'Google')?.signIn).toBeUndefined();
    // Neither has a password to show.
    expect((await source.fields(list[0]?.ref ?? '')).fields.map((f) => f.role)).not.toContain(
      'password',
    );
    noSecrets(calls, JSON.stringify(list), [KEY.pkcs8, 'bw-google-password']);
  });

  it('shows the Google login for the account, fills no password, and copies both into Conch as they are', async () => {
    const calls: Call[] = [];
    const { service } = await vault(bw(calls));
    await service.setSource('bitwarden', { enabled: true });
    await service.unlockSource('bitwarden', 'master');
    const { items: listed } = await service.list({ looking: true });
    const hunt = listed.find((i) => i.title === 'Product Hunt');
    const google = listed.find((i) => i.title === 'Google');
    expect(hunt?.signIn?.provider).toBe('google');
    expect(hunt && service.signInItemFor(hunt)?.id).toBe(google?.id);
    expect((await service.detail(hunt?.id ?? '')).signInItem).toBe(google?.id);
    const policy = await service.fillPolicy({
      itemId: hunt?.id ?? '',
      host: 'www.producthunt.com',
      want: 'password',
    });
    expect(policy.has).not.toContain('password');
    expect(policy.signIn?.provider).toBe('google');
    // Search finds it by the provider.
    expect((await service.forAgent('google')).map((i) => i.title)).toContain('Product Hunt');

    const job = await service.transfer('bitwarden', { skipDuplicates: true, keepSynced: false });
    await service.transfers.finished(job.jobId);
    const own = (await service.list()).items.filter((i) => i.source === 'conch');
    const copied = own.find((i) => i.title === 'Product Hunt');
    expect(copied?.signIn).toEqual({
      via: 'provider',
      provider: 'google',
      account: 'ada@gmail.com',
    });
    expect(copied?.problems).toEqual([]);
    const detail = await service.detail(copied?.id ?? '');
    expect(detail.fields.map((f) => f.role)).not.toContain('password');
    // Its own Google login now, in Conch.
    expect(detail.signInItem).toBe(own.find((i) => i.title === 'Google')?.id);
    expect(own.find((i) => i.title === 'GitHub')).toMatchObject({
      passkey: true,
      signIn: { via: 'passkey', usable: true },
    });
  });
});

describe('KeePassXC', () => {
  const csv = [
    '"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"',
    '"Root","GitHub (Passkey)","ada","","https://github.com","","","0","2026-09-01T10:00:00Z","2026-09-01T10:00:00Z"',
    '"Root","Figma","ada@example.com","","https://figma.com","Log in with Google","","0","",""',
    '"Root","Mail","ada","kp-mail-password","https://mail.example","Sign in with Google","","0","",""',
  ].join('\n');
  const keepass = (calls: Call[], complete = true) =>
    exec(calls, {
      'keepassxc-cli': (args) => {
        if (args[0] === 'ls') return 'GitHub (Passkey)\n';
        if (args[0] === 'export') return csv;
        if (args[0] === 'show') {
          const asked = args.filter((_, i) => args[i - 1] === '-a');
          const values: Record<string, string> = {
            KPEX_PASSKEY_RELYING_PARTY: 'github.com',
            KPEX_PASSKEY_CREDENTIAL_ID: 'Y3JlZGVudGlhbC1pZC0xMjM0NQ',
            KPEX_PASSKEY_USERNAME: 'ada',
            KPEX_PASSKEY_PRIVATE_KEY_PEM: KEY.pem.trim(),
            ...(complete && { KPEX_PASSKEY_USER_HANDLE: 'dXNlci1oYW5kbGU' }),
          };
          const missing = asked.filter((a) => !(a in values));
          const out = asked
            .filter((a) => a in values)
            .map((a) => `${values[a]}\n`)
            .join('');
          return missing.length
            ? { stdout: out, stderr: `ERROR: unknown attribute ${missing[0]}.` }
            : out;
        }
        return undefined as unknown as string;
      },
    });

  it('an entry KeePassXC made for a passkey signs in with it, and Copy into Conch brings its key', async () => {
    for (const complete of [true, false]) {
      const calls: Call[] = [];
      const source = new KeePassXcSource(async () => '/db.kdbx', keepass(calls, complete));
      await source.unlockWith('db-password');
      const list = await source.list();
      const github = list.find((i) => i.title === 'GitHub (Passkey)');
      expect(github).toMatchObject({ passkey: true, signIn: { via: 'passkey' } });
      expect(list.find((i) => i.title === 'Figma')?.signIn).toEqual({
        via: 'provider',
        provider: 'google',
        account: 'ada@example.com',
      });
      // A password, whatever the notes say: it signs in with that.
      expect(list.find((i) => i.title === 'Mail')?.signIn).toBeUndefined();
      const full = await source.full(github?.ref ?? '');
      expect(full.passkeys).toEqual([
        {
          credentialId: 'Y3JlZGVudGlhbC1pZC0xMjM0NQ',
          rpId: 'github.com',
          ...(complete && { userHandle: 'dXNlci1oYW5kbGU' }),
          userName: 'ada',
          privateKey: KEY.pkcs8,
          signCount: 0,
        },
      ]);
      // The database password on stdin; the key never an argument.
      noSecrets(calls, JSON.stringify(list), ['db-password', 'kp-mail-password', 'PRIVATE KEY']);
    }
  });

  it('keeps only a real ES256 key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const lines = (pem: string) => [
      'github.com',
      'Y3JlZGVudGlhbC1pZC0xMjM0NQ',
      '',
      'ada',
      ...pem.trim().split('\n'),
    ];
    expect(keepassPasskey(lines(KEY.pem))?.privateKey).toBe(KEY.pkcs8);
    expect(keepassPasskey(lines(rsa))).toBeUndefined();
    expect(keepassPasskey(lines('not a key'))).toBeUndefined();
  });
});

describe('Proton Pass', () => {
  const view = (login: Record<string, unknown>, note = '') =>
    JSON.stringify({
      item: { content: { title: 'Item', note, content: { Login: login }, extra_fields: [] } },
      attachments: [],
    });
  const proton = (calls: Call[]) =>
    exec(calls, {
      'pass-cli': (args) => {
        const cmd = args.slice(0, 2).join(' ');
        if (cmd === 'vault list')
          return JSON.stringify({ vaults: [{ name: 'Personal', share_id: 'SHARE_one_1' }] });
        if (cmd === 'item list')
          return JSON.stringify({
            items: ['ITEM_hunt_1', 'ITEM_keys_1', 'ITEM_mail_1'].map((id) => ({
              id,
              share_id: 'SHARE_one_1',
              state: 'Active',
              title: id,
              item_type: 'login',
            })),
          });
        if (cmd === 'item view') {
          const id = args[args.indexOf('--item-id') + 1];
          if (id === 'ITEM_hunt_1')
            return view(
              { email: 'ada@gmail.com', username: '', password: '', urls: [], passkeys: [] },
              'Continue with Google',
            );
          if (id === 'ITEM_keys_1')
            return view({
              email: '',
              username: 'ada',
              password: '',
              urls: ['https://github.com'],
              // `content` is MessagePack around a COSE key (protonpasskey.rs): Conch can't use it.
              passkeys: [
                { key_id: 'k1', content: [1, 2, 3], rp_id: 'github.com', user_name: 'ada' },
              ],
            });
          return view({ username: 'ada', password: 'proton-secret', urls: [], passkeys: [] });
        }
        return undefined as unknown as string;
      },
    });

  it('learns how an item signs in when it’s read, and keeps no faux password field', async () => {
    const calls: Call[] = [];
    const source = new ProtonPassSource(proton(calls));
    const list = await source.list();
    // The list has nothing but names (pass-cli's ItemSummary).
    expect(list.every((i) => !i.signIn)).toBe(true);
    const ref = (title: string) => list.find((i) => i.title === title)?.ref ?? '';
    const hunt = await source.fields(ref('ITEM_hunt_1'));
    expect(hunt.signIn).toEqual({ via: 'provider', provider: 'google', account: 'ada@gmail.com' });
    expect(hunt.fields.map((f) => f.role)).toEqual(['email']);
    const keys = await source.fields(ref('ITEM_keys_1'));
    expect(keys).toMatchObject({ passkey: true, signIn: { via: 'passkey', usable: false } });
    expect((await source.fields(ref('ITEM_mail_1'))).signIn).toBeUndefined();
    // From now on the list says it too.
    expect((await source.list()).find((i) => i.ref === ref('ITEM_keys_1'))?.signIn?.via).toBe(
      'passkey',
    );
    noSecrets(calls, JSON.stringify([hunt, keys]), ['proton-secret']);
  });
});

describe('Keeper', () => {
  const record = {
    record_uid: 'AAAAAAAAAAAAAAAAAAAAAA',
    title: 'Keeper web',
    type: 'login',
    fields: [
      { type: 'login', value: ['ada'] },
      { type: 'password', value: [] },
      { type: 'url', value: ['https://keepersecurity.com'] },
      {
        type: 'passkey',
        value: [
          {
            privateKey: KEY.jwk,
            credentialId: 'Y3JlZGVudGlhbC1pZC0xMjM0NQ',
            signCount: 1,
            userId: 'dXNlci1oYW5kbGU',
            relyingParty: 'keepersecurity.com',
            username: 'ada',
            createdDate: 1_700_000_000_000,
          },
        ],
      },
    ],
    custom: [],
    notes: '',
  };
  it('a record with a passkey field and an empty password signs in with a passkey Conch can use', async () => {
    const calls: Call[] = [];
    const source = new KeeperSource(
      exec(calls, {
        keeper: (args) => {
          if (args.includes('list'))
            return JSON.stringify([
              { record_uid: record.record_uid, type: 'login', title: record.title },
            ]);
          if (args.includes('get')) return JSON.stringify(record);
          return undefined as unknown as string;
        },
      }),
    );
    const [item] = await source.list();
    const read = await source.fields(item?.ref ?? '');
    expect(read).toMatchObject({ passkey: true, signIn: { via: 'passkey', usable: true } });
    expect(read.fields.map((f) => f.role)).toEqual(['username']);
    expect((await source.full(item?.ref ?? '')).passkeys).toHaveLength(1);
    noSecrets(calls, JSON.stringify(read), [String(KEY.jwk.d)]);
  });
});

describe('Dashlane', () => {
  it('a login with no password says how it signs in in its words, which aren’t kept', async () => {
    const calls: Call[] = [];
    const source = new DashlaneSource(
      exec(calls, {
        dcli: (args) => {
          if (args[0] === 'password')
            return JSON.stringify([
              {
                id: '{A1B2C3D4-0000-0000-0000-000000000001}',
                title: 'Notion',
                email: 'ada@example.com',
                password: '',
                url: 'https://notion.so',
                note: 'Signed up with Apple. Old recovery hint: kept-note-text',
              },
            ]);
          if (args[0] === 'note') return '[]';
          return undefined as unknown as string;
        },
      }),
    );
    const [notion] = await source.list();
    expect(notion?.signIn).toEqual({
      via: 'provider',
      provider: 'apple',
      account: 'ada@example.com',
    });
    expect(notion?.fields?.map((f) => f.role)).toEqual(['email']);
    expect(JSON.stringify(notion)).not.toContain('kept-note-text');
  });
});

describe('Conch’s own vault', () => {
  it('keeps how an item signs in, finds its Google login, and never calls it weak or reused', async () => {
    const { service, home } = await vault(exec([], {}));
    const google = await service.create({
      type: 'login',
      title: 'Google',
      fields: [
        { label: 'Username', kind: 'text', role: 'username', value: 'ada@gmail.com' },
        { label: 'Password', kind: 'secret', role: 'password', value: 'Strong-horse-battery-91!' },
      ],
      urls: ['https://accounts.google.com'],
    });
    const lookalike = await service.create({
      type: 'login',
      title: 'Google?',
      fields: [{ label: 'Username', kind: 'text', role: 'username', value: 'ada@gmail.com' }],
      urls: ['https://google.com.account-check.io'],
    });
    const hunt = await service.create({
      type: 'login',
      title: 'Product Hunt',
      fields: [
        { label: 'Username', kind: 'text', role: 'username', value: 'ada' },
        // An old password, the same weak one as elsewhere: it doesn't sign in with it.
        { label: 'Password', kind: 'secret', role: 'password', value: '123456' },
      ],
      urls: ['http://producthunt.com'],
      signIn: { via: 'provider', provider: 'google', account: 'ada@gmail.com' },
    });
    await service.create({
      type: 'login',
      title: 'Other',
      fields: [{ label: 'Password', kind: 'secret', role: 'password', value: '123456' }],
      urls: ['https://other.example'],
    });
    expect(hunt.signIn).toEqual({ via: 'provider', provider: 'google', account: 'ada@gmail.com' });
    expect(hunt.problems).toEqual([]);
    expect(hunt.signInItem).toBe(google.id);
    expect(hunt.signInItem).not.toBe(lookalike.id);
    const other = (await service.list()).items.find((i) => i.title === 'Other');
    // Not "reused": the only other copy belongs to an item that doesn't sign in with it.
    expect(other?.problems).toEqual(['weak']);
    // Saved again without it: a password login again.
    const plain = await service.update(hunt.id, {
      type: 'login',
      title: 'Product Hunt',
      fields: [],
      urls: ['https://producthunt.com'],
    });
    expect(plain.signIn).toBeUndefined();
    // A passkey-only login says so, and its passkey is Conch's to use.
    await service.update(hunt.id, {
      type: 'login',
      title: 'Product Hunt',
      fields: [],
      urls: ['https://producthunt.com'],
      signIn: { via: 'passkey', usable: true },
    });
    expect((await service.detail(hunt.id)).signIn).toEqual({ via: 'passkey', usable: false });
    // The export says it in the notes, and importing that brings it back.
    await service.update(hunt.id, {
      type: 'login',
      title: 'Product Hunt',
      fields: [],
      urls: ['https://producthunt.com'],
      signIn: { via: 'provider', provider: 'google', account: 'ada@gmail.com' },
    });
    const csv = await service.exportCsv();
    expect(csv).toContain('Sign in with Google (ada@gmail.com).');
    const back = parseImport(csv).items.find((i) => i.title === 'Product Hunt');
    expect(back?.signIn).toEqual({ via: 'provider', provider: 'google', account: 'ada@gmail.com' });
    await writeFile(join(home, 'unused'), '');
  });

  it('imports a passkey-only Bitwarden login, which it used to leave out', () => {
    const file = JSON.stringify({
      encrypted: false,
      items: [
        {
          type: 1,
          name: 'GitHub',
          login: {
            username: null,
            password: null,
            uris: [{ uri: 'https://github.com' }],
            fido2Credentials: [
              {
                credentialId: 'a7ab3ff4-2a69-4b2c-9b3f-5f7f0b5d3c1e',
                keyAlgorithm: 'ECDSA',
                keyCurve: 'P-256',
                keyValue: KEY.pkcs8,
                rpId: 'github.com',
                userName: 'ada',
                counter: '0',
              },
            ],
          },
        },
      ],
    });
    const { items, skipped } = parseImport(file);
    expect(skipped).toBe(0);
    expect(items[0]).toMatchObject({ signIn: { via: 'passkey' } });
  });
});
