import { expect, type Page, test } from '@playwright/test';

import { openConch, say } from './app';

/**
 * The plan, ticking itself off (ADR 0055). The mock engine answers “tidy up
 * this folder” with four steps, ticked off one after another with Conch's
 * own `update_plan`; in plan mode it plans first and asks to start, as
 * Claude Code's ExitPlanMode does.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true } });
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });
const card = (page: Page) => page.getByRole('region', { name: /^Plan, \d of 4 done$/ });

test('the plan appears, ticks itself off, and folds when the reply ends', async ({ page }) => {
  await openConch(page);
  await composer(page).fill('Tidy up this folder, please');
  await composer(page).press('Enter');

  // It shows while the work goes on, one step at a time.
  await expect(card(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'Plan, 1 of 4 done' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(card(page).locator('[aria-current="step"]')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Plan, 3 of 4 done' })).toBeVisible({
    timeout: 20_000,
  });
  // One card, kept current: never a second one, and never a tool row for it.
  await expect(card(page)).toHaveCount(1);
  await expect(page.getByText('update_plan')).toHaveCount(0);

  // The reply ends: one quiet line.
  await expect(page.getByText('All tidy.')).toBeVisible({ timeout: 20_000 });
  const line = page.getByRole('button', { name: 'Plan · 4 of 4 done' });
  await expect(line).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await line.click();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Clear out the duplicates' }),
  ).toBeVisible();

  // It's part of the chat: a reload shows the same.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Plan · 4 of 4 done' })).toBeVisible();
});

test('plan mode asks to start, and Keep planning hands the message box back', async ({ page }) => {
  await openConch(page);
  await composer(page).fill('/mode plan');
  await composer(page).press('Enter');
  await expect(page.getByRole('button', { name: /Plan only/ })).toBeVisible();

  await composer(page).fill('Tidy up this folder');
  await composer(page).press('Enter');
  const asking = page.getByRole('region', { name: 'Conch has a plan' });
  await expect(asking).toBeVisible({ timeout: 20_000 });
  await expect(asking.getByText('Give the screenshots clear names')).toBeVisible();
  // The question is the card: no tool row, no generic Allow.
  await expect(page.getByText('ExitPlanMode')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);

  await asking.getByRole('button', { name: 'Keep planning' }).click();
  await expect(composer(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Kept planning' })).toBeVisible();
  await expect(page.getByText('What would you like done differently?')).toBeVisible({
    timeout: 20_000,
  });
});

test('plan mode’s Start runs the plan', async ({ page }) => {
  await openConch(page);
  await composer(page).fill('/mode plan');
  await composer(page).press('Enter');
  await composer(page).fill('Tidy up this folder');
  await composer(page).press('Enter');
  const asking = page.getByRole('region', { name: 'Conch has a plan' });
  await expect(asking).toBeVisible({ timeout: 20_000 });
  await asking.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'Started on the plan' })).toBeVisible();
  await expect(page.getByText('All tidy.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Plan · 4 of 4 done' })).toBeVisible();
});

test('a short answer has no plan', async ({ page }) => {
  await openConch(page);
  await say(page, 'What is a monad?', "Here's a thought on");
  await expect(page.getByRole('button', { name: /^Plan ·/ })).toHaveCount(0);
});
