/**
 * One-click keys.
 *
 * Some providers will mint a key for you if you sign in, so nobody has to copy
 * one out of a dashboard. OpenRouter does this with PKCE and no client secret,
 * which is exactly what a self-hosted app needs: there's no secret we could
 * ship safely anyway.
 *
 * OpenRouter's flow has no `state` parameter, so the flow id lives in the
 * callback path instead and does the same job: 256 random bits, held only in
 * memory, single use, ten minutes. Without it a code is worthless, and the code
 * itself is also single use and bound to our PKCE verifier.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { EngineId } from '@conch/protocol';
import { z } from 'zod';

/** Long enough for a person to sign in, short enough that a leaked id is useless. */
const FLOW_TTL_MS = 10 * 60_000;
const EXCHANGE_TIMEOUT_MS = 20_000;

export type SignInDisplay = 'popup' | 'tab';

export class SignInError extends Error {}

interface Flow {
  providerId: EngineId;
  verifier: string;
  display: SignInDisplay;
  startedAt: number;
}

/** Where a provider sends the browser, and where it exchanges the code. */
interface SignInProvider {
  authorizeUrl: string;
  tokenUrl: string;
  /** The label the provider puts on the key it makes. */
  keyLabel: string;
}

const PROVIDERS: Partial<Record<EngineId, SignInProvider>> = {
  openrouter: {
    authorizeUrl: 'https://openrouter.ai/auth',
    tokenUrl: 'https://openrouter.ai/api/v1/auth/keys',
    keyLabel: 'Conch',
  },
};

/** OpenRouter answers with the key it just made. Anything else is a failure. */
const KeyResponse = z.object({ key: z.string().min(8).max(4096) });

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

export function canSignIn(id: EngineId): boolean {
  return id in PROVIDERS;
}

export class ProviderSignIns {
  #flows = new Map<string, Flow>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /**
   * Begin a sign-in. Returns the page to open and the flow id, which is already
   * part of the callback address the provider was told to come back to.
   */
  start(input: {
    providerId: EngineId;
    /** Conch's own origin, as the browser reached it. */
    origin: string;
    display: SignInDisplay;
  }): { authorizeUrl: string; flowId: string } {
    const provider = PROVIDERS[input.providerId];
    if (!provider) throw new SignInError('This provider can’t make a key for you.');
    this.#sweep();

    const flowId = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());

    const url = new URL(provider.authorizeUrl);
    url.searchParams.set('callback_url', `${input.origin}/oauth/provider/${flowId}`);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('key_label', provider.keyLabel);

    this.#flows.set(flowId, {
      providerId: input.providerId,
      verifier,
      display: input.display,
      startedAt: Date.now(),
    });
    return { authorizeUrl: url.toString(), flowId };
  }

  /** What a pending flow is for, without spending it (the callback needs this to redirect). */
  peek(flowId: string): { providerId: EngineId; display: SignInDisplay } | undefined {
    const flow = this.#find(flowId);
    return flow && { providerId: flow.providerId, display: flow.display };
  }

  cancel(flowId: string) {
    this.#flows.delete(flowId);
  }

  /**
   * Spend the code for a key. The flow is consumed first, so a replayed
   * callback can never start a second exchange.
   */
  async finish(
    flowId: string,
    code: string,
  ): Promise<{ providerId: EngineId; display: SignInDisplay; key: string }> {
    const flow = this.#find(flowId);
    if (!flow) throw new SignInError('That sign-in took too long. Start again from Conch.');
    this.#flows.delete(flowId);
    const provider = PROVIDERS[flow.providerId];
    if (!provider) throw new SignInError('This provider can’t make a key for you.');

    // A fixed https address we chose ourselves: no user input reaches it, so
    // there's nothing here for the SSRF guard to protect.
    let response: Response;
    try {
      response = await this.fetchImpl(provider.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: flow.verifier,
          code_challenge_method: 'S256',
        }),
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new SignInError('Couldn’t reach the provider to finish signing in.');
    }

    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new SignInError(
        response.status === 403
          ? 'That sign-in expired or was already used. Start again from Conch.'
          : 'The provider refused to finish signing in.',
      );
    }
    const parsed = KeyResponse.safeParse(body);
    if (!parsed.success) throw new SignInError('The provider didn’t send a key back.');
    return { providerId: flow.providerId, display: flow.display, key: parsed.data.key };
  }

  /** Constant-time lookup, so the id can't be guessed a character at a time. */
  #find(flowId: string): Flow | undefined {
    const wanted = Buffer.from(flowId);
    for (const [id, flow] of this.#flows) {
      const candidate = Buffer.from(id);
      if (candidate.length === wanted.length && timingSafeEqual(candidate, wanted)) {
        return Date.now() - flow.startedAt > FLOW_TTL_MS ? undefined : flow;
      }
    }
    return undefined;
  }

  #sweep() {
    const now = Date.now();
    for (const [id, flow] of this.#flows) {
      if (now - flow.startedAt > FLOW_TTL_MS) this.#flows.delete(id);
    }
  }
}
