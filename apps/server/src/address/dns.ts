/**
 * Where a name points, and where this server is (ADR 0064).
 *
 * Names are looked up at public resolvers first (Cloudflare's and Google's),
 * so a record that was just added isn't hidden by this computer's cache;
 * the system's own resolver is the fallback for networks that block them.
 * This server's public address comes from its own network interfaces when
 * they have one, and otherwise from asking Cloudflare's trace page (and
 * ipify): only the request's own address is learnt, nothing is sent.
 */
import { BlockList, isIP } from 'node:net';
import { promises as dns } from 'node:dns';
import { networkInterfaces } from 'node:os';

import { parse as parseDomain } from 'tldts';

export const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8'];

export interface Found {
  v4: string[];
  v6: string[];
}

export interface Mine {
  v4?: string;
  v6?: string;
}

export type Resolve = (name: string, family: 4 | 6, servers?: string[]) => Promise<string[]>;

const NO_RECORD = new Set(['ENODATA', 'ENOTFOUND', 'ESERVFAIL', 'NXDOMAIN']);

/** Node's own resolver: at `servers` when given, else the system's. */
export const resolveWithNode: Resolve = async (name, family, servers) => {
  const resolver = new dns.Resolver({ timeout: 3000, tries: 2 });
  if (servers) resolver.setServers(servers);
  try {
    return family === 4 ? await resolver.resolve4(name) : await resolver.resolve6(name);
  } catch (error) {
    if (NO_RECORD.has((error as NodeJS.ErrnoException).code ?? '')) return [];
    throw error;
  }
};

/** Resolvers to ask instead of the public ones (`CONCH_DNS_SERVERS`): a test network's. */
export function chosenResolvers(env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const servers = env.CONCH_DNS_SERVERS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return servers?.length ? servers : undefined;
}

/** A name's A and AAAA records, from the public resolvers, else the system's. */
export async function lookupName(name: string, resolve: Resolve = resolveWithNode): Promise<Found> {
  const both = (servers?: string[]) =>
    Promise.all([resolve(name, 4, servers), resolve(name, 6, servers)]).then(([v4, v6]) => ({
      v4,
      v6,
    }));
  const chosen = chosenResolvers();
  if (chosen) return both(chosen);
  try {
    return await both(PUBLIC_RESOLVERS);
  } catch {
    // Outbound DNS blocked (some networks only allow their own resolver).
    return both().catch(() => ({ v4: [], v6: [] }));
  }
}

const notPublic = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  notPublic.addSubnet(net, bits, 'ipv4');
// Not ::ffff:0:0/96: Node's BlockList counts IPv4-mapped addresses as IPv4, so it
// would cover every IPv4 address there is.
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  notPublic.addSubnet(net, bits, 'ipv6');

/** An address the internet can reach (not private, CGNAT, link-local or documentation). */
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (!family) return false;
  return !notPublic.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** Cloudflare's published ranges (cloudflare.com/ips), for a name behind its proxy. */
const cloudflare = new BlockList();
for (const range of [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
]) {
  const [net = '', bits = '32'] = range.split('/');
  cloudflare.addSubnet(net, Number(bits), 'ipv4');
}
for (const range of [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]) {
  const [net = '', bits = '128'] = range.split('/');
  cloudflare.addSubnet(net, Number(bits), 'ipv6');
}

export function isCloudflare(ip: string): boolean {
  const family = isIP(ip);
  return family !== 0 && cloudflare.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** This computer's own public addresses, from its interfaces (a VPS usually has them). */
export function interfaceAddresses(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): Mine {
  const mine: Mine = {};
  for (const list of Object.values(interfaces))
    for (const net of list ?? []) {
      if (net.internal || !isPublicIp(net.address)) continue;
      if (net.family === 'IPv4') mine.v4 ??= net.address;
      else mine.v6 ??= net.address;
    }
  return mine;
}

async function ask(fetcher: typeof fetch, url: string, read: (text: string) => string | undefined) {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;
    const ip = read((await response.text()).trim());
    return ip && isPublicIp(ip) ? ip : undefined;
  } catch {
    return undefined;
  }
}

