import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * Sign-in end to end, in a real browser against the real gateway:
 * choose a password → another device must sign in → add a phone with a
 * one-time link → sign a device out remotely. Throughout, the strict
 * Content-Security-Policy must not block anything the app needs.
 */

/** Screenshots for visual review; set CONCH_SHOTS=<dir> to keep them. */
async function shot(page: Page, name: string, fullPage = false) {
  const dir = process.env.CONCH_SHOTS ?? test.info().outputDir;
  // Let entrance animations settle.
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(dir, name), fullPage });
  if (process.env.CONCH_SHOTS) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(dir, name.replace('.png', '-dark.png')), fullPage });
    await page.emulateMedia({ colorScheme: 'light' });
  }
}

function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

async function openSecurity(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Security' }).click();
}

test('password sign-in, pairing a phone, and signing a device out', async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  const csp = watchCsp(page);

  // ── This computer: no sign-in yet, so the app just opens.
  await page.goto('/');
  await openSecurity(page);
  await expect(page.getByText('No sign-in on this computer')).toBeVisible();
  await shot(page, 'security-1-setup.png', true);

  // Choose a password — let Conch suggest a strong one.
  const form = page.getByRole('form', { name: 'Choose a password' });
  await expect(form.getByLabel('Username')).not.toHaveValue('');
  await form.getByRole('button', { name: 'Suggest a strong one' }).click();
  const password = await form.getByLabel('Password', { exact: true }).inputValue();
  expect(password).toMatch(/^[a-z2-9]{6}-[a-z2-9]{6}-[a-z2-9]{6}$/);
  const username = await form.getByLabel('Username').inputValue();
  await shot(page, 'security-2-password.png', true);
  await form.getByRole('button', { name: 'Turn on password sign-in' }).click();
  await expect(page.getByText('Protected by your password')).toBeVisible();
  await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();

  // The API now refuses anyone without a session…
  expect((await request.get('/api/state')).status()).toBe(401);

  // ── Another device: has to sign in.
  const laptop = await browser.newContext({ baseURL });
  const other = await laptop.newPage();
  const otherCsp = watchCsp(other);
  await other.goto('/');
  await expect(other.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await shot(other, 'security-3-sign-in.png');
  await other.getByLabel('Username').fill(username);
  await other.getByLabel('Password', { exact: true }).fill('not the password at all');
  await other.getByRole('button', { name: 'Sign in' }).click();
  await expect(other.getByRole('alert')).toContainText('That didn’t work');
  await other.getByLabel('Password', { exact: true }).fill(password);
  await other.getByRole('button', { name: 'Sign in' }).click();
  await expect(other.getByRole('button', { name: 'Settings' })).toBeVisible();

  // ── A phone: signs in by opening a one-time link (the QR code's contents).
  await page.getByRole('button', { name: 'Add a device' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a device' });
  await expect(dialog.getByRole('img', { name: 'Sign-in code for your phone' })).toBeVisible();
  await shot(page, 'security-4-pair.png');
  await dialog.getByRole('button', { name: 'Done' }).click();
  const { code } = await (await page.request.post('/api/access/pairing')).json();
  const phoneContext = await browser.newContext({
    baseURL,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  });
  const phone = await phoneContext.newPage();
  await phone.goto(`/#pair=${code}`);
  await expect(phone.getByRole('button', { name: 'Settings' })).toBeVisible();
  expect(phone.url()).not.toContain('pair=');
  // The link only ever works once.
  const reused = await browser.newContext({ baseURL });
  const reusedPage = await reused.newPage();
  await reusedPage.goto(`/#pair=${code}`);
  await expect(reusedPage.getByText(/expired or was already used/)).toBeVisible();

  // ── Back on this computer: three devices, sign the laptop out.
  await page.reload();
  await openSecurity(page);
  const devices = page.getByRole('list', { name: 'Signed-in devices' });
  await expect(devices.getByRole('listitem')).toHaveCount(3);
  await expect(devices).toContainText('Safari on iPhone');
  await devices.scrollIntoViewIfNeeded();
  await shot(page, 'security-5-devices.png', true);
  const laptopRow = devices
    .getByRole('listitem')
    .filter({ hasText: 'Signed in with your password' })
    .filter({ hasNotText: 'This device' });
  await laptopRow.getByRole('button', { name: /^Sign out/ }).click();
  await expect(devices.getByRole('listitem')).toHaveCount(2);

  // The laptop is disconnected at once and shown the sign-in screen.
  await expect(other.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  expect(csp).toEqual([]);
  expect(otherCsp).toEqual([]);
  await Promise.all([laptop.close(), phoneContext.close(), reused.close()]);
});

test('sends strict security headers with the app', async ({ request }) => {
  const res = await request.get('/');
  const headers = res.headers();
  expect(headers['content-security-policy']).toContain("script-src 'self'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
});
