import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';

import { addresses, isBlockedAddress, isPrivateAddress } from '../integrations/net';

/**
 * Where the agent's browser may go (ADR 0014, "Containment"). Every request
 * the browser makes — page loads, fetches, WebSockets — is checked here.
 *
 * - Never Conch itself: the gateway trusts this computer (ADR 0008), so a page
 *   that could reach it could make the agent approve its own permissions.
 * - Never link-local or cloud-metadata addresses.
 * - Not this computer or your network unless you turn on "local apps".
 * - Only http(s); the agent can't open `file:`, `chrome:` or script URLs.
 */
export interface GuardPolicy {
  /** Open pages on this computer and your network (localhost dev servers, a router). */
  allowLocal: boolean;
  /** The gateway's own port, blocked on every local address even when local is allowed. */
  gatewayPort: number;
}

export type Blocked = 'scheme' | 'credentials' | 'gateway' | 'metadata' | 'local' | 'unresolved';

export type Verdict = { ok: true } | { ok: false; reason: Blocked; message: string };

const OK: Verdict = { ok: true };

/** How long a hostname's addresses are trusted before asking DNS again. */
const DNS_TTL_MS = 60_000;

type Resolve = (hostname: string) => Promise<string[]>;

const bare = (hostname: string) => hostname.replace(/^\[|\]$/g, '').toLowerCase();

/** Every address this computer answers on, so "the gateway" can't hide behind a LAN IP. */
function localAddresses(): Set<string> {
  const found = new Set(['127.0.0.1', '::1', '0.0.0.0', '::']);
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) found.add(entry.address.toLowerCase());
  }
  return found;
}

const defaultPort = (url: URL) =>
  Number(url.port) || (url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80);

export class BrowserGuard {
  #cache = new Map<string, { at: number; addresses: string[] }>();
  #local = localAddresses();

  constructor(
    private policy: () => GuardPolicy,
    private readonly resolve: Resolve = addresses,
  ) {}

  /** Forget cached lookups, e.g. after the network changes. */
  reset(): void {
    this.#cache.clear();
    this.#local = localAddresses();
  }

  async #addresses(hostname: string): Promise<string[]> {
    const host = bare(hostname);
    if (isIP(host)) return [host];
    if (host === 'localhost' || host.endsWith('.localhost')) return ['127.0.0.1', '::1'];
    const hit = this.#cache.get(host);
    if (hit && Date.now() - hit.at < DNS_TTL_MS) return hit.addresses;
    const found = await this.resolve(host);
    this.#cache.set(host, { at: Date.now(), addresses: found });
    return found;
  }

  /** May the agent navigate to `raw` (typed by it or by you)? Same rules, plus only http(s). */
  navigation(raw: string): Promise<Verdict> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return Promise.resolve({
        ok: false,
        reason: 'scheme',
        message: `“${raw}” isn’t a web address.`,
      });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      if (url.href === 'about:blank') return Promise.resolve(OK);
      return Promise.resolve({
        ok: false,
        reason: 'scheme',
        message: `The browser only opens web pages (http and https), not ${url.protocol} addresses.`,
      });
    }
    return this.request(url);
  }

  /** May the browser fetch `url`? Checked for every request and WebSocket the page makes. */
  async request(input: URL | string): Promise<Verdict> {
    const url = typeof input === 'string' ? new URL(input) : input;
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return OK;
    if (url.username || url.password) {
      return {
        ok: false,
        reason: 'credentials',
        message: 'Addresses with a password in them aren’t opened.',
      };
    }
    let found: string[] = [];
    try {
      found = await this.#addresses(url.hostname);
    } catch {
      // Handled below. Chrome may resolve names itself (DNS over HTTPS), so a
      // name we can't check must not be let through to land somewhere private.
    }
    if (found.length === 0) {
      return {
        ok: false,
        reason: 'unresolved',
        message: `Couldn’t find ${url.hostname}. Check the address and your internet connection.`,
      };
    }
    const { allowLocal, gatewayPort } = this.policy();
    const port = defaultPort(url);
    const onThisComputer = (a: string) =>
      this.#local.has(a.toLowerCase()) || a.startsWith('127.') || a === '::1';
    if (port === gatewayPort && found.some(onThisComputer)) {
      return {
        ok: false,
        reason: 'gateway',
        message: 'The browser can’t open Conch itself.',
      };
    }
    if (found.some(isBlockedAddress)) {
      return {
        ok: false,
        reason: 'metadata',
        message: `${url.hostname} points somewhere the browser never goes.`,
      };
    }
    if (!allowLocal && found.some((a) => isPrivateAddress(a) || onThisComputer(a))) {
      return {
        ok: false,
        reason: 'local',
        message: `${url.hostname} is on this computer or your network. Turn on “Open local apps” in Settings › Browser to allow it.`,
      };
    }
    return OK;
  }
}
