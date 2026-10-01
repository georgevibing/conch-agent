import { expect, test } from '@playwright/test';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Always on, end to end (ADR 0026), on a Conch running "in a Terminal window"
 * under the supervisor. The mock engine's login items are pretend: nothing is
 * added to this computer.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('keep Conch running, add it to your apps, turn it off, and quit', async ({
  page,
  request,
}) => {
  // A routine that's on only runs while Conch does: Conch says so, beside it.
  const routine = (await (
    await request.post('/api/routines', {
      data: {
        title: 'Morning briefing',
        summary: 'Today, in a few lines.',
        prompt: 'Summarise today.',
        schedule: { type: 'daily', time: '08:00' },
        timezone: 'Europe/Berlin',
        status: 'active',
      },
    })
  ).json()) as { id: string };
  await page.goto(`/routines/${routine.id}`);
  await expect(page.getByText(/This routine runs only while Conch is running/)).toBeVisible();

  // ⌘K finds it by the words people use.
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('start at login');
  await page.getByRole('option', { name: /Settings: Always on/ }).click();
  const settings = page.getByRole('dialog', { name: /Settings/ });
  const card = settings.getByRole('region', { name: 'Runs while its window is open' });
  await expect(card).toContainText('Running in a Terminal window since');
  await expect(card).toContainText('Your routine only runs while Conch is running.');
  const toggle = card.getByRole('switch', { name: /Start Conch when I log in/ });
  await expect(toggle).toBeFocused();

  // On: one switch.
  await toggle.click();
  const on = settings.getByRole('region', { name: 'Starts when you log in' });
  await expect(on).toBeVisible();
  await expect(page.getByText('Conch will start by itself when you log in.')).toBeVisible();
  await expect(on).not.toContainText('only runs while');

  // Conch as an app, where people look for apps.
  await on.getByRole('button', { name: /Add Conch to your apps/ }).click();
  await expect(page.getByText('Conch is in your apps. Open it from there any time.')).toBeVisible();
  await expect(on.getByRole('button', { name: /Add Conch to/ })).toHaveCount(0);

  // Repair everything knows how it stands.
  await request.post('/api/doctor/check');
  await expect
    .poll(async () => {
      const report = (await (await request.get('/api/doctor')).json()) as {
        items: { id: string; state: string }[];
      };
      return report.items.find((i) => i.id === 'background')?.state;
    })
    .toBe('ok');

  // Off again: back to a window.
  await on.getByRole('switch', { name: /Start Conch when I log in/ }).click();
  await expect(
    settings.getByRole('region', { name: 'Runs while its window is open' }),
  ).toBeVisible();

  // Quitting asks first, then the page rests until Conch is opened again.
  await settings.getByRole('button', { name: 'Quit Conch' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Quit Conch?' });
  await expect(confirm).toContainText('can’t reach Conch until it’s open again');
  await confirm.getByRole('button', { name: 'Keep running' }).click();
  await expect(confirm).toBeHidden();
  await settings.getByRole('button', { name: 'Quit Conch' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Quit Conch' }).click();
  await expect(page.getByText('Conch has stopped')).toBeVisible();
  await expect(page.getByText(/Open Conch from your apps, or run pnpm start/)).toBeVisible();
  await expect
    .poll(async () => (await request.get('/api/health').catch(() => undefined))?.ok() ?? false, {
      timeout: 10_000,
    })
    .toBe(false);
});
