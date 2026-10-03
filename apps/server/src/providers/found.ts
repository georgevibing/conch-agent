/**
 * What's already on this computer that would connect a provider in one press
 * (ADR 0053): a provider's key in the environment (`OPENAI_API_KEY`), a model
 * server already running on one of the usual ports. Offered on the Providers
 * page; nothing is used until someone presses it, and a key is never sent to
 * the browser — only which variable holds it and its last four characters.
 */
import type { EngineId, Found, ServerConfig } from '@conch/protocol';

import type { FetchLike } from '../engines/api/types';
import { PROVIDER_COPY, PROVIDER_ORDER } from './catalog';
import { candidates, localServers } from './servers';

/** Looking at the usual ports again, or the environment, more often than this is waste. */
const FRESH_MS = 30_000;

/** A key found in the environment, by the id the page uses for it. */
export interface FoundKey {
  provider: EngineId;
  variable: string;
}

const tail = (value: string) => value.slice(-4);

/** Keys in this computer's environment for providers that don't have one yet. */
export function environmentKeys(
  connected: ReadonlySet<EngineId>,
  env: NodeJS.ProcessEnv = process.env,
): (Found & { key: FoundKey })[] {
  const out: (Found & { key: FoundKey })[] = [];
  for (const id of PROVIDER_ORDER) {
    const copy = PROVIDER_COPY.get(id);
    if (!copy?.envKeys || copy.internal || connected.has(id)) continue;
    for (const variable of copy.envKeys) {
      const value = env[variable]?.trim();
      if (!value || value.length < 12 || /\s/.test(value)) continue;
      // A value that isn't shaped like this provider's key isn't offered as one.
      const pattern = copy.keyForm?.pattern;
      if (pattern && !new RegExp(pattern).test(value)) continue;
      out.push({
        id: `env-${id}-${variable.toLowerCase()}`,
        kind: 'key',
        provider: id,
        name: copy.name,
        detail: `${variable} · ends ${tail(value)}`,
        brand: id,
        ...(copy.color && { color: copy.color }),
        key: { provider: id, variable },
      });
      break;
    }
  }
  return out;
}

/** The value of a found key, read at the moment it's used — never kept, never sent anywhere else. */
export function foundKeyValue(key: FoundKey, env: NodeJS.ProcessEnv = process.env) {
  const copy = PROVIDER_COPY.get(key.provider);
  if (!copy?.envKeys?.includes(key.variable)) return undefined;
  return env[key.variable]?.trim() || undefined;
}

/** Same address, however it was typed. */
function sameServer(a: string, b: string): boolean {
  const norm = (url: string) => {
    try {
      const parsed = new URL(candidates(url)[0] ?? url);
      const host = parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname;
      return `${host}:${parsed.port}`;
    } catch {
      return url;
    }
  };
  return norm(a) === norm(b);
}

export class FoundThings {
  #servers?: { at: number; value: Promise<Found[]> };

  constructor(private readonly fetchImpl: FetchLike = globalThis.fetch) {}

  /** Model servers running here that you haven't added yet. */
  async servers(added: readonly ServerConfig[], force = false): Promise<Found[]> {
    if (force || !this.#servers || Date.now() - this.#servers.at > FRESH_MS)
      this.#servers = {
        at: Date.now(),
        value: localServers(this.fetchImpl).then((found) =>
          found.map(
            (server): Found => ({
              id: `server-port-${server.port}`,
              kind: 'server',
              name: server.kind ?? 'A model server',
              detail: `Running on this computer, port ${server.port} · ${server.models} model${server.models === 1 ? '' : 's'}`,
              url: server.url,
              brand: 'server',
            }),
          ),
        ),
      };
    const found = await this.#servers.value.catch(() => []);
    return found.filter((f) => !added.some((s) => f.url && sameServer(s.url, f.url)));
  }

  forget(): void {
    this.#servers = undefined;
  }
}
