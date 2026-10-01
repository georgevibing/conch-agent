import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generatePassword, passwordScore, siteMatches, siteOf } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { indexMac, newVaultKey, openItem, sealItem, unwrapKey, wrapKey } from './crypto';
import { detectFormat, parseCsv, parseImport, toCsv } from './importers';
import { FileKeystore } from './keystore';
import { VaultService } from './service';
import type { Exec } from './sources';
import { VaultStore } from './store';
import { base32Decode, hotp, parseTotp, totpNow } from './totp';

async function vault(deps: Partial<ConstructorParameters<typeof VaultService>[0]> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-vault-'));
  return { home, service: new VaultService({ home, keystore: 'file', ...deps }) };
}

const login = (over: Record<string, unknown> = {}) => ({
  type: 'login' as const,
  title: 'Netflix',
  fields: [
    {
      label: 'Username',
      kind: 'text' as const,
      role: 'username' as const,
      value: 'ada@example.com',
    },
    {
      label: 'Password',
      kind: 'secret' as const,
      role: 'password' as const,
      value: 'correct-horse-battery-staple-9',
    },
  ],
  urls: ['https://www.netflix.com/login'],
  tags: [],
  notes: '',
  favorite: false,
  agentAccess: 'ask' as const,
  allowedSites: [],
  ...over,
});

describe('crypto', () => {
  it('binds each item to its id and version, and the list to its check', () => {
    const vk = newVaultKey();
    const sealed = sealItem(vk, 'pw_a', 1, { secret: 'x' });
    expect(openItem(vk, 'pw_a', 1, sealed)).toEqual({ secret: 'x' });
    // Moved to another item, or replayed as another version: it doesn't open.
    expect(() => openItem(vk, 'pw_b', 1, sealed)).toThrow();
    expect(() => openItem(vk, 'pw_a', 2, sealed)).toThrow();
    expect(() => openItem(newVaultKey(), 'pw_a', 1, sealed)).toThrow();
    expect(indexMac(vk, [{ id: 'a', v: 1 }])).not.toBe(indexMac(vk, [{ id: 'a', v: 2 }]));
    const kek = newVaultKey();
    expect(unwrapKey(kek, wrapKey(kek, vk)).equals(vk)).toBe(true);
    expect(() => unwrapKey(kek, wrapKey(kek, vk), 'backup')).toThrow();
  });

  it('keeps names, sites and usernames off the disk', async () => {
    const { home, service } = await vault();
    await service.create(login());
    const raw = await readFile(join(home, 'vault', 'vault.json'), 'utf8');
    for (const secret of ['Netflix', 'netflix.com', 'ada@example.com', 'correct-horse'])
      expect(raw).not.toContain(secret);
  });

  it('notices an item removed behind its back, and keeps a damaged one', async () => {
    const { home, service } = await vault();
    const a = await service.create(login());
    await service.create(login({ title: 'Other' }));
    const path = join(home, 'vault', 'vault.json');
    const file = JSON.parse(await readFile(path, 'utf8'));
    file.items = file.items.filter((i: { id: string }) => i.id !== a.id);
    await writeFile(path, JSON.stringify(file));
    const reopened = new VaultStore(
      join(home, 'vault'),
      async () => new FileKeystore(join(home, 'vault')),
    );
    expect((await reopened.open()).tampered).toBe(true);

    file.items[0].s.c = `${file.items[0].s.c.slice(0, -4)}AAAA`;
    await writeFile(path, JSON.stringify(file));
    const again = new VaultStore(
      join(home, 'vault'),
      async () => new FileKeystore(join(home, 'vault')),
    );
    expect((await again.open()).damaged).toHaveLength(1);
  });

  it('won’t open with another computer’s key, and says so in words', async () => {
    const { home, service } = await vault();
    await service.create(login());
    await writeFile(join(home, 'vault', 'device.key'), `${'ab'.repeat(32)}\n`);
    const other = new VaultService({ home, keystore: 'file' });
    await expect(other.list()).rejects.toThrow(/can’t open your passwords on this computer/);
  });
});

