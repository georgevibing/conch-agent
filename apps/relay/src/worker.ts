/**
 * The relay on Cloudflare Workers (ADR 0140), on the free plan: every request
 * goes to one Durable Object (SQLite-backed, which the free plan includes), so
 * the queue, the waiting long poll and the sender waiting for the gateway's
 * answer all live in one place. `wrangler.jsonc` binds it; set
 * `CONCH_RELAY_SETUP` to the setup code from Conch.
 *
 * The types below are the few Cloudflare ones this file uses, written out so
 * the relay needs no package for them.
 */
import { Relay } from './core.ts';
import { parseSetupCode } from './envelope.ts';
import { KeyValueStore, type KeyValue } from './store.ts';

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

interface DurableObjectState {
  storage: KeyValue;
}

export interface Env {
  CONCH_RELAY_SETUP?: string;
  RELAY: DurableObjectNamespace;
}

export class RelayObject {
  #relay?: Relay;

  readonly #state: DurableObjectState;
  readonly #env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.#state = state;
    this.#env = env;
  }

  fetch(request: Request): Promise<Response> {
    if (!this.#relay) {
      const code = this.#env.CONCH_RELAY_SETUP;
      if (!code)
        return Promise.resolve(
          new Response('Set CONCH_RELAY_SETUP to the setup code from Conch.', { status: 503 }),
        );
      this.#relay = new Relay(parseSetupCode(code), new KeyValueStore(this.#state.storage));
    }
    return this.#relay.fetch(request);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.RELAY.get(env.RELAY.idFromName('relay')).fetch(request);
  },
};
