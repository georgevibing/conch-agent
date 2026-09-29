import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Where Conch may send requests for an integration. OAuth discovery follows
 * URLs the *remote server* hands us (resource metadata, authorization server,
 * token endpoint), so a hostile or compromised server could point them at
 * this computer or the local network (SSRF). Rules, per the MCP security
 * best practices (2025-11-25):
 *
 * - https only — plain http just for servers you added on your own network;
 * - never cloud metadata or link-local addresses;
 * - private and loopback addresses only when the integration itself lives there;
 * - every redirect hop is checked again.
 */

const linkLocal = new BlockList();
linkLocal.addSubnet('169.254.0.0', 16, 'ipv4');
linkLocal.addSubnet('fe80::', 10, 'ipv6');
linkLocal.addAddress('fd00:ec2::254', 'ipv6');
linkLocal.addSubnet('0.0.0.0', 8, 'ipv4');

const privateNets = new BlockList();
privateNets.addSubnet('127.0.0.0', 8, 'ipv4');
privateNets.addSubnet('10.0.0.0', 8, 'ipv4');
privateNets.addSubnet('172.16.0.0', 12, 'ipv4');
privateNets.addSubnet('192.168.0.0', 16, 'ipv4');
privateNets.addSubnet('100.64.0.0', 10, 'ipv4');
privateNets.addAddress('::1', 'ipv6');
privateNets.addSubnet('fc00::', 7, 'ipv6');

export class EndpointError extends Error {}

function family(address: string): 'ipv4' | 'ipv6' {
  return isIP(address) === 6 ? 'ipv6' : 'ipv4';
}

function unmapped(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return mapped?.[1] ?? address;
}

export type Reach = 'public' | 'private';

/** Is this address on this computer or the local network? */
export function isPrivateAddress(address: string): boolean {
  const a = unmapped(address);
  return privateNets.check(a, family(a)) || linkLocal.check(a, family(a));
}

export function isBlockedAddress(address: string): boolean {
  const a = unmapped(address);
  return linkLocal.check(a, family(a));
}

const bare = (hostname: string) => hostname.replace(/^\[|\]$/g, '').toLowerCase();

export async function addresses(hostname: string): Promise<string[]> {
  const host = bare(hostname);
  if (isIP(host)) return [host];
  if (host === 'localhost' || host.endsWith('.localhost')) return ['127.0.0.1'];
  try {
    return (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);
  } catch {
    throw new EndpointError(
      `Couldn’t find ${host}. Check the address and your internet connection.`,
    );
  }
}

/** Whether an integration's own address is on the internet or your own network. */
export async function reachOf(url: string): Promise<Reach> {
  const found = await addresses(new URL(url).hostname).catch(() => []);
  return found.length > 0 && found.every(isPrivateAddress) ? 'private' : 'public';
}

/** Throws if Conch shouldn't talk to `url` for an integration that lives at `reach`. */
export async function checkEndpoint(url: URL, reach: Reach): Promise<void> {
  if (url.username || url.password) throw new EndpointError('Addresses can’t contain a password.');
  const https = url.protocol === 'https:';
  if (!https && !(url.protocol === 'http:' && reach === 'private')) {
    throw new EndpointError(`Conch only connects to secure (https) addresses, not ${url.origin}.`);
  }
  const found = await addresses(url.hostname);
  if (found.some(isBlockedAddress))
    throw new EndpointError(`${url.hostname} points somewhere Conch never connects to.`);
  if (reach === 'public' && found.some(isPrivateAddress))
    throw new EndpointError(`${url.hostname} points into your own network, so Conch won’t use it.`);
}

type Fetch = typeof fetch;

/**
 * `fetch` that checks every hop against `checkEndpoint`. Redirects are followed
 * by hand (at most 5) so a public server can't bounce us somewhere private.
 */
export function guardedFetch(reach: Reach, base: Fetch = fetch): Fetch {
  return async (input, init) => {
    let url = new URL(input instanceof Request ? input.url : String(input));
    for (let hop = 0; hop < 6; hop++) {
      await checkEndpoint(url, reach);
      const response = await base(url, {
        ...init,
        redirect: 'manual',
        signal: init?.signal ?? AbortSignal.timeout(15_000),
      });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) return response;
      url = new URL(location, url);
    }
    throw new EndpointError('Too many redirects.');
  };
}

/** Only these may be opened in your browser as a sign-in page. */
export function safeAuthorizeUrl(url: URL, reach: Reach): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && reach === 'private');
}
