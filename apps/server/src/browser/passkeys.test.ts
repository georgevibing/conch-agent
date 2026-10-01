import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

import { type Browser, chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fromCdp, toCdp, toPasskey } from '../vault/passkeys';
import { findBrowsers } from './locate';
import { armCreate, armSignIn, isArmed, type WebAuthnCredential } from './passkeys';

const executable =
  findBrowsers({ downloaded: () => chromium.executablePath() })[0]?.path ??
  (existsSync(chromium.executablePath()) ? chromium.executablePath() : undefined);

/** A site that makes a passkey and signs in with one, as real sites do. */
const PAGE = `<!doctype html><title>Passkeys</title><script>
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
window.makePasskey = async () => {
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { id: 'localhost', name: 'Test' },
    user: { id: new TextEncoder().encode('user-1'), name: 'ada@example.com', displayName: 'Ada' },
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: 10000,
  }});
  return b64(cred.rawId);
};
window.signIn = async () => {
  const cred = await navigator.credentials.get({ publicKey: {
    rpId: 'localhost',
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    userVerification: 'required',
    timeout: 10000,
  }});
  return b64(cred.rawId);
};
</script>`;

let server: Server;
let origin = '';
let browser: Browser | undefined;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  // `localhost` is a secure context, so WebAuthn works over http here.
  origin = `http://localhost:${address.port}`;
  if (executable) browser = await chromium.launch({ executablePath: executable, headless: true });
});

afterAll(async () => {
  await browser?.close();
  server.close();
});

describe.skipIf(!executable)('passkeys in Conch’s browser, for real', () => {
  it('saves a passkey a site makes, then signs in with it, only while armed', async () => {
    if (!browser) throw new Error('no browser');
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin);

    let made: WebAuthnCredential | undefined;
    await armCreate(page, (credential) => (made = credential));
    expect(isArmed(page)).toBe(true);
    const createdId = await page.evaluate(() =>
      (globalThis as unknown as { makePasskey(): Promise<string> }).makePasskey(),
    );
    await expect.poll(() => made).toBeTruthy();
    // Taken out of the browser as soon as it's saved.
    await expect.poll(() => isArmed(page)).toBe(false);
    const input = made && fromCdp(made);
    expect(input?.rpId).toBe('localhost');
    const passkey = input && toPasskey(input);
    expect(passkey).toBeTruthy();
    if (!passkey) return;
    expect(Buffer.from(passkey.credentialId, 'base64url').toString('base64')).toBe(createdId);

    // A fresh page, as a later sign-in would be: armed with the saved passkey.
    const later = await context.newPage();
    await later.goto(origin);
    let counter: number | undefined;
    await armSignIn(later, toCdp(passkey), (signCount) => (counter = signCount));
    const signedInWith = await later.evaluate(() =>
      (globalThis as unknown as { signIn(): Promise<string> }).signIn(),
    );
    expect(signedInWith).toBe(createdId);
    await expect.poll(() => counter).toBeGreaterThan(passkey.signCount);
    await expect.poll(() => isArmed(later)).toBe(false);
    await context.close();
  });
});
