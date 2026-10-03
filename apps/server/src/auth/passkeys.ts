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
/** At most this many wait at once; the oldest go first. Nobody can fill the gateway's memory. */
const MAX_CHALLENGES = 100;
/** How long the browser's own prompt waits for a touch. */
const PROMPT_MS = 2 * 60 * 1000;

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
  readonly #challenges = new Map<string, Binding>();

  constructor(
    private readonly store: AccessStore,
    private readonly now: () => number = Date.now,
  ) {}

  #remember(challenge: string, binding: Omit<Binding, 'expiresAt'>) {
    const now = this.now();
    for (const [key, value] of this.#challenges)
      if (value.expiresAt <= now) this.#challenges.delete(key);
    while (this.#challenges.size >= MAX_CHALLENGES) {
      const oldest = this.#challenges.keys().next().value;
      if (oldest === undefined) break;
      this.#challenges.delete(oldest);
    }
    this.#challenges.set(challenge, { ...binding, expiresAt: now + CHALLENGE_TTL_MS });
  }

  /** Used once, whatever happens next; only for what it was made for. */
  #take(
    clientDataJSON: string,
    want: { purpose: PasskeyPurpose; rpId: string; sessionId?: string; hello?: string },
  ): { challenge: string; binding: Binding } {
    const challenge = challengeOf(clientDataJSON);
    const binding = challenge === undefined ? undefined : this.#challenges.get(challenge);
    if (challenge === undefined || !binding) throw new PasskeyError(STALE);
    this.#challenges.delete(challenge);
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
