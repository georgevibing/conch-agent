import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * Settings → This computer, against the real gateway reading the real
 * machine: found by ⌘K, readings arrive and the charts move on, the page
 * fits a phone, and Conch stops looking once nobody is.
 */

async function shot(page: Page, name: string) {
  const dir = process.env.CONCH_SHOTS ?? test.info().outputDir;
  // Let a reading or two land and the line glide.
  await page.waitForTimeout(2600);
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, `${name}-dark.png`), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
}

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('shows this computer, live, and only while someone is looking', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: /Message/ })).toBeVisible();

  // ⌘K finds it by the words the system's own monitors use.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('activity monitor');
  await page.getByRole('option', { name: /This computer/ }).click();
  await expect(page).toHaveURL(/\/settings\/computer$/);

  const summary = page.getByRole('heading', {
    name: /Room to spare|Busy right now|Working hard|Low on memory|Battery low/,
  });
  await expect(summary).toBeVisible();
  await expect(page.getByRole('group', { name: 'Processor' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Memory' })).toBeVisible();
  const cpu = page.getByRole('figure', { name: /^Processor/ });
  await expect(cpu).toBeVisible();
  await expect(page.getByRole('table', { name: 'Conch and what it started' })).toContainText(
    'Conch',
  );

  // Readings keep arriving while it's open.
  const asks = () =>
    page.waitForResponse((r) => r.url().endsWith('/api/computer') && r.status() === 200);
  const first = await (await asks()).json();
  const second = await (await asks()).json();
  expect(second.samples.at(-1).at).toBeGreaterThan(first.samples.at(-1).at);

  // The pointer reads a moment.
  const box = await cpu.locator('svg').boundingBox();
  if (box) await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await expect(cpu.getByText(/s ago|Now/).first()).toBeVisible();
  await page.mouse.move(0, 0);

  await shot(page, 'computer-desktop');

  // What's running, further down the same page.
  await page.getByRole('table', { name: 'Conch and what it started' }).scrollIntoViewIfNeeded();
  await shot(page, 'computer-running');

  // A phone: the same page, one column, nothing wider than the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(summary).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, 'computer-phone');

  // Leaving stops the asking.
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/\/settings\/computer/);
  let asked = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/computer')) asked += 1;
  });
  await page.waitForTimeout(5000);
  expect(asked).toBe(0);
});
