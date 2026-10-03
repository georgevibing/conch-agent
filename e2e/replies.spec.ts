import { expect, type Page, test } from '@playwright/test';

import { openConch, say } from './app';

/**
 * Replies to send next (ADR 0055). The mock engine answers “sales by month”
 * with a table and offers three replies of its own, “team sizes” with a table
 * and nothing else (so Conch's own chart chip shows), and “summarize the news”
 * after reading a page (so the assistant's replies aren't shown).
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true } });
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });
const chips = (page: Page) => page.getByRole('toolbar', { name: 'Replies to send' });

test('the assistant’s replies show under its answer, and a tap sends one', async ({ page }) => {
  await openConch(page);
  await say(page, 'How were our sales by month?', 'June was the best month so far.');

  const group = chips(page);
  await expect(group).toBeVisible();
  await expect(group.getByRole('button')).toHaveText([
    'Compare it with last year',
    'Which month had the most new customers?',
    'Add a column for profit',
  ]);
  // They're part of the chat: a reload shows the same.
  await page.reload();
  await expect(chips(page).getByRole('button')).toHaveCount(3);

  // What you were writing stays where it is.
  await composer(page).fill('half a thought');
  await chips(page).getByRole('button', { name: 'Compare it with last year' }).click();
  await expect(chips(page)).toHaveCount(0);
  await expect(page.getByText('Compare it with last year', { exact: true })).toBeVisible();
  await expect(page.getByText("Here's a thought on")).toBeVisible({ timeout: 20_000 });
  await expect(composer(page)).toHaveValue('half a thought');
  // That reply offered nothing, so nothing shows under it.
  await expect(page.getByRole('button', { name: /^Stop(?! holding)/ })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(chips(page)).toHaveCount(0);
});

test('a table of numbers gets Conch’s own chip, which goes once you write', async ({ page }) => {
  await openConch(page);
  await say(page, 'What are the team sizes?', 'Here’s how big each team is');
  await expect(chips(page).getByRole('button')).toHaveText(['Show it as a chart']);

  // Anything newer in the chat, and they've had their moment.
  await say(page, 'Thanks, that’s all', "Here's a thought on");
  await expect(chips(page)).toHaveCount(0);
});

test('a message from another device takes the chips away', async ({ page, context }) => {
  await openConch(page);
  await say(page, 'What are the team sizes?', 'Here’s how big each team is');
  await expect(chips(page)).toBeVisible();

  const other = await context.newPage();
  await other.goto(page.url());
  await expect(chips(other)).toBeVisible();
  await say(other, 'And last year?', "Here's a thought on");
  await expect(chips(page)).toHaveCount(0);
  await other.close();
});

test('after reading a page, the assistant’s replies aren’t shown', async ({ page }) => {
  await openConch(page);
  await say(page, 'Summarize the news for me', 'the market moves to Saturdays');
  // It read something from outside: the chat says so, and offers nothing of the assistant's.
  await expect(page.getByText(/news\.example\.com/).first()).toBeVisible();
  await expect(page.getByText('Send this to Sam')).toHaveCount(0);
  await expect(chips(page)).toHaveCount(0);
});

test('chips are reachable and sent from the keyboard', async ({ page }) => {
  await openConch(page);
  await say(page, 'How were our sales by month?', 'June was the best month so far.');
  const first = chips(page).getByRole('button', { name: 'Compare it with last year' });
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    chips(page).getByRole('button', { name: 'Which month had the most new customers?' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Which month had the most new customers?', { exact: true }),
  ).toBeVisible();
  await expect(chips(page)).toHaveCount(0);
});
