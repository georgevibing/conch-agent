import { expect, test } from '@playwright/test';

/**
 * When the provider signs out in the middle of a chat, the chat says so in
 * plain words and offers the one thing that helps. Signing in from there
 * sends the message again by itself — nobody retypes or presses Try again.
 * (The mock engine ends its sign-in once, on "pretend you're signed out".)
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('signed out mid-chat: sign in from the chat, and the message goes again', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox').first().fill('Please pretend you’re signed out');
  await page.keyboard.press('Enter');

  await expect(page.getByText('Claude Code signed you out')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in to Claude Code' }).click();

  // Straight to the provider's page, where its sign-in is.
  const settings = page.getByRole('dialog');
  await settings.getByRole('button', { name: 'Sign in to Claude Code' }).click();
  await expect(page.getByText('sending your message again')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');

  // The message went again, and this time it has a reply.
  await expect(page.getByText('Please pretend you’re signed out')).toHaveCount(2);
  await expect(page.getByText(/Didn’t go through/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to Claude Code' })).toHaveCount(0);
});
