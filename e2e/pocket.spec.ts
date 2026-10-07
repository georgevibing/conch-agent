import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

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
  const card = settings.getByRole('region', { name: 'Allow notifications' });
  await expect(card).toBeVisible();
  // It opens as it is (off here), with nothing beneath it until it's on.
  await expect(card.getByRole('switch', { name: 'Allow notifications' })).not.toBeChecked();
  await expect(card.getByRole('group', { name: 'Tell me when' })).toHaveCount(0);
  // Which devices get them is in Settings → Devices, beside each device.
  await expect(settings.getByText('No other device gets them yet.')).toBeVisible();
  await settings.getByRole('button', { name: 'Your devices' }).click();
  await expect(settings.getByRole('tab', { name: 'Devices', selected: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Add your phone' })).toBeVisible();

  await settings.getByRole('tab', { name: 'Voice' }).click();
  await expect(settings.getByRole('heading', { name: 'How Conch hears you' })).toBeVisible();
  await expect(settings.getByRole('list', { name: 'What private dictation needs' })).toContainText(
    'whisper.cpp',
  );
  // Where it's heard is chosen on the same page, a sensible default already picked.
  await expect(
    settings.getByRole('radiogroup', { name: 'Where your voice is heard' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  // The composer has dictation, and talking hands free.
  await expect(page.getByRole('button', { name: 'Dictate' })).toBeVisible();
  await page.getByRole('button', { name: 'Talk with Conch' }).click();
  const talk = page.getByRole('dialog', { name: 'Talking with Conch' });
  await expect(talk).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(talk).toBeHidden();
});

/**
 * This browser as one that turned notifications on before: allowed, and
 * holding a subscription made with Conch's key (a real push service isn't
 * reachable from a test). Conch is told the same.
 */
async function notifiedBefore(page: Page, prefs: Record<string, boolean> = {}) {
  await page.context().grantPermissions(['notifications']);
  const real = (await (await page.request.get('/api/push')).json()) as {
    publicKey: string;
    devices: unknown[];
  };
  await page.addInitScript((publicKey) => {
    const b64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const key = Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
    const subscription = { options: { applicationServerKey: key }, unsubscribe: async () => true };
    const pushManager = { getSubscription: async () => subscription };
    navigator.serviceWorker.getRegistration = async () =>
      ({ pushManager }) as unknown as ServiceWorkerRegistration;
  }, real.publicKey);
  await page.route('**/api/push', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            ...real,
            devices: [
              {
                id: 'ps_here',
                name: 'Chrome on Mac',
                current: true,
                createdAt: Date.now(),
                prefs: {
                  approvals: true,
                  replies: true,
                  routines: true,
                  tasks: true,
                  devices: true,
                  updates: false,
                  previews: true,
                  ...prefs,
                },
              },
            ],
          },
        })
      : route.fallback(),
  );
}

test('notifications open as they were saved: on, with nothing moving into place', async ({
  page,
}) => {
  await notifiedBefore(page, { replies: false });
  await page.goto('/settings/notifications');
  const card = page.getByRole('region', { name: 'Allow notifications' });
  const master = card.getByRole('switch', { name: 'Allow notifications' });
  await expect(master).toBeChecked();
  // At the moment it appears: the switch and its choices are still, already in place.
  const moving = await card.evaluate(
    (el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length,
  );
  expect(moving).toBe(0);
  await expect(master).not.toHaveAttribute('data-moving');
  const told = card.getByRole('group', { name: 'Tell me when' });
  await expect(told).toBeVisible();
  await expect(told.getByRole('switch', { name: 'It needs you' })).toBeChecked();
  await expect(told.getByRole('switch', { name: 'An answer is ready' })).not.toBeChecked();
  await expect(card.getByRole('switch', { name: 'Show what it’s about' })).toBeChecked();
  await expect(card.getByRole('button', { name: 'Send a test' })).toBeVisible();
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

/** Light and dark, desktop or phone, kept beside the test's own results (or `CONCH_SHOTS`). */
async function shot(page: Page, name: string) {
  const dir = process.env.CONCH_SHOTS ?? test.info().outputDir;
  await page.waitForTimeout(500);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: join(dir, name) });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(dir, name.replace('.png', '-dark.png')) });
  await page.emulateMedia({ colorScheme: 'light' });
}

