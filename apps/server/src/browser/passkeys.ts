/**
 * Passkeys in Conch's browser (ADR 0025 § Passkeys), through Chrome's
 * WebAuthn virtual authenticator (DevTools Protocol, `WebAuthn.*`).
 *
 * A page only has an authenticator while it's armed for one thing, and for
 * three minutes at most:
 * - **sign in:** one saved passkey is put in it, for its own site, after the
 *   person agreed; the site's next passkey request is answered with it, and
 *   it's taken out again;
 * - **save:** the site's next "create a passkey" is answered, and the new
 *   passkey goes straight into Passwords.
 * The browser itself checks the site against the passkey's site (WebAuthn's
 * rpId rule); Conch checks too, before anything is put in.
 */
import type { CDPSession, Page } from 'playwright-core';

/** Chrome's `WebAuthn.Credential`: binary as standard base64. */
export interface WebAuthnCredential {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  privateKey: string;
  userHandle?: string;
  signCount: number;
  userName?: string;
}

const ARMED_MS = 3 * 60_000;

interface Armed {
  session: CDPSession;
  authenticatorId: string;
  timer: NodeJS.Timeout;
  off: () => void;
}

const armed = new WeakMap<Page, Armed>();

async function open(page: Page): Promise<Armed> {
  await disarm(page);
  const session = await page.context().newCDPSession(page);
  await session.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      // The person already agreed in the chat: that's the user verification.
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const entry: Armed = {
    session,
    authenticatorId,
    timer: setTimeout(() => void disarm(page), ARMED_MS),
    off: () => undefined,
  };
  entry.timer.unref?.();
  armed.set(page, entry);
  // Leaving for another site ends it.
  const host = hostname(page.url());
  const onNav = (frame: { parentFrame(): unknown; url(): string }) => {
    if (!frame.parentFrame() && hostname(frame.url()) !== host) void disarm(page);
  };
  page.on('framenavigated', onNav);
  page.once('close', () => void disarm(page));
  entry.off = () => page.off('framenavigated', onNav);
  return entry;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Take the authenticator (and anything in it) out of the page. */
export async function disarm(page: Page): Promise<void> {
  const entry = armed.get(page);
  if (!entry) return;
  armed.delete(page);
  clearTimeout(entry.timer);
  entry.off();
  await entry.session
    .send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: entry.authenticatorId })
    .catch(() => undefined);
  await entry.session.detach().catch(() => undefined);
}

export function isArmed(page: Page): boolean {
  return armed.has(page);
}

/**
 * Hold one passkey for the site's next sign-in. `used` gets the new counter
 * once the site accepted it; then the passkey is taken out.
 */
export async function armSignIn(
  page: Page,
  credential: WebAuthnCredential,
  used: (signCount: number) => void,
): Promise<void> {
  const entry = await open(page);
  await entry.session.send('WebAuthn.addCredential', {
    authenticatorId: entry.authenticatorId,
    credential,
  });
  entry.session.on('WebAuthn.credentialAsserted', (event) => {
    if (event.authenticatorId !== entry.authenticatorId) return;
    used(event.credential.signCount);
    void disarm(page);
  });
}

/**
 * Answer the site's next "create a passkey", and hand the new one over
 * (with its private key) before it's taken out of the browser.
 */
export async function armCreate(
  page: Page,
  created: (credential: WebAuthnCredential) => void,
): Promise<void> {
  const entry = await open(page);
  entry.session.on('WebAuthn.credentialAdded', (event) => {
    if (event.authenticatorId !== entry.authenticatorId) return;
    void (async () => {
      // The event may leave the key out; asking for the credential always has it.
      const full = await entry.session
        .send('WebAuthn.getCredential', {
          authenticatorId: entry.authenticatorId,
          credentialId: event.credential.credentialId,
        })
        .then((r) => r.credential)
        .catch(() => event.credential);
      created(full as WebAuthnCredential);
      await disarm(page);
    })();
  });
}
