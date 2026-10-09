import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

/**
 * The hello link and passkeys (ADR 0064, 0065), in a real Chrome against the
 * real gateway, with Chrome's virtual authenticator standing in for Touch ID
 * or Windows Hello.
 *
 * A new Conch is made someone's from the link `conch hello` prints: once with
 * a password (then a passkey is added in Settings, and signs in), once with
 * the passkey straight away. The browser is a browser, not a program on this
 * computer, so it sends no key of its own (ADR 0063).
 */
test.use({ extraHTTPHeaders: {} });
test.describe.configure({ mode: 'serial' });

const run = promisify(execFile);
const root = join(import.meta.dirname, '..');
const PASSWORD = 'seven lanterns over quiet harbours';

/** What `conch hello` and `conch reset` do to the gateway's home, from its own store. */
async function store(what: 'hello' | 'reset'): Promise<string> {
  const code = [
    "import { AccessStore } from './src/auth/store.ts';",
    'const store = new AccessStore(process.env.CONCH_HOME);',
    what === 'hello' ? 'console.log((await store.createHello()).code);' : 'await store.disable();',
  ].join('\n');
  const { stdout } = await run(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: join(root, 'apps/server'),
      env: { ...process.env, CONCH_HOME: process.env.CONCH_E2E_PASSKEYS_HOME },
    },
  );
  return stdout.trim();
}

/** Touch ID, as far as Chrome knows: a built-in authenticator that always recognises you. */
async function touchId(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/** The passkey button, named for whatever this machine has. */
const passkeyButton = (page: Page, verb: 'Use' | 'Sign in with') =>
  page.getByRole('button', {
    name: new RegExp(`^${verb} (Touch ID|Windows Hello|Face ID|your fingerprint|your phone)$`),
  });

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });

test.beforeAll(async ({ baseURL }) => {
  // Onboarding is another journey's: this one starts with Conch ready to chat.
  // As this computer: the project's cookie (ADR 0063), the only proof there is.
  const launcher = await playwrightRequest.newContext({
    baseURL,
    storageState: test.info().project.use.storageState,
  });
  const res = await launcher.patch('/api/settings', {
    data: { onboarded: true, profile: { name: 'Ada' } },
  });
  expect(res.status()).toBe(200);
  await launcher.dispose();
});

test('the hello link makes Conch yours with a password; a passkey added later signs in', async ({
  page,
}) => {
  await touchId(page);
  const code = await store('hello');
  await page.goto(`/#hello=${code}`);
  await expect(page.getByRole('heading', { name: 'Make Conch yours' })).toBeVisible();
  // The code never stays in the address bar.
  expect(page.url()).not.toContain(code);

  const instead = page.getByRole('button', { name: 'Choose a password instead' });
  if (await instead.isVisible()) await instead.click();
  const form = page.getByRole('form', { name: 'Choose a password' });
  await form.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await form.getByRole('button', { name: 'Make it mine' }).click();
  await expect(page.getByRole('heading', { name: 'It’s yours' })).toBeVisible();
  await expect(composer(page)).toBeVisible({ timeout: 10_000 });

  // The link is spent: whoever opens it next is too late.
  const again = await page.request.post('/api/auth/hello', { data: { code } });
  expect(await again.json()).toMatchObject({ ok: false, reason: 'claimed' });

  // Settings → Access → Passkeys: add this device's own.
  await page.goto('/settings/access');
  const add = page.getByRole('button', {
    name: /^Add (Touch ID|Windows Hello|Face ID|your fingerprint|a passkey from your phone)$/,
  });
  await add.click();
  const list = page.getByRole('list', { name: 'Passkeys' });
  await expect(list.getByRole('listitem')).toHaveCount(1);

  // Signed out, the passkey is the way back in. The username field offers it as it's
  // filled (conditional UI), which Chrome's pretend authenticator answers by itself; otherwise
  // it's the button.
  await page.request.post('/api/auth/sign-out');
  await page.goto('/');
  const button = passkeyButton(page, 'Sign in with');
  await expect(composer(page).or(button)).toBeVisible();
  if (await button.isVisible()) await button.click({ timeout: 5_000 }).catch(() => undefined);
  await expect(composer(page)).toBeVisible({ timeout: 10_000 });
  expect((await (await page.request.get('/api/auth')).json()).signedIn).toBe(true);
});

test('the hello link makes Conch yours with the passkey itself, and nothing to type', async ({
  page,
}) => {
  await store('reset');
  await touchId(page);
  const code = await store('hello');
  await page.goto(`/#hello=${code}`);
  await expect(page.getByRole('heading', { name: 'Make Conch yours' })).toBeVisible();
  const toPasskey = page.getByRole('button', { name: 'Use your phone instead' });
  if (await toPasskey.isVisible()) await toPasskey.click();
  await passkeyButton(page, 'Use').click();
  await expect(page.getByRole('heading', { name: 'It’s yours' })).toBeVisible();
  await expect(composer(page)).toBeVisible({ timeout: 10_000 });

  // Passkeys are the only way in now: the sign-in page has no password box.
  await page.request.post('/api/auth/sign-out');
  await page.goto('/');
  await expect(passkeyButton(page, 'Sign in with')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await passkeyButton(page, 'Sign in with').click();
  await expect(composer(page)).toBeVisible({ timeout: 10_000 });
});
