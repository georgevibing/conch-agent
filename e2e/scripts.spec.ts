import { expect, test } from '@playwright/test';

/**
 * A script that calls tools (ADR 0119), end to end: the mock's script makes a
 * folder and writes a note for each day of the month in it (each call through the
 * real gate), then tries to send one to a drop box, which asks. The whole run is one story; the
 * question waits inside it, naming the step; a no is carried on from; and one
 * Undo puts every note back.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', {
    data: { onboarded: true, profile: { name: 'Ada' }, preferences: { permissionMode: 'auto' } },
  });
});

test('thirty calls as one story, a question inside it, and one Undo for all of it', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('run a script to tidy my notes');
  await composer.press('Enter');

  // The run waits on the upload: its question sits under its line, saying which step it is.
  const card = page.getByLabel(/Conch asks first:/);
  await expect(card).toBeVisible();
  await expect(card).toContainText('Step 32 of the script');
  await expect(card).toContainText('Tidy my notes, one for each day');
  const run = page.locator('[data-script]');
  await expect(run).toHaveCount(1);
  const counters = run.getByRole('list', { name: 'Calls so far' });
  await expect(counters.getByLabel('30 times')).toBeVisible();
  await expect(counters).toContainText('Wrote a file');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.screenshot({ path: testInfo.outputPath(`script-waiting-${colorScheme}.png`) });
  }
  await card.getByRole('button', { name: 'Deny' }).click();

  // Over: what it came to, in its own words, and the reply that carried on from the no.
  const line = run.getByRole('button', { name: /^Wrote 30 notes, one for each day/ });
  await expect(line).toBeVisible();
  await expect(line).toContainText('32 tool calls');
  await expect(page.getByText('You didn’t want the first one uploaded')).toBeVisible();
  // One story, not thirty rows: no step of it is a row of its own.
  await expect(page.getByRole('button', { name: /^Created notes\/day-/ })).toHaveCount(0);

  // Opened: the script, and the calls by kind, the upload among them, not allowed.
  await line.click();
  await expect(run.getByRole('region', { name: 'The script' })).toContainText('tools.Write');
  const kinds = run.getByRole('region', { name: 'What it called' });
  await expect(kinds).toContainText('×30');
  await expect(kinds).toContainText('×2');
  await expect(kinds).toContainText('1 not allowed');
  await expect(run.getByRole('region', { name: 'What it asked you' })).toContainText('You said no');
  await page.screenshot({ path: testInfo.outputPath('script-done.png') });

  // One Undo for every note it wrote.
  await run.getByRole('button', { name: 'Undo all 30 changes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Undo changes to 30 files' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(run.getByRole('button', { name: 'Put all 30 back again' })).toBeVisible();
});
