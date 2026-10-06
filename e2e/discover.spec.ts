import { expect, test } from '@playwright/test';

/**
 * Discover, end to end (ADR 0074), on the pretend registry the mock engine
 * brings: the shelf and its trust, a worrying skill that waits for a tick, one
 * whose licence rules it out, adding one in a press and finding it among
 * your skills with where it came from; and from the chat, an offer that's
 * read in a dialog, added, and carried on with.
 */

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Sam' } } });
});

test('find a skill people share, read it, and add it in one press', async ({ page }) => {
  await page.goto('/skills/discover');
  await expect(page.getByRole('tab', { name: 'Discover', selected: true })).toBeVisible();
  const notes = page.getByRole('article', { name: 'Meeting notes, from ClawHub. Look at it' });
  await expect(notes).toContainText('Verified publisher');
  await expect(notes).toContainText('18k people use it');

  // The ClawHavoc trick: what Conch found, and a button that waits for a tick.
  await page.getByRole('searchbox', { name: 'Search skills people share' }).fill('wallet');
  await page.getByRole('button', { name: 'Wallet helper, from ClawHub. Look at it' }).click();
  await expect(
    page.getByText('Downloads something from the internet and runs it straight away.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add anyway' })).toBeDisabled();
  // Where you are, in one trail: Discover is a step back to the shelf as you left it.
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(trail.getByRole('link')).toHaveText(['Skills', 'Discover']);
  await expect(trail.getByText('Wallet helper')).toHaveAttribute('aria-current', 'page');
  await trail.getByRole('link', { name: 'Discover' }).click();
  await expect(page).toHaveURL(/\/skills\/discover\?q=wallet$/);
  await expect(page.getByRole('searchbox', { name: 'Search skills people share' })).toHaveValue(
    'wallet',
  );

  // A licence that forbids copying: no button, only why.
  await page.goto('/skills/discover?q=word');
  await page.getByRole('button', { name: 'Word documents, from ClawHub. Look at it' }).click();
  await expect(page.getByText('Conch won’t add this one')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Add/ })).toHaveCount(0);

  // Clean: pinned, read, added.
  await page.goto('/skills/discover?q=meeting');
  await page.getByRole('button', { name: 'Meeting notes, from ClawHub. Look at it' }).click();
  await expect(page.getByText('Pinned to version 1.0.0.', { exact: false })).toBeVisible();
  await expect(page.getByText('Conch read every file in it: nothing worrying')).toBeVisible();
  await page.getByRole('button', { name: 'Add skill' }).click();
  await expect(page.getByRole('button', { name: 'Try it in a chat' })).toBeVisible();

  await page.goto('/skills');
  const added = page.getByRole('region', { name: 'Added from Discover' });
  await expect(added.getByRole('article', { name: 'Meeting notes' })).toBeVisible();
  await added.getByRole('article', { name: 'Meeting notes' }).getByRole('button').first().click();
  await expect(page.getByText('Added from ClawHub, by Pretend Publisher')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
});

test('the chat offers a skill people share, and carries on once it’s added', async ({
  page,
  request,
}) => {
  // A skill you have is never offered: start without the one the journey above added.
  await request.delete('/api/skills/market-clawhub_meeting-notes');
  await page.goto('/');
  const box = page.getByRole('textbox', { name: 'Message Conch' });
  await box.fill('Tidy these meeting notes: ship Friday, Sam does release notes, support?');
  await box.press('Enter');
  const card = page.getByRole('group', { name: 'A skill for this: “Meeting notes”' });
  await expect(card).toContainText('ClawHub · Pretend Publisher');
  await card.getByRole('button', { name: 'Look at it Meeting notes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Read it before you add it' });
  await expect(dialog.getByText('Pinned to version 1.0.0.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add and carry on' }).click();
  await expect(page.getByText(/Added\s*Meeting notes\s*·\s*carrying on/)).toBeVisible();
  await expect(page.getByText('Here are your notes, tidied with', { exact: false })).toBeVisible();
  // Held to what it says it needs, like any skill.
  await expect(page.getByText('Held to Meeting notes’s list', { exact: false })).toBeVisible();
});
