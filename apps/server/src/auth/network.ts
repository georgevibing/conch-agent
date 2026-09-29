import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';

import type { Exposure } from '@conch/protocol';

import type { Config } from '../config';

export const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const WILDCARD = new Set(['0.0.0.0', '::', '[::]']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost');
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === '::1' || /^(::ffff:)?127\./.test(address);
}

export function exposure(config: Config): Exposure {
  return isLoopbackHost(config.CONCH_HOST.toLowerCase()) ? 'local' : 'network';
}

/** This computer's own LAN addresses (IPv4 first; link-local IPv6 is useless in a URL). */
function interfaceAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.internal) continue;
      if (net.family === 'IPv4') out.unshift(net.address);
      else if (!net.address.startsWith('fe80')) out.push(`[${net.address}]`);
    }
  }
  return out;
}

const TAILSCALE_BINARIES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/bin/tailscale',
];

/**
 * This machine's Tailscale name (`mac.tail1234.ts.net`), if Tailscale is
 * running. `tailscale serve` then gives other devices on your tailnet an
 * encrypted HTTPS address for Conch without opening any port.
 */
export function detectTailscale(): Promise<string | undefined> {
  const binary = TAILSCALE_BINARIES.find((p) => existsSync(p)) ?? 'tailscale';
  return new Promise((resolve) => {
    execFile(binary, ['status', '--json'], { timeout: 3000 }, (error, stdout) => {
      if (error) return resolve(undefined);
      try {
        const status = JSON.parse(stdout) as { Self?: { DNSName?: string }; BackendState?: string };
        const name = status.Self?.DNSName?.replace(/\.$/, '').toLowerCase();
        resolve(status.BackendState === 'Running' && name ? name : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/**
 * Which `Host` headers Conch answers to. Anything else is refused, which is
 * what defeats DNS rebinding: an attacker's domain can point at 127.0.0.1,
 * but the browser still sends *their* hostname.
 */
export class HostPolicy {
  readonly #allowed = new Set(LOOPBACK_HOSTS);
  #tailscale?: string;

  constructor(private readonly config: Config) {
    for (const h of config.CONCH_ALLOWED_HOSTS) this.#allowed.add(h);
    const bind = config.CONCH_HOST.toLowerCase();
    if (config.CONCH_ALLOW_REMOTE && !isLoopbackHost(bind)) {
      if (WILDCARD.has(bind)) {
        for (const a of interfaceAddresses()) this.#allowed.add(a);
        const name = hostname().toLowerCase();
        this.#allowed.add(name);
        this.#allowed.add(name.endsWith('.local') ? name : `${name}.local`);
      } else {
        this.#allowed.add(bind);
      }
    }
  }

  /** Look for Tailscale in the background; its name is ours, so it's safe to allow. */
  async discover(): Promise<void> {
    this.#tailscale = await detectTailscale();
    if (this.#tailscale) this.#allowed.add(this.#tailscale);
  }

  get tailscale() {
    return this.#tailscale;
  }

  allows(host: string): boolean {
    return this.#allowed.has(host) || host.endsWith('.localhost');
  }

  /** Addresses a phone could use to reach Conch (best first). */
  urls(): string[] {
    const port = this.config.CONCH_PORT;
    const out: string[] = [];
    if (this.#tailscale) out.push(`https://${this.#tailscale}`);
    for (const h of this.config.CONCH_ALLOWED_HOSTS) out.push(`https://${h}`);
    if (exposure(this.config) === 'network') {
      for (const h of this.#allowed) {
        if (
          isLoopbackHost(h) ||
          h === this.#tailscale ||
          this.config.CONCH_ALLOWED_HOSTS.includes(h)
        )
          continue;
        out.push(`http://${h}:${port}`);
      }
    }
    return [...new Set(out)];
  }
}
