import { isIP } from 'node:net';

import type { PasskeyAssertion, PasskeyPurpose, PasskeyRegistration } from '@conch/protocol';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { FastifyRequest } from 'fastify';

import { authenticatorName } from './aaguids';
import { isLoopbackAddress, isLoopbackHost } from './network';
import { hashToken, randomToken, safeEqual } from './secrets';
import type { AccessStore, PasskeyRecord } from './store';

/** A challenge is answered within five minutes, once. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** At most this many of one kind wait at once; the oldest go first. Nobody can fill the gateway's memory. */
const MAX_CHALLENGES = 100;
/** How long the browser's own prompt waits for a touch. */
const PROMPT_MS = 2 * 60 * 1000;
/**
 * At most this many public challenges (signing in, the hello link) per client at once:
 * one person's tabs, never a flood that pushes everyone else's out.
 */
const PER_CLIENT = 5;

/** Where a passkey ceremony happens: the address the page is open at. */
export interface PasskeyPlace {
  /** The relying party: the hostname, never with a port. */
  rpId: string;
  /** Exactly what the browser will put in `clientDataJSON.origin`. */
  origin: string;
}

/**
 * Passkeys need a name (not an IP address) and a secure context: HTTPS, or
 * `localhost`. Browsers refuse them anywhere else, so Conch doesn't offer them.
 */
export function passkeyPlace(request: FastifyRequest): PasskeyPlace | undefined {
  const host = request.headers.host;
  if (!host) return undefined;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (isIP(hostname.replace(/^\[|\]$/g, ''))) return undefined;
  const https =
    request.protocol === 'https' ||
    (isLoopbackAddress(request.socket.remoteAddress) &&
      request.headers['x-forwarded-proto'] === 'https');
  if (!https && !isLoopbackHost(hostname)) return undefined;
  return { rpId: hostname, origin: `${https ? 'https' : 'http'}://${host.toLowerCase()}` };
}

/** What a challenge was made for. It can only be answered for exactly that. */
interface Binding {
  purpose: PasskeyPurpose;
  rpId: string;
  /** The signed-in session that asked (adding one, confirming it's you). */
  sessionId?: string;
  /** The hello link's code, hashed, that asked (ADR 0064). */
  hello?: string;
  /** For a hello: the user handle the new passkey is made for. */
  ownerId?: string;
  /** Who asked, for the public ones (`Gatekeeper.clientKey`). */
  client?: string;
  expiresAt: number;
}

/** A passkey that wasn’t accepted, in words a person can act on. */
export class PasskeyError extends Error {}

const NOT_ACCEPTED =
  'That passkey wasn’t accepted. Try again, or use your password if you have one.';
const STALE = 'That took a little too long. Try again.';