describe('one-time codes', () => {
  it('matches the RFC 4226 and RFC 6238 test vectors', () => {
    const secret = Buffer.from('12345678901234567890');
    expect(hotp(secret, 0)).toBe('755224');
    expect(hotp(secret, 9)).toBe('520489');
    const config = { secret, algorithm: 'sha1' as const, digits: 8, period: 30 };
    expect(totpNow(config, 59_000).code).toBe('94287082');
    expect(totpNow(config, 1_111_111_109_000).code).toBe('07081804');
    expect(totpNow(config, 59_000).expiresAt).toBe(60_000);
  });

  it('reads otpauth links and plain keys, and refuses unsafe ones', () => {
    const c = parseTotp(
      'otpauth://totp/GitHub:ada?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=GitHub&digits=6&period=30',
    );
    expect(c).toMatchObject({ issuer: 'GitHub', account: 'ada', digits: 6, period: 30 });
    expect(parseTotp('jbsw y3dp ehpk 3pxp').digits).toBe(6);
    expect(base32Decode('MZXW6===').toString()).toBe('foo');
    expect(() => parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP')).toThrow(/time-based/);
    expect(() => parseTotp('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=10')).toThrow(/6 to 8/);
    expect(() => parseTotp('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0')).toThrow(
      /15 and 120/,
    );
    expect(() => parseTotp('MZXW6')).toThrow(/too short/);
    expect(() => parseTotp('not base32!')).toThrow(/base32/);
    expect(() => parseTotp(`otpauth://totp/x?secret=${'A'.repeat(3000)}`)).toThrow(/too long/);
  });
});

describe('passwords (shared)', () => {
  it('generates what was asked for, without bias toward any class', () => {
    const p = generatePassword({ style: 'random', length: 24, symbols: true, digits: true });
    expect(p).toHaveLength(24);
    expect(p).toMatch(/[a-z]/);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/\d/);
    expect(p).toMatch(/[^A-Za-z0-9]/);
    expect(generatePassword({ style: 'random', unambiguous: true, length: 64 })).not.toMatch(
      /[O0oIl1]/,
    );
    expect(generatePassword({ style: 'pin', length: 6 })).toMatch(/^\d{6}$/);
    expect(generatePassword({ style: 'words', length: 5, separator: '-' }).split('-')).toHaveLength(
      5,
    );
    expect(new Set(Array.from({ length: 50 }, () => generatePassword())).size).toBe(50);
  });

  it('scores passwords, and rates the common ones lowest', () => {
    expect(passwordScore('password')).toBe(0);
    expect(passwordScore('aaaaaaaaaaaa')).toBe(0);
    expect(passwordScore(generatePassword({ length: 24 }))).toBe(4);
  });

  it('matches sites exactly or by subdomain, never by lookalike', () => {
    expect(siteOf('https://www.Netflix.com/login')).toBe('netflix.com');
    expect(siteOf('javascript:alert(1)')).toBeUndefined();
    expect(siteMatches('google.com', 'accounts.google.com')).toBe(true);
    expect(siteMatches('google.com', 'google.com.evil.io')).toBe(false);
    expect(siteMatches('google.com', 'evilgoogle.com')).toBe(false);
    expect(siteMatches('accounts.google.com', 'google.com')).toBe(false);
  });
});

