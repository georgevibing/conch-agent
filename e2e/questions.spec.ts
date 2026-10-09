import { expect, type Page, test } from '@playwright/test';

/**
 * Questions answered with a tap (ADR 0060 §4). The mock asks when and how to
 * book a call with Ada: a day and time (with a suggestion already chosen) and
 * how to talk. Answered on the card, typed in the message box, skipped, and
 * still there after a reload while it waits.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', {
    data: { onboarded: true, profile: { name: 'Ada' } },
  });
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });
const card = (page: Page) => page.getByRole('group', { name: 'Conch asks: Your call with Ada' });

async function book(page: Page) {
  await page.goto('/');
  await composer(page).fill('Book a call with Ada next week');
  await composer(page).press('Enter');
  await expect(card(page)).toBeVisible({ timeout: 20_000 });
  // It's your move: the message box says so, and the chat isn't "working".
  await expect(composer(page)).toHaveAttribute('placeholder', 'Answer above, or type it here');
}

test('answered with a tap: the card folds to the answer and the reply carries on', async ({
  page,
}) => {
  await book(page);
  const asked = card(page);
  // The suggested day and time are chosen already; only how to talk is left.
  await expect(asked.getByRole('button', { name: 'Send' })).toBeDisabled();
  await asked.getByRole('radio', { name: 'Phone call' }).click();
  await asked.getByRole('button', { name: 'Send' }).click();
  const folded = page.getByRole('note').filter({ hasText: 'Phone call' });
  await expect(folded).toBeVisible();
  await expect(
    page.getByText(/Done: your call with Ada is booked for .+\s·\sPhone call\./),
  ).toBeVisible({ timeout: 20_000 });
  await expect(card(page)).toHaveCount(0);
  await expect(composer(page)).toHaveAttribute('placeholder', /^Message Conch/);
});

test('typed in the message box instead: your words answer it', async ({ page }) => {
  await book(page);
  await composer(page).fill('Thursday afternoon, by phone');
  await composer(page).press('Enter');
  await expect(
    page.getByRole('note').filter({ hasText: 'Answered in your message' }),
  ).toBeVisible();
  await expect(
    page.getByText('Got it: “Thursday afternoon, by phone”. I’ll book the call with Ada'),
  ).toBeVisible({ timeout: 20_000 });
  // Your message is in the chat as you sent it, once.
  await expect(page.getByText('Thursday afternoon, by phone', { exact: true })).toHaveCount(1);
});

test('skipped: the assistant carries on with its best guess and says so', async ({ page }) => {
  await book(page);
  await card(page).getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('note').filter({ hasText: 'Skipped' })).toBeVisible();
  await expect(page.getByText(/I went with the first free morning and a video call/)).toBeVisible({
    timeout: 20_000,
  });
});

test('still waiting after a reload, and answered from there', async ({ page }) => {
  await book(page);
  await page.reload();
  await expect(card(page)).toBeVisible();
  await expect(composer(page)).toHaveAttribute('placeholder', 'Answer above, or type it here');
  await card(page).getByRole('radio', { name: 'Video call' }).click();
  await card(page).getByRole('button', { name: 'Send' }).click();
  await expect(
    page.getByText(/Done: your call with Ada is booked for .+\s·\sVideo call\./),
  ).toBeVisible({ timeout: 20_000 });
});
