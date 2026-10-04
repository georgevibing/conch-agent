import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AddressError, AddressStore, normaliseName } from './store';

describe('normaliseName', () => {
  it.each([
    ['conch.example.com', 'conch.example.com'],
    ['  https://Conch.Example.com/  ', 'conch.example.com'],
    ['http://conch.example.com', 'conch.example.com'],
    ['conch.example.com.', 'conch.example.com'],
    ['example.com', 'example.com'],
    ['me.duckdns.org', 'me.duckdns.org'],
    ['conch.example.co.uk', 'conch.example.co.uk'],
    ['bücher.de', 'xn--bcher-kva.de'],
  ])('%s → %s', (raw, name) => {
    expect(normaliseName(raw)).toBe(name);
  });

  it.each([
    ['', /Type the address/],
    ['203.0.113.9', /IP address/],
    ['[2001:db8::1]', /IP address/],
    ['conch.example.com:8443', /without a port/],
    ['conch.example.com/app', /without a path/],
    ['localhost', /this computer/],
    ['conch.localhost', /this computer/],
    ['conch', /no domain/],
    ['nas.local', /inside a network/],
    ['conch.example.notatld', /domain anyone can own/],
    ['user@conch.example.com', /doesn’t look like an address/],
    ['-bad.example.com', /doesn’t look like an address/],
    ['co.uk', /domain anyone can own/],
  ])('refuses %s', (raw, why) => {
    expect(() => normaliseName(raw)).toThrow(AddressError);
    expect(() => normaliseName(raw)).toThrow(why);
  });
});

describe('AddressStore', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'conch-address-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('keeps the address, and reads nothing as off', async () => {
    const store = new AddressStore(home);
    expect((await store.read()).name).toBeUndefined();
    await store.write({ version: 1, name: 'conch.example.com', since: 1, setOn: 'abc' });
    expect(await store.read()).toMatchObject({ name: 'conch.example.com', setOn: 'abc' });
  });

  it('makes this computer’s id once, and keeps it', async () => {
    const store = new AddressStore(home);
    const id = await store.machine();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(await new AddressStore(home).machine()).toBe(id);
  });

  it('keeps the certificate and its key readable by you alone', async () => {
    const store = new AddressStore(home);
    expect(await store.certificate()).toBeUndefined();
    const cert = {
      certPem: '-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n',
      keyPem: '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----\n',
    };
    await store.saveCertificate(cert);
    expect(await store.certificate()).toEqual(cert);
    if (process.platform !== 'win32') {
      expect((await stat(join(home, 'address', 'key.pem'))).mode & 0o777).toBe(0o600);
      expect((await stat(join(home, 'address'))).mode & 0o777).toBe(0o700);
    }
  });

  it('forgets the address and its certificate, but not this computer', async () => {
    const store = new AddressStore(home);
    const id = await store.machine();
    await store.write({ version: 1, name: 'conch.example.com' });
    await store.saveCertificate({ certPem: 'BEGIN CERTIFICATE', keyPem: 'PRIVATE KEY' });
    await store.saveState({ failures: 2 });
    await store.clear();
    expect((await store.read()).name).toBeUndefined();
    expect(await store.certificate()).toBeUndefined();
    expect((await store.state()).failures).toBe(0);
    expect((await readFile(join(home, 'address', 'machine'), 'utf8')).trim()).toBe(id);
  });

  it('keeps an account key only when it has its private part', async () => {
    const store = new AddressStore(home);
    expect(await store.accountKey()).toBeUndefined();
    await store.saveAccountKey({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' });
    expect(await store.accountKey()).toBeUndefined();
    await store.saveAccountKey({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b', d: 'c' });
    expect(await store.accountKey()).toMatchObject({ d: 'c' });
  });
});