describe('the vault', () => {
  it('adds, lists, edits and keeps old passwords, never sending a secret in a list', async () => {
    const { service } = await vault();
    const created = await service.create(login());
    const listed = await service.list();
    expect(listed.items[0]).toMatchObject({
      title: 'Netflix',
      subtitle: 'ada@example.com',
      domains: ['netflix.com'],
    });
    expect(JSON.stringify(listed)).not.toContain('correct-horse');
    const detail = await service.detail(created.id);
    const password = detail.fields.find((f) => f.role === 'password');
    expect(password).toMatchObject({ filled: true, strength: expect.any(Number) });
    expect(password?.value).toBeUndefined();

    // Editing without sending the password keeps it; a new one moves the old to history.
    const fields = detail.fields.map((f) => ({
      id: f.id,
      label: f.label,
      kind: f.kind,
      role: f.role,
      ...(f.value !== undefined && { value: f.value }),
    }));
    await service.update(created.id, { ...login(), fields, title: 'Netflix (family)' });
    expect(await service.reveal(created.id, password?.id ?? '', undefined)).toBe(
      'correct-horse-battery-staple-9',
    );
    await service.update(created.id, {
      ...login(),
      fields: fields.map((f) =>
        f.role === 'password' ? { ...f, value: 'new-Password-2026!x' } : f,
      ),
    });
    expect((await service.history(created.id)).entries[0]?.value).toBe(
      'correct-horse-battery-staple-9',
    );
  });

  it('flags weak, reused, insecure and expired items', async () => {
    const { service } = await vault();
    const weak = (title: string) =>
      login({
        title,
        fields: [{ label: 'Password', kind: 'secret', role: 'password', value: 'password1' }],
      });
    await service.create(weak('A'));
    await service.create(weak('B'));
    await service.create(login({ title: 'Old router', urls: ['http://example.com'] }));
    await service.create({
      ...login(),
      type: 'card',
      title: 'Old card',
      urls: [],
      fields: [{ label: 'Expires', kind: 'monthYear', role: 'expiry', value: '01/20' }],
    });
    const { status, items } = await service.list();
    expect(status.health).toMatchObject({ weak: 2, reused: 2, insecure: 1, expired: 1 });
    expect(items.find((i) => i.title === 'A')?.problems).toEqual(
      expect.arrayContaining(['weak', 'reused']),
    );
  });

  it('deletes into Recently deleted, restores, and only purges from there', async () => {
    const { service } = await vault();
    const a = await service.create(login());
    await service.trash([a.id]);
    expect((await service.list()).status.trash).toBe(1);
    await service.restore([a.id]);
    expect((await service.list()).items[0]?.deletedAt).toBeUndefined();
    expect(await service.purge()).toBe(0);
    await service.trash([a.id]);
    expect(await service.purge()).toBe(1);
    expect((await service.list()).items).toHaveLength(0);
  });

  it('refuses a broken one-time code setup and addresses that aren’t web addresses', async () => {
    const { service } = await vault();
    await expect(
      service.create(
        login({ fields: [{ label: 'Code', kind: 'totp', role: 'totp', value: 'nope!' }] }),
      ),
    ).rejects.toThrow(/base32/);
    await expect(service.create(login({ urls: ['javascript:alert(1)'] }))).rejects.toThrow();
  });

  it('checks breaches anonymously: five characters out, padding ignored', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const password = 'correct-horse-battery-staple-9';
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const fakeFetch = (async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return new Response(`${sha1.slice(5)}:42\r\n${'F'.repeat(35)}:0\r\n`);
    }) as unknown as typeof fetch;
    const { service } = await vault({ fetch: fakeFetch });
    await service.create(login());
    expect(await service.checkBreaches()).toEqual({ checked: 1, compromised: 1 });
    expect(calls[0]?.url).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
    expect(calls[0]?.url).not.toContain(sha1.slice(5));
    expect(calls[0]?.headers['Add-Padding']).toBe('true');
    expect((await service.list()).status.health.compromised).toBe(1);
  });
});

describe('import & export', () => {
  it('recognises each app by its headers', () => {
    expect(detectFormat('name,url,username,password,note\n')).toBe('chrome');
    expect(
      detectFormat('"url","username","password","httpRealm","formActionOrigin","guid"\n'),
    ).toBe('firefox');
    expect(detectFormat('Title,URL,Username,Password,Notes,OTPAuth\n')).toBe('safari');
    expect(
      detectFormat(
        'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n',
      ),
    ).toBe('bitwarden-csv');
    expect(detectFormat('url,username,password,totp,extra,name,grouping,fav\n')).toBe('lastpass');
    expect(
      detectFormat(
        '"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"\n',
      ),
    ).toBe('keepassxc');
    expect(
      detectFormat(
        'type,name,url,autofillUrls,email,username,password,note,totp,createTime,modifyTime,vault\n',
      ),
    ).toBe('proton');
    expect(detectFormat('{"encrypted":false,"items":[]}')).toBe('bitwarden-json');
  });

  it('reads quoted CSV, notes and folders, and skips duplicates', async () => {
    const csv = [
      'url,username,password,totp,extra,name,grouping,fav',
      'https://github.com,ada,"pa,ss""word",,"line1\nline2",GitHub,Work,1',
      'http://sn,,,,"my secret note",Safe combo,Home,0',
      'https://github.com,ada,"pa,ss""word",,,GitHub copy,Work,0',
    ].join('\n');
    const parsed = parseImport(csv);
    expect(parsed.format).toBe('lastpass');
    expect(parsed.items[0]).toMatchObject({
      title: 'GitHub',
      tags: ['Work'],
      favorite: true,
      notes: 'line1\nline2',
    });
    expect(parsed.items[0]?.fields.find((f) => f.role === 'password')?.value).toBe('pa,ss"word');
    expect(parsed.items[1]).toMatchObject({ type: 'note', title: 'Safe combo' });

    const { service } = await vault();
    const preview = await service.import({
      format: 'auto',
      text: csv,
      commit: false,
      skipDuplicates: true,
    });
    expect(preview).toMatchObject({ formatName: 'LastPass', found: 3, duplicates: 1 });
    expect((await service.list()).items).toHaveLength(0);
    const done = await service.import({
      format: 'auto',
      text: csv,
      commit: true,
      skipDuplicates: true,
    });
    expect(done.imported).toBe(2);
    // Importing again finds everything already there.
    expect(
      (await service.import({ format: 'auto', text: csv, commit: false, skipDuplicates: true }))
        .duplicates,
    ).toBe(3);
  });

  it('refuses an encrypted Bitwarden export with what to do instead', () => {
    expect(() => parseImport('{"encrypted":true,"items":[]}')).toThrow(/Export again/);
  });

  it('exports values exactly, quoting what needs it', async () => {
    expect(toCsv([['=1+1', 'a"b', 'x,y']])).toBe('=1+1,"a""b","x,y"\r\n');
    const { service } = await vault();
    await service.create(login());
    const csv = await service.exportCsv();
    expect(parseCsv(csv)[1]).toEqual(
      expect.arrayContaining(['Netflix', 'ada@example.com', 'correct-horse-battery-staple-9']),
    );
  });
});

