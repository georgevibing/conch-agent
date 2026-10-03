import { PasskeyAssertion, PasskeyRegistration, type PasskeyOptionsBody } from '@conch/protocol';
import {
  WebAuthnAbortService,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

import { api } from '../../api/client';

/**
 * Passkeys on this browser (ADR 0065): what it can do, and the two things
 * it does. `@simplewebauthn/browser` speaks to `navigator.credentials`; the
 * gateway checks every byte.
 */

/** What this browser can do with passkeys here. */
export interface PasskeySupport {
  /** WebAuthn works at this address (a secure context, a browser that has it). */
  supported: boolean;
  /** A built-in authenticator: Touch ID, Windows Hello, Face ID, a fingerprint. */
  platform: boolean;
  /** The password field can offer passkeys as it's filled (conditional UI). */
  autofill: boolean;
}

let support: Promise<PasskeySupport> | undefined;

/** Asked once per page: the answers don't change while it's open. */
export function passkeySupport(): Promise<PasskeySupport> {
  support ??= (async () => {
    if (typeof window === 'undefined' || !window.isSecureContext || !browserSupportsWebAuthn())
      return { supported: false, platform: false, autofill: false };
    const [platform, autofill] = await Promise.all([
      platformAuthenticatorIsAvailable().catch(() => false),
      browserSupportsWebAuthnAutofill().catch(() => false),
    ]);
    return { supported: true, platform, autofill };
  })();
  return support;
}

/** For tests: forget what was found. */
export function forgetPasskeySupport() {
  support = undefined;
}

/**
 * The person closed the prompt, or it timed out: nothing to say about it.
 * (`NotAllowedError` is also what a refused or slow touch looks like.)
 */
export function passkeyCancelled(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  const cause = (error as { cause?: { name?: string } } | undefined)?.cause?.name;
  return [name, cause].some((n) => n === 'NotAllowedError' || n === 'AbortError');
}

/** What went wrong with a passkey, in words, or nothing when it was only cancelled. */
export function passkeyProblem(error: unknown): string | undefined {
  if (passkeyCancelled(error)) return undefined;
  const code = (error as { code?: string } | undefined)?.code;
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')
    return 'This device already has a passkey for Conch here. Use it to sign in.';
  if (code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID')
    return 'Passkeys need Conch’s secure address. Open it at its https:// address and try again.';
  return (error as Error | undefined)?.message || 'That didn’t work. Try again.';
}

/** Make a passkey: adding one in Settings, or making Conch yours from the hello link. */
export async function createPasskey(
  body: Extract<PasskeyOptionsBody, { purpose: 'add' | 'hello' }>,
): Promise<PasskeyRegistration> {
  const { options } = await api.passkeyOptions(body);
  const response = await startRegistration({ optionsJSON: options as never });
  return PasskeyRegistration.parse(response);
}

/**
 * Use a passkey: to sign in, or to confirm it's you. With `autofill`, the
 * browser offers passkeys in the sign-in form as it's filled, and this waits
 * (until the person picks one, or `cancelPasskey()`).
 */
export async function askPasskey(
  purpose: 'sign-in' | 'verify',
  { autofill = false }: { autofill?: boolean } = {},
): Promise<PasskeyAssertion> {
  const { options } = await api.passkeyOptions({ purpose });
  const response = await startAuthentication({
    optionsJSON: options as never,
    useBrowserAutofill: autofill,
  });
  return PasskeyAssertion.parse(response);
}

/** Stop a passkey prompt that's waiting (the autofill one, when a page goes away). */
export function cancelPasskey() {
  WebAuthnAbortService.cancelCeremony();
}