/**
 * This server's public addresses: its own interfaces' when they're public,
 * else what the internet sees (behind a cloud's 1:1 NAT, like AWS).
 */
export async function publicAddresses(
  deps: { fetch?: typeof fetch; interfaces?: ReturnType<typeof networkInterfaces> } = {},
): Promise<Mine> {
  // Said outright (`CONCH_PUBLIC_IP`): behind a NAT Conch can't see past, or a test network.
  const said = process.env.CONCH_PUBLIC_IP?.trim();
  if (said && isIP(said)) return isIP(said) === 4 ? { v4: said } : { v6: said };
  const mine = interfaceAddresses(deps.interfaces);
  const fetcher = deps.fetch ?? fetch;
  const trace = (text: string) => /^ip=(.+)$/m.exec(text)?.[1]?.trim();
  if (!mine.v4)
    mine.v4 =
      (await ask(fetcher, 'https://1.1.1.1/cdn-cgi/trace', trace)) ??
      (await ask(fetcher, 'https://api.ipify.org', (t) => t));
  if (!mine.v6) {
    const v6 = await ask(fetcher, 'https://api6.ipify.org', (t) => t);
    if (v6 && isIP(v6) === 6) mine.v6 = v6;
  }
  if (mine.v4 && isIP(mine.v4) !== 4) delete mine.v4;
  return mine;
}

export interface RecordAdvice {
  type: 'A' | 'AAAA';
  /** Relative to the domain, as most providers ask for it: `conch`, or `@` for the domain itself. */
  host: string;
  /** The whole name, for providers that want it written out. */
  name: string;
  value: string;
}

/** The records to add at the domain provider so `name` points at this server. */
export function recordAdvice(name: string, mine: Mine): RecordAdvice[] {
  const domain = parseDomain(name, { allowPrivateDomains: true }).domain ?? name;
  const host = name === domain ? '@' : name.slice(0, -(domain.length + 1));
  const out: RecordAdvice[] = [];
  if (mine.v4) out.push({ type: 'A', host, name, value: mine.v4 });
  if (mine.v6) out.push({ type: 'AAAA', host, name, value: mine.v6 });
  return out;
}

export type Pointing =
  /** Every record it has points here. */
  | 'here'
  /** No A or AAAA record yet. */
  | 'missing'
  /** Behind Cloudflare's proxy (the orange cloud): its records are Cloudflare's. */
  | 'cloudflare'
  /** It points at another server (or partly: one record here, one elsewhere). */
  | 'elsewhere';

/** Whether `found` leads to this server. An AAAA record elsewhere counts: browsers try it first. */
export function pointing(found: Found, mine: Mine): Pointing {
  const all = [...found.v4, ...found.v6];
  if (!all.length) return 'missing';
  if (all.every(isCloudflare) && !all.includes(mine.v4 ?? '') && !all.includes(mine.v6 ?? ''))
    return 'cloudflare';
  const v4ok = found.v4.every((ip) => ip === mine.v4);
  const v6ok = found.v6.every((ip) => ip === mine.v6);
  return v4ok && v6ok ? 'here' : 'elsewhere';
}

/** What a person reads about where their name points, in a sentence. */
export function explainPointing(name: string, verdict: Pointing, found: Found): string {
  switch (verdict) {
    case 'here':
      return `${name} points at this server.`;
    case 'missing':
      return `${name} doesn’t point anywhere yet. Add the record below at your domain provider.`;
    case 'cloudflare':
      return `${name} is behind Cloudflare’s proxy (the orange cloud). In Cloudflare’s DNS settings, set it to “DNS only” (the grey cloud), so Conch can get its own certificate.`;
    case 'elsewhere':
      return `${name} points at ${[...found.v4, ...found.v6].join(', ')}, which isn’t this server. Change the record at your domain provider to the one below${found.v6.length ? ', and remove the AAAA record if this server has no IPv6' : ''}.`;
  }
}