describe('the agent', () => {
  it('sees names and sites only', async () => {
    const { service } = await vault();
    await service.create(login());
    await service.create(login({ title: 'Hidden', agentAccess: 'never' }));
    const found = await service.forAgent();
    expect(found).toEqual([
      {
        id: expect.any(String),
        title: 'Netflix',
        type: 'login',
        sites: ['netflix.com'],
        source: 'conch',
        passkey: false,
      },
    ]);
    expect(JSON.stringify(found)).not.toMatch(/ada@|correct-horse|••••/);
  });

  it('fills only on the item’s own site (subdomains included), never a lookalike', async () => {
    const { service } = await vault();
    const item = await service.create(login());
    const want = 'password' as const;
    expect(
      await service.fillPolicy({ itemId: item.id, host: 'www.netflix.com', want }),
    ).toMatchObject({ ask: true });
    expect(await service.fillValue({ itemId: item.id, host: 'netflix.com', want })).toBe(
      'correct-horse-battery-staple-9',
    );
    for (const host of ['netflix.com.evil.io', 'evilnetflix.com', 'netflix.co'])
      await expect(service.fillPolicy({ itemId: item.id, host, want })).rejects.toThrow(
        /only fills a password on the site/,
      );
    const never = await service.create(login({ title: 'No', agentAccess: 'never' }));
    await expect(
      service.fillPolicy({ itemId: never.id, host: 'netflix.com', want }),
    ).rejects.toThrow(/never/);
    // Every value handled is known for redaction.
    expect(await service.secretValues()).toContain('correct-horse-battery-staple-9');
  });
});

/** A pretend `op` and `bw`, recording what was asked and never passing secrets as arguments. */
function fakeExec(calls: { args: string[]; env?: Record<string, string>; input?: string }[]): Exec {
  return {
    find: async (name) => `/fake/${name}`,
    run: async (file, args, options = {}) => {
      calls.push({
        args,
        ...(options.env && { env: options.env }),
        ...(options.input && { input: options.input }),
      });
      const tool = file.split('/').pop();
      const ok = (stdout: string) => ({ stdout, stderr: '', code: 0 });
      if (tool === 'op') {
        if (args[0] === 'account') return ok('[{"url":"my.1password.com"}]');
        if (args.join(' ') === 'item list --format json')
          return ok(
            JSON.stringify([
              {
                id: 'abc123',
                title: 'Bank',
                category: 'LOGIN',
                vault: { id: 'vlt1', name: 'Personal' },
                urls: [{ href: 'https://bank.example' }],
                additional_information: 'ada',
              },
            ]),
          );
        if (args[0] === 'item' && args[1] === 'get' && args.includes('--otp'))
          return ok('123456\n');
        if (args[0] === 'item' && args[1] === 'get')
          return ok(
            JSON.stringify({
              fields: [
                {
                  id: 'username',
                  type: 'STRING',
                  purpose: 'USERNAME',
                  label: 'username',
                  value: 'ada',
                },
                {
                  id: 'password',
                  type: 'CONCEALED',
                  purpose: 'PASSWORD',
                  label: 'password',
                  value: args.includes('--reveal') ? 'op-secret-value' : 'op-secret-value',
                },
              ],
            }),
          );
      }
      if (tool === 'bw') {
        if (args[0] === 'status')
          return ok(JSON.stringify({ status: options.env?.BW_SESSION ? 'unlocked' : 'locked' }));
        if (args[0] === 'unlock')
          return options.env?.CONCH_BW_PASSWORD === 'master'
            ? ok('SESSIONKEY')
            : { stdout: '', stderr: 'Invalid master password.', code: 1 };
        if (args.join(' ') === 'list items')
          return ok(
            JSON.stringify([
              {
                id: '11111111-2222-3333-4444-555555555555',
                type: 1,
                name: 'Mail',
                login: {
                  username: 'ada',
                  password: 'bw-secret-value',
                  uris: [{ uri: 'https://mail.example' }],
                },
              },
            ]),
          );
        if (args[0] === 'get' && args[1] === 'item')
          return ok(
            JSON.stringify({ id: args[2], type: 1, login: { password: 'bw-secret-value' } }),
          );
      }
      return { stdout: '', stderr: 'unknown', code: 1 };
    },
  };
}

