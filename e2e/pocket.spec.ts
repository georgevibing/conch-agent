import { expect, test } from '@playwright/test';

import { openConch } from './app';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Conch in your pocket, end to end (ADR 0027): the installable app, the calm
 * screen when Conch can't be reached, the phone's secure address with one
 * press (the mock engine's pretend Tailscale), notifications and voice.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('Conch installs as an app, with its own icon', async ({ request }) => {
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
    name: string;
    display: string;
    icons: { src: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({ name: 'Conch', display: 'standalone' });
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBe(true);
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).toContain('notificationclick');
});

test('when Conch can’t be reached, the app says so calmly and comes back by itself', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first load registered it; the next one is under its care.
  await page.reload();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload().catch(() => undefined);
  await expect(
    page.getByRole('heading', { name: 'Conch can’t be reached right now' }),
  ).toBeVisible();
  await expect(
    page.getByText('The computer Conch runs on is asleep, off or offline.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try now' })).toBeVisible();
  // Back online: it notices by itself and turns back into Conch.
  await context.setOffline(false);
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toBeVisible({
    timeout: 15_000,
  });
});

test('notifications and voice have their own place in Settings', async ({ page }) => {
  await openConch(page);
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('notifications');
  await page.getByRole('option', { name: /Settings: Notifications/ }).click();
  const settings = page.getByRole('dialog', { name: /Settings/ });
  await expect(
    settings.getByRole('region', { name: 'Get notifications on this device' }),
  ).toBeVisible();
  await expect(
    settings.getByRole('switch', { name: 'Notifications on this device' }),
  ).toBeVisible();
  await expect(settings.getByText('No device gets notifications yet.')).toBeVisible();

  await settings.getByRole('tab', { name: 'Voice' }).click();
  await expect(settings.getByRole('radiogroup', { name: 'How Conch hears you' })).toBeVisible();
  await expect(settings.getByRole('list', { name: 'What private dictation needs' })).toContainText(
    'whisper.cpp',
  );
  await page.keyboard.press('Escape');

  // The composer has dictation, and talking hands free.
  await expect(page.getByRole('button', { name: 'Dictate' })).toBeVisible();
  await page.getByRole('button', { name: 'Talk with Conch' }).click();
  const talk = page.getByRole('dialog', { name: 'Talking with Conch' });
  await expect(talk).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(talk).toBeHidden();
});

test('tapping the message box on a phone doesn’t zoom the page', async ({ browser }, info) => {
  // A phone zooms into any field typed in under 16px, and stays zoomed.
  const phone = await browser.newContext({
    baseURL: info.project.use.baseURL,
    storageState: info.project.use.storageState,
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await phone.newPage();
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.tap();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveCSS('font-size', '16px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await phone.close();
});

// Last: it turns sign-in on, which the others don't expect.
test('a secure address for your phone, in one press, then its sign-in code', async ({ page }) => {
  await openConch(page);
  // No sign-in yet: a phone signs in with a password, so that comes first.
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('add phone');
  await page.getByRole('option', { name: /Add your phone/ }).click();
  await expect(page.getByText(/Your phone signs in with a password/)).toBeVisible();
  const settings = page.getByRole('dialog', { name: /Settings/ });
  await settings.locator('input[name="new-password"]').fill('a long enough sentence for conch');
  await settings.getByRole('button', { name: 'Turn on password sign-in' }).click();

  // Then Add a device opens by itself, with what the phone needs.
  const dialog = page.getByRole('dialog', { name: 'Add a device' });
  const steps = dialog.getByRole('list', { name: 'What your phone needs to reach Conch' });
  await expect(steps).toContainText('Tailscale on this computer');
  await expect(steps).toContainText('conch-studio.tail1234.ts.net');
  await steps.getByRole('button', { name: 'Turn on' }).click();
  // On: the code for the phone, at the secure address.
  await expect(dialog.getByRole('img', { name: 'Sign-in code for your phone' })).toBeVisible();
  await expect(
    dialog.getByText(/https:\/\/conch-studio\.tail1234\.ts\.net\/#pair=…/),
  ).toBeVisible();
  await expect(dialog.getByText('This address isn’t encrypted')).toHaveCount(0);
});
