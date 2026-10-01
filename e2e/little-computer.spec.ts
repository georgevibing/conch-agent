import { expect, test } from '@playwright/test';

import { openConch } from './app';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Conch in the menu bar, and a little computer (ADR 0029). The mock engine's
 * helper, lingering and keep-awake are pretend: nothing is shown in this
 * computer's menu bar, and nothing changes how it sleeps or logs out.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('the menu bar, keeping running after logout, and keeping awake', async ({ page, request }) => {
  await openConch(page);
  // ⌘K finds it by the words people use.
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('system tray');
  await page.getByRole('option', { name: /Menu bar/ }).click();
  const settings = page.getByRole('dialog', { name: /Settings/ });

  // Shown by default, and running.
  const tray = settings.getByRole('switch', { name: /Show Conch in the tray/ });
  await expect(tray).toBeChecked();
  await expect(settings.getByText(/a dot when something needs you/)).toBeVisible();

  // Repair everything knows it's there.
  await request.post('/api/doctor/check');
  await expect
    .poll(async () => {
      const report = (await (await request.get('/api/doctor')).json()) as {
        items: { id: string; state: string }[];
      };
      return report.items.find((i) => i.id === 'tray')?.state;
    })
    .toBe('ok');

  // Off, and it stays off: Repair everything doesn't bring it back.
  await tray.click();
  await expect(tray).not.toBeChecked();
  const shown = async () =>
    ((await (await request.get('/api/background')).json()) as { tray: { on: boolean } }).tray.on;
  await expect.poll(shown).toBe(false);
  await tray.click();
  await expect(tray).toBeChecked();
  await expect.poll(shown).toBe(true);

  // The helper's own door stays shut to everyone else.
  expect((await request.get('/api/tray/status')).status()).toBe(401);
  expect((await request.post('/api/tray/quit')).status()).toBe(401);

  // A little computer: keep running after logging out (pretend Linux lingering).
  const linger = settings.getByRole('switch', { name: /Keep running after you log out/ });
  await expect(linger).not.toBeChecked();
  await linger.click();
  await expect(linger).toBeChecked();
  await linger.click();
  await expect(linger).not.toBeChecked();

  // And a Mac that doesn't sleep while Conch runs.
  const awake = settings.getByRole('switch', { name: /Keep this Mac awake/ });
  await expect(awake).not.toBeChecked();
  await awake.click();
  await expect(awake).toBeChecked();
  await expect(settings.getByText(/It starts when Conch runs in the background/)).toBeVisible();
  await awake.click();
  await expect(awake).not.toBeChecked();
});
