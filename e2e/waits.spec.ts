import { expect, type Page, test } from '@playwright/test';

/**
 * Waiting without polling (ADR 0124). The mock asks Conch's own `wait_for`
 * to wait 30 minutes: the call lets go of the turn, the chat is free, and
 * one calm row says what it waits for. Nothing calls the model while it
 * waits. Stop waiting ends it, and nobody is woken.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true } });
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });

test('a long wait lets go of the turn, the chat stays yours, and Stop waiting ends it', async ({
  page,
}) => {
  await page.goto('/');
  await composer(page).fill('Wait 30 minutes, then check on the deploy');
  await composer(page).press('Enter');

  await expect(page.getByText(/I’ll pick this up in 30 minutes/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Waiting until \d{1,2}:\d{2} (am|pm)$/)).toBeVisible();
  await expect(page.getByText(/next look in \d+ min · you can keep chatting/)).toBeVisible();
  // The turn is over: the box is free, and says what the chat waits for.
  await expect(composer(page)).toHaveAttribute(
    'placeholder',
    /^Waiting until \d{1,2}:\d{2} (am|pm) · you can keep chatting$/,
  );

  // Chatting meanwhile works as ever.
  await composer(page).fill('Meanwhile, hello');
  await composer(page).press('Enter');
  await expect(page.getByText('Meanwhile, hello')).toBeVisible();

  await page.getByRole('button', { name: 'Stop waiting' }).click();
  await expect(page.getByText(/^Stopped waiting until \d{1,2}:\d{2} (am|pm)$/)).toBeVisible();
  await expect(page.getByText('You stopped waiting', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop waiting' })).toHaveCount(0);
  await expect(composer(page)).toHaveAttribute('placeholder', /^Message Conch/);

  // Still so after a reload: the row is part of the chat.
  await page.reload();
  await expect(page.getByText('You stopped waiting', { exact: true })).toBeVisible();
});