/** The challenge a WebAuthn response answers, read from its client data. */
function challengeOf(clientDataJSON: string): string | undefined {
  try {
    const data = JSON.parse(isoBase64URL.toUTF8String(clientDataJSON)) as { challenge?: unknown };
    return typeof data.challenge === 'string' ? data.challenge : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Registering and using passkeys (ADR 0065), with `@simplewebauthn/server`
 * doing every check on the bytes. This class only decides what is asked,
 * remembers the challenges it gave out, and keeps what was proven.
 */
export class PasskeyCeremonies {
  /** One pool per purpose: a flood of sign-in challenges can't push out a hello or a confirmation. */
  readonly #pools = new Map<PasskeyPurpose, Map<string, Binding>>();

  #pool(purpose: PasskeyPurpose): Map<string, Binding> {
    let pool = this.#pools.get(purpose);
    if (!pool) this.#pools.set(purpose, (pool = new Map()));
    return pool;
  }

  constructor(
    private readonly store: AccessStore,
    private readonly now: () => number = Date.now,
  ) {}

  #remember(challenge: string, binding: Omit<Binding, 'expiresAt'>) {
    const now = this.now();
    const pool = this.#pool(binding.purpose);
    for (const [key, value] of pool) if (value.expiresAt <= now) pool.delete(key);
    if (binding.client !== undefined) {
      const theirs = [...pool].filter(([, value]) => value.client === binding.client);
      while (theirs.length >= PER_CLIENT) {
        const [oldest] = theirs.shift() ?? [];
        if (oldest !== undefined) pool.delete(oldest);
      }
    }
    while (pool.size >= MAX_CHALLENGES) {
      const oldest = pool.keys().next().value;
      if (oldest === undefined) break;
      pool.delete(oldest);
    }
    pool.set(challenge, { ...binding, expiresAt: now + CHALLENGE_TTL_MS });
  }

  /** Used once, whatever happens next; only for what it was made for. */
  #take(
    clientDataJSON: string,
    want: { purpose: PasskeyPurpose; rpId: string; sessionId?: string; hello?: string },
  ): { challenge: string; binding: Binding } {
    const challenge = challengeOf(clientDataJSON);
    const pool = this.#pool(want.purpose);
    const binding = challenge === undefined ? undefined : pool.get(challenge);
    if (challenge === undefined || !binding) throw new PasskeyError(STALE);
    pool.delete(challenge);
    if (binding.expiresAt <= this.now()) throw new PasskeyError(STALE);
    const same = (a: string | undefined, b: string | undefined) =>
      a === undefined || b === undefined ? a === b : safeEqual(a, b);
    if (
      binding.purpose !== want.purpose ||
      binding.rpId !== want.rpId ||
      !same(binding.sessionId, want.sessionId) ||
      !same(binding.hello, want.hello)
    )
      throw new PasskeyError(NOT_ACCEPTED);
    return { challenge, binding };
  }

  /**
   * Options to make a passkey: for a signed-in person adding one (`add`), or
   * for the hello link making Conch someone's (`hello`), which gets a fresh
   * user handle kept until the passkey is made.
   */
  async registrationOptions(input: {
    place: PasskeyPlace;
    purpose: 'add' | 'hello';
    sessionId?: string;
    helloCode?: string;
    userName: string;
    client?: string;
  }): Promise<Record<string, unknown>> {
    const ownerId = input.purpose === 'hello' ? randomToken(16) : await this.store.ownerHandle();
    const existing = (await this.store.passkeyRecords()).filter((p) => p.rpId === input.place.rpId);
    const options = await generateRegistrationOptions({
      rpName: 'Conch',
      rpID: input.place.rpId,
      userName: input.userName || 'Conch',
      userDisplayName: `Conch on ${input.place.rpId}`,
      userID: isoBase64URL.toBuffer(ownerId),
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({
        id: p.id,
        ...(p.transports && { transports: p.transports }),
      })),
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      timeout: PROMPT_MS,
    });
    this.#remember(options.challenge, {
      purpose: input.purpose,
      rpId: input.place.rpId,
      ...(input.sessionId && { sessionId: input.sessionId }),
      ...(input.helloCode && { hello: hashToken(input.helloCode.trim()) }),
      ...(input.purpose === 'hello' && { ownerId }),
      ...(input.client !== undefined && { client: input.client }),
    });
    return options as unknown as Record<string, unknown>;
  }

  /** Check a new passkey. Returns what to keep; nothing is saved here. */
  async verifyRegistration(input: {
    response: PasskeyRegistration;
    place: PasskeyPlace;
    purpose: 'add' | 'hello';
    sessionId?: string;
    helloCode?: string;
    /** "Chrome on Windows": names a passkey whose maker the list doesn't know. */
    deviceName: string;
  }): Promise<{ passkey: PasskeyRecord; ownerId?: string }> {
    const { challenge, binding } = this.#take(input.response.response.clientDataJSON, {
      purpose: input.purpose,
      rpId: input.place.rpId,
      ...(input.sessionId && { sessionId: input.sessionId }),
      ...(input.helloCode && { hello: hashToken(input.helloCode.trim()) }),
    });
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: challenge,
        expectedOrigin: input.place.origin,
        expectedRPID: input.place.rpId,
        requireUserVerification: true,
      });
    } catch {
      throw new PasskeyError(NOT_ACCEPTED);
    }
    if (!verified.verified) throw new PasskeyError(NOT_ACCEPTED);
    const info = verified.registrationInfo;
    const now = this.now();
    return {
      passkey: {
        id: info.credential.id,
        publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
        counter: info.credential.counter,
        ...(info.credential.transports?.length && {
          transports: [...info.credential.transports],
        }),
        rpId: input.place.rpId,
        name: authenticatorName(info.aaguid) ?? `Passkey on ${input.deviceName}`,
        ...(info.aaguid && { aaguid: info.aaguid }),
        synced: info.credentialBackedUp,
        createdAt: now,
      },
      ...(binding.ownerId && { ownerId: binding.ownerId }),
    };
  }

  /**
   * Options to use a passkey. Signing in lists none (the browser offers the
   * passkeys it has for this address); confirming it's you lists this
   * address's own, so another account's can't answer.
   */
  async authenticationOptions(input: {
    place: PasskeyPlace;
    purpose: 'sign-in' | 'verify';
    sessionId?: string;
    client?: string;
  }): Promise<Record<string, unknown>> {
    const mine = (await this.store.passkeyRecords()).filter((p) => p.rpId === input.place.rpId);
    const options = await generateAuthenticationOptions({
      rpID: input.place.rpId,
      userVerification: 'required',
      timeout: PROMPT_MS,
      ...(input.purpose === 'verify' && {
        allowCredentials: mine.map((p) => ({
          id: p.id,
          ...(p.transports && { transports: p.transports }),
        })),
      }),
    });
    this.#remember(options.challenge, {
      purpose: input.purpose,
      rpId: input.place.rpId,
      ...(input.sessionId && { sessionId: input.sessionId }),
      ...(input.client !== undefined && { client: input.client }),
    });
    return options as unknown as Record<string, unknown>;
  }

  /** Check a passkey's answer. Returns the passkey it was, with its counter moved on. */
  async verifyAuthentication(input: {
    response: PasskeyAssertion;
    place: PasskeyPlace;
    purpose: 'sign-in' | 'verify';
    sessionId?: string;
  }): Promise<PasskeyRecord> {
    const { challenge } = this.#take(input.response.response.clientDataJSON, {
      purpose: input.purpose,
      rpId: input.place.rpId,
      ...(input.sessionId && { sessionId: input.sessionId }),
    });
    const passkey = (await this.store.passkeyRecords()).find(
      (p) => p.id === input.response.id && p.rpId === input.place.rpId,
    );
    if (!passkey) throw new PasskeyError(NOT_ACCEPTED);
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: challenge,
        expectedOrigin: input.place.origin,
        expectedRPID: input.place.rpId,
        credential: {
          id: passkey.id,
          publicKey: isoBase64URL.toBuffer(passkey.publicKey),
          counter: passkey.counter,
          ...(passkey.transports && {
            transports: passkey.transports as NonNullable<
              Parameters<typeof verifyAuthenticationResponse>[0]['credential']['transports']
            >,
          }),
        },
        requireUserVerification: true,
      });
    } catch {
      // A counter that went backwards lands here too: a copied authenticator.
      throw new PasskeyError(NOT_ACCEPTED);
    }
    if (!verified.verified) throw new PasskeyError(NOT_ACCEPTED);
    const counter = verified.authenticationInfo.newCounter;
    await this.store.usedPasskey(passkey.id, counter);
    return { ...passkey, counter, lastUsedAt: this.now() };
  }
}
