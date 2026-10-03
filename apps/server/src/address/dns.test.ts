import type { networkInterfaces } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  PUBLIC_RESOLVERS,
  explainPointing,
  interfaceAddresses,
  isCloudflare,
  isPublicIp,
  lookupName,
  pointing,
  publicAddresses,
  recordAdvice,
  type Resolve,
} from './dns';

type Interfaces = ReturnType<typeof networkInterfaces>;
const nic = (address: string, family: 'IPv4' | 'IPv6', internal = false) =>
  ({ address, family, internal, netmask: '', mac: '', cidr: null }) as never;

describe('isPublicIp', () => {
  it.each([
    ['203.0.113.9', false],
    ['198.51.100.1', false],
    ['10.0.0.5', false],
    ['172.20.1.1', false],
    ['192.168.1.2', false],
    ['100.64.3.4', false],
    ['127.0.0.1', false],
    ['169.254.1.1', false],
    ['95.217.10.20', true],
    ['8.8.8.8', true],
    ['fe80::1', false],
    ['fd00::1', false],
    ['2001:db8::1', false],
    ['::1', false],
    ['2a01:4f9:c010:1234::1', true],
    ['not-an-ip', false],
  ])('%s → %s', (ip, expected) => {
    expect(isPublicIp(ip)).toBe(expected);
  });
});

describe('isCloudflare', () => {
  it('knows Cloudflare’s ranges', () => {
    expect(isCloudflare('104.21.3.4')).toBe(true);
    expect(isCloudflare('2606:4700:3030::6815:1')).toBe(true);
    expect(isCloudflare('95.217.10.20')).toBe(false);
  });
});

describe('lookupName', () => {
  it('asks the public resolvers first', async () => {
    const asked: (string[] | undefined)[] = [];
    const resolve: Resolve = async (_name, family, servers) => {
      asked.push(servers);
      return family === 4 ? ['95.217.10.20'] : [];
    };
    expect(await lookupName('conch.example.com', resolve)).toEqual({
      v4: ['95.217.10.20'],
      v6: [],
    });
    expect(asked).toEqual([PUBLIC_RESOLVERS, PUBLIC_RESOLVERS]);
  });

  it('falls back to the system’s resolver when public DNS is blocked', async () => {
    const resolve: Resolve = async (_name, family, servers) => {
      if (servers) throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' });
      return family === 4 ? ['95.217.10.20'] : [];
    };
    expect(await lookupName('conch.example.com', resolve)).toEqual({
      v4: ['95.217.10.20'],
      v6: [],
    });
  });
});

describe('publicAddresses', () => {
  it('uses the server’s own public addresses when it has them', async () => {
    const interfaces: Interfaces = {
      eth0: [
        nic('95.217.10.20', 'IPv4'),
        nic('2a01:4f9:c010:1234::1', 'IPv6'),
        nic('fe80::1', 'IPv6'),
      ],
      lo: [nic('127.0.0.1', 'IPv4', true)],
    };
    const fetcher = (async () => {
      throw new Error('should not be asked');
    }) as typeof fetch;
    expect(await publicAddresses({ interfaces, fetch: fetcher })).toEqual({
      v4: '95.217.10.20',
      v6: '2a01:4f9:c010:1234::1',
    });
  });

  it('asks what the internet sees behind a cloud’s NAT', async () => {
    const interfaces: Interfaces = { ens5: [nic('172.31.5.6', 'IPv4')] };
    const asked: string[] = [];
    const fetcher = (async (url: string) => {
      asked.push(url);
      if (url.includes('cdn-cgi/trace'))
        return new Response('fl=1\nh=1.1.1.1\nip=3.120.4.5\nts=1\n');
      throw new Error('no IPv6');
    }) as unknown as typeof fetch;
    expect(await publicAddresses({ interfaces, fetch: fetcher })).toEqual({ v4: '3.120.4.5' });
    expect(asked[0]).toBe('https://1.1.1.1/cdn-cgi/trace');
  });

  it('ignores an answer that isn’t a public address', async () => {
    const fetcher = (async () => new Response('ip=10.0.0.1')) as unknown as typeof fetch;
    expect(await publicAddresses({ interfaces: {}, fetch: fetcher })).toEqual({});
  });

  it('reads interfaces without internal or private ones', () => {
    expect(interfaceAddresses({ docker0: [nic('172.17.0.1', 'IPv4')] })).toEqual({});
  });
});

describe('recordAdvice', () => {
  it('names a subdomain relative to its domain', () => {
    expect(recordAdvice('conch.example.com', { v4: '95.217.10.20', v6: '2a01:4f9::1' })).toEqual([
      { type: 'A', host: 'conch', name: 'conch.example.com', value: '95.217.10.20' },
      { type: 'AAAA', host: 'conch', name: 'conch.example.com', value: '2a01:4f9::1' },
    ]);
  });

  it('uses @ for the domain itself, and knows two-part suffixes', () => {
    expect(recordAdvice('example.co.uk', { v4: '95.217.10.20' })[0]?.host).toBe('@');
    expect(recordAdvice('a.b.example.co.uk', { v4: '95.217.10.20' })[0]?.host).toBe('a.b');
  });
});

describe('pointing', () => {
  const mine = { v4: '95.217.10.20', v6: '2a01:4f9::1' };
  it.each([
    [{ v4: ['95.217.10.20'], v6: [] }, 'here'],
    [{ v4: ['95.217.10.20'], v6: ['2a01:4f9::1'] }, 'here'],
    [{ v4: [], v6: [] }, 'missing'],
    [{ v4: ['104.21.3.4', '172.67.1.2'], v6: [] }, 'cloudflare'],
    [{ v4: ['5.6.7.8'], v6: [] }, 'elsewhere'],
    // An AAAA record pointing elsewhere breaks browsers that try IPv6 first.
    [{ v4: ['95.217.10.20'], v6: ['2a01:4f9::99'] }, 'elsewhere'],
  ] as const)('%j → %s', (found, verdict) => {
    expect(pointing({ v4: [...found.v4], v6: [...found.v6] }, mine)).toBe(verdict);
  });

  it('explains each in plain words', () => {
    expect(explainPointing('conch.example.com', 'cloudflare', { v4: [], v6: [] })).toMatch(
      /DNS only/,
    );
    expect(
      explainPointing('conch.example.com', 'elsewhere', { v4: ['5.6.7.8'], v6: ['2a01::9'] }),
    ).toMatch(/points at 5\.6\.7\.8, 2a01::9.*remove the AAAA record/);
  });
});
