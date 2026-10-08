import { expect, test } from '@playwright/test';

/**
 * Offline (ADR 0023): nothing breaks. A message sent with no internet waits in
 * the chat, says so calmly, and goes by itself the moment Conch is back online.
 * (Mock mode can pretend the internet is gone: POST /api/mock/network.)
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test.afterEach(async ({ request }) => {
  await request.post('/api/mock/network', { data: { online: true } });
});

test('offline: a message waits, then goes by itself when the internet is back', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await request.post('/api/mock/network', { data: { online: false } });
  // The composer says what will happen, before anything is sent.
  await expect(page.getByText('You’re offline.')).toBeVisible();

  await page.getByRole('textbox').first().fill('Summarise the notes from this morning');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Waiting for the internet')).toBeVisible();
  // Waiting isn't failing: no error, no Try again.
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);

  await request.post('/api/mock/network', { data: { online: true } });
  await expect(page.getByText('Sent when you were back online')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('You’re offline.')).toHaveCount(0);
  await expect(page.getByText(/Summarise the notes from this morning/).first()).toBeVisible();
  // Conch answered it (the mock engine replies to every message).
  await expect(page.locator('[data-from="assistant"]').first()).toBeVisible({ timeout: 15_000 });

  // And it says, quietly, that it took care of it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByRole('tab', { name: 'Health' }).click();
  // What Conch fixed by itself is reassurance, at the foot of the page.
  await expect(settings.getByText(/Sent your message once you were back online/)).toBeVisible();
});