test('choosing the working folder from a phone: walk the computer’s folders, make one, choose it', async ({
  browser,
  request,
}, info) => {
  const { workspace } = (await (await request.get('/api/state')).json()) as { workspace: string };
  for (const name of ['garden-planner', 'notes', 'website'])
    await request.post('/api/pick/folder', { data: { parent: workspace, name } });
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
  // A phone keeps the folder off the message box: `/folder` (or Settings → General) has it.
  const box = page.getByRole('textbox', { name: 'Message Conch' });
  await box.fill('/folder');
  await box.press('Enter');
  const chooser = page.getByRole('dialog', { name: 'Choose a working folder' });
  await expect(chooser).toBeVisible();
  // The places people start from; Conch's own folder is never among the folders.
  const places = chooser.getByRole('navigation', { name: 'Places' });
  await expect(places.getByRole('button', { name: 'Home' })).toBeVisible();
  await places.getByRole('button', { name: 'Conch’s workspace' }).click();
  await expect(chooser.getByRole('option', { name: /garden-planner/ })).toBeVisible();
  await shot(page, 'folders-1-phone.png');

  // A new folder where you are, then go in and choose it.
  await chooser.getByRole('button', { name: 'New folder' }).click();
  await chooser.getByRole('textbox', { name: 'New folder’s name' }).fill('weekend-robot');
  await chooser.getByRole('button', { name: 'Make' }).click();
  await expect(chooser.getByRole('button', { name: 'Choose “weekend-robot”' })).toBeVisible();
  await chooser.getByRole('button', { name: 'Choose “weekend-robot”' }).tap();
  await expect(chooser).toBeHidden();
  await expect(page.getByText('Working in weekend-robot')).toBeVisible();
  const state = (await (await request.get('/api/state')).json()) as {
    preferences: { workspace?: string };
  };
  expect(state.preferences.workspace).toMatch(/weekend-robot$/);
  await phone.close();
  await request.patch('/api/settings', { data: { preferences: { workspace: '' } } });
});

test('choosing a folder on a computer: filter, the trail, and a typed path for the few', async ({
  page,
  request,
}) => {
  const { workspace } = (await (await request.get('/api/state')).json()) as { workspace: string };
  for (const name of ['garden-planner', 'notes', 'website'])
    await request.post('/api/pick/folder', { data: { parent: workspace, name } });
  await openConch(page);
  await page.keyboard.press(`${mod}+,`);
  const settings = page.getByRole('dialog', { name: /Settings/ });
  await settings.getByRole('tab', { name: 'General' }).click();
  await settings.getByRole('button', { name: /Choose (another|a) folder/ }).click();
  const chooser = page.getByRole('dialog', { name: 'Choose a working folder' });
  // It starts in the folder in use now: Conch's own workspace.
  await expect(chooser.getByRole('option', { name: /garden-planner/ })).toBeVisible();
  await chooser.getByRole('combobox', { name: 'Filter folders' }).fill('web');
  await expect(chooser.getByRole('option')).toHaveCount(1);
  await shot(page, 'folders-2-desktop.png');
  await page.keyboard.press('Enter');
  await expect(
    chooser.getByRole('navigation', { name: 'Where you are' }).getByText('website'),
  ).toHaveAttribute('aria-current', 'page');
  // Typing a path, tucked away: suggestions as you go, and words for what isn't there.
  await chooser.getByRole('button', { name: 'Type a path' }).click();
  const path = chooser.getByRole('combobox', { name: 'Path' });
  await path.fill(`${workspace}/no`);
  await expect(chooser.getByRole('option', { name: /notes/ })).toBeVisible();
  await path.fill(`${workspace}/nowhere-at-all`);
  await expect(chooser.getByRole('status')).toHaveText('There’s no folder there.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(chooser).toBeHidden();
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