describe('other password managers', () => {
  it('shows 1Password and Bitwarden items alongside, read-only, with no secret in the list', async () => {
    const calls: { args: string[]; env?: Record<string, string> }[] = [];
    const { service } = await vault({ exec: fakeExec(calls) });
    await service.setSource('1password', { enabled: true });
    await service.setSource('bitwarden', { enabled: true });
    let list = await service.list();
    expect(list.status.sources.find((s) => s.id === 'bitwarden')?.state).toBe('locked');
    await expect(service.unlockSource('bitwarden', 'wrong')).rejects.toThrow(/master password/);
    await service.unlockSource('bitwarden', 'master');
    list = await service.list();
    expect(list.items.map((i) => [i.title, i.source, i.readOnly])).toEqual([
      ['Bank', '1password', true],
      ['Mail', 'bitwarden', true],
    ]);
    expect(JSON.stringify(list)).not.toMatch(/op-secret|bw-secret/);
    const bank = list.items.find((i) => i.title === 'Bank');
    const detail = await service.detail(bank?.id ?? '');
    expect(JSON.stringify(detail)).not.toContain('op-secret');
    expect(await service.reveal(bank?.id ?? '', 'password', undefined)).toBe('op-secret-value');
    expect((await service.totp(bank?.id ?? '', undefined, undefined)).code).toBe('123456');
    await expect(service.update(bank?.id ?? '', login())).rejects.toThrow(/its own app/);
    // The master password went in the environment, never on the command line.
    expect(calls.every((c) => !c.args.join(' ').includes('master'))).toBe(true);
    expect(calls.filter((c) => c.args[0] === 'unlock').at(-1)?.env?.CONCH_BW_PASSWORD).toBe(
      'master',
    );
    // Locked again: its items leave the list.
    service.lockSource('bitwarden');
    expect((await service.list()).items.map((i) => i.title)).toEqual(['Bank']);
  });

  it('fills an external item only on its own site', async () => {
    const { service } = await vault({ exec: fakeExec([]) });
    await service.setSource('1password', { enabled: true });
    const bank = (await service.list()).items[0];
    expect(
      await service.fillValue({ itemId: bank?.id ?? '', host: 'bank.example', want: 'password' }),
    ).toBe('op-secret-value');
    await expect(
      service.fillPolicy({ itemId: bank?.id ?? '', host: 'bank.example.evil', want: 'password' }),
    ).rejects.toThrow();
  });
});

describe('Repair everything', () => {
  it('says how Passwords is, and points at a password manager that needs installing', async () => {
    const { vaultCheck } = await import('./doctor');
    const exec: Exec = {
      find: async () => undefined,
      run: async () => ({ stdout: '', stderr: '', code: 1 }),
    };
    const { service } = await vault({ exec });
    await service.create(login());
    await service.setSource('bitwarden', { enabled: true });
    const items = await vaultCheck(service).run({
      repair: false,
      signal: new AbortController().signal,
    });
    expect(items[0]).toMatchObject({
      id: 'passwords:vault',
      state: 'warning',
      message: expect.stringContaining('file on this computer'),
    });
    expect(items.find((i) => i.id === 'passwords:bitwarden')).toMatchObject({
      state: 'needs-you',
      action: { kind: 'need', need: 'bw', mode: 'install' },
    });
  });
});
