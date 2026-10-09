import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Approve new devices, end to end: this computer turns it on; a phone and a
 * laptop sign in "from elsewhere" (through a pretend proxy, as with
 * `tailscale serve`) with the right password and wait; one is approved in
 * Settings here, one with `pnpm conch devices approve` in the terminal, one is
 * turned down; and removing a device sends it back to the start.
 */

const run = promisify(execFile);
const root = join(import.meta.dirname, '..');
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const PASSWORD = 'seven lanterns over quiet harbours';

/** `pnpm conch …` on the computer running this journey's gateway. */
async function conch(...args: string[]) {
  const { stdout } = await run(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: join(root, 'apps/server'),
    env: { ...process.env, CONCH_HOME: process.env.CONCH_E2E_DEVICES_HOME, FORCE_COLOR: '0' },
  });
  return stdout;
}

async function shot(page: Page, name: string) {
  const dir = process.env.CONCH_SHOTS ?? test.info().outputDir;
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(dir, name) });
  if (process.env.CONCH_SHOTS) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(dir, name.replace('.png', '-dark.png')) });
    await page.emulateMedia({ colorScheme: 'light' });
  }
}

/** A device somewhere else: its requests arrive through a proxy on this computer. */
async function elsewhere(browser: Browser, baseURL: string, address: string, phone = false) {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': address },
    ...(phone && {
      userAgent: IPHONE,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    }),
  });
  return { context, page: await context.newPage() };
}

async function signIn(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Username').fill('ada');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function codeOn(page: Page) {
  const group = page.getByRole('group', { name: /^Approval code/ });
  await expect(group).toBeVisible();
  const label = (await group.getAttribute('aria-label')) ?? '';
  return label.replace('Approval code ', '').replaceAll(' ', '');
}

/** In, and the app is open: the composer is there (on a phone, Settings is in the sidebar). */
async function inApp(page: Page) {
  await expect(page.getByRole('textbox', { name: /^Message/ })).toBeVisible();
}

async function openDevices(page: Page) {
  await inApp(page);
  const settings = page.getByRole('button', { name: 'Settings' });
  if (!(await settings.isVisible()))
    await page.getByRole('button', { name: 'Open conversations' }).click();
  await settings.click();
  await page.getByRole('tab', { name: 'Access' }).click();
  await page.getByRole('heading', { name: 'Devices' }).scrollIntoViewIfNeeded();
}

test('a new device waits after the right password until it’s approved', async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });

  // ── This computer: a password, then "Approve new devices".
  await page.goto('/');
  const res = await page.request.put('/api/access/password', {
    data: { username: 'ada', password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
  await page.reload();
  await openDevices(page);
  const toggle = page.getByRole('switch', { name: 'Approve new devices' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByText('New devices now need your approval')).toBeVisible();

  // ── A phone, elsewhere: the right password isn't enough on its own.
  const phone = await elsewhere(browser, baseURL ?? '', '100.64.0.7', true);
  await signIn(phone.page);
  await expect(phone.page.getByRole('heading', { name: 'Approve this device' })).toBeVisible();
  const phoneCode = await codeOn(phone.page);
  await expect(
    phone.page.getByText(`conch devices approve ${phoneCode}`, { exact: true }),
  ).toBeVisible();
  await shot(phone.page, 'devices-1-phone-waiting.png');
  // Waiting isn't signed in: the API still says no.
  expect((await phone.page.request.get('/api/state')).status()).toBe(401);

  // ── This computer hears about it at once, and sees the same code.
  await expect(page.getByText('A new device is asking to sign in')).toBeVisible();
  const waiting = page.getByRole('list', { name: 'Waiting for your approval' });
  await expect(waiting).toContainText('Safari on iPhone');
  await expect(waiting).toContainText(phoneCode);
  await expect(waiting).toContainText('100.64.0.7');
  await shot(page, 'devices-2-request-here.png');
  await waiting.getByRole('button', { name: new RegExp(`^Approve Safari on iPhone`) }).click();

  // The phone is let in where it waited, without signing in again.
  await inApp(phone.page);
  const list = page.getByRole('list', { name: 'Devices' });
  await expect(list).toContainText('Safari on iPhone');
  await expect(list).toContainText('approved in Settings');

  // ── A laptop, elsewhere: approved in the terminal instead.
  const laptop = await elsewhere(browser, baseURL ?? '', '100.64.0.9');
  await signIn(laptop.page);
  const laptopCode = await codeOn(laptop.page);
  const listing = await conch('devices');
  expect(listing).toContain('Knocking at the door (1)');
  expect(listing).toContain(laptopCode.replace(/^(...)(...)$/, '$1-$2'));
  expect(listing).toContain('from 100.64.0.9');
  const approved = await conch('devices', 'approve', laptopCode.toLowerCase());
  expect(approved).toMatch(/Chrome on \w+ is in\./);
  await inApp(laptop.page);

  // ── On the phone, Settings shows the devices, but approval can only be turned off here.
  await openDevices(phone.page);
  const remoteToggle = phone.page.getByRole('switch', { name: 'Approve new devices' });
  await expect(remoteToggle).toBeChecked();
  await expect(remoteToggle).toBeDisabled();
  await expect(phone.page.getByText('conch devices off', { exact: true })).toBeVisible();
  await shot(phone.page, 'devices-3-phone-settings.png');

  // ── Someone else with the password: turned down in the terminal, and told so.
  const stranger = await elsewhere(browser, baseURL ?? '', '203.0.113.50');
  await signIn(stranger.page);
  const strangerCode = await codeOn(stranger.page);
  const rejected = await conch('devices', 'reject', strangerCode);
  expect(rejected).toContain('Turned down');
  expect(rejected).toContain('someone knows your password');
  await expect(
    stranger.page.getByRole('heading', { name: 'This device wasn’t approved' }),
  ).toBeVisible();
  await shot(stranger.page, 'devices-4-rejected.png');
  expect((await stranger.page.request.get('/api/state')).status()).toBe(401);

  // ── Removing the laptop here sends it back to the start, and it must ask again.
  await page.reload();
  // Settings has an address, so a reload lands back in Access.
  await expect(page.getByRole('tab', { name: 'Access', selected: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Devices' }).scrollIntoViewIfNeeded();
  await shot(page, 'devices-5-devices.png');
  const laptopRow = page
    .getByRole('list', { name: 'Devices' })
    .getByRole('listitem')
    .filter({ hasText: '100.64.0.9' });
  await laptopRow.getByRole('button', { name: /^Remove/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(laptop.page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await signIn(laptop.page);
  await expect(laptop.page.getByRole('heading', { name: 'Approve this device' })).toBeVisible();

  // ── The phone signs out and back in: it's remembered, so no approval this time.
  await phone.page.reload();
  await phone.page.request.post('/api/auth/sign-out');
  await signIn(phone.page);
  await inApp(phone.page);

  await Promise.all([phone.context.close(), laptop.context.close(), stranger.context.close()]);
});
