import { expect, type Page, test } from '@playwright/test';

import { openConch, say } from './app';

/**
 * Conch's own chat commands, as a person meets them (ADR 0098): `/clear`
 * leaves a line in the chat with **Undo** until something is sent, and
 * `/goal` puts what the chat is for above the composer, where it stays
 * through a clear until it's taken away. They're done by the gateway, so they
 * mean the same with every provider.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });
const cleared = (page: Page) => page.getByText(/Context cleared: .* starts fresh from here/);

async function command(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press('Enter');
}

test('/clear leaves a line in the chat, and Undo puts the memory back', async ({ page }) => {
  await openConch(page);
  await say(page, 'What is a monad?', "Here's a thought on");

  await command(page, '/clear');
  // The line in the chat, and the toast that says what happened.
  await expect(cleared(page)).toBeVisible();
  await expect(page.getByText('Context cleared').first()).toBeVisible();
  // Nothing was deleted: what was said is still there for the person.
  await expect(page.getByText('What is a monad?', { exact: true })).toBeVisible();

  // Undo, from the line itself: the chat is as it was.
  await page.getByRole('button', { name: 'Undo clearing the context' }).click();
  await expect(cleared(page)).toHaveCount(0);
  await expect(page.getByText('Back as it was')).toBeVisible();

  // Cleared again and sent on: the provider has started afresh, so there's
  // nothing to undo — the line stays to say where the memory starts.
  await command(page, '/clear');
  await expect(cleared(page)).toBeVisible();
  await say(page, 'Hello again', "Here's a thought on");
  await expect(page.getByRole('button', { name: 'Undo clearing the context' })).toHaveCount(0);

  // It's part of the chat: a reload shows the same.
  await page.reload();
  await expect(cleared(page)).toBeVisible();
});

test('/goal says what the chat is for, keeps it through a clear, and lets it go', async ({
  page,
}) => {
  await openConch(page);
  await say(page, 'What is a monad?', "Here's a thought on");

  await command(page, '/goal Ship the docs site');
  // Above the composer, and noted where it was set.
  const goal = page.getByRole('button', { name: 'Goal: Ship the docs site. Change it' });
  await expect(goal).toBeVisible();
  await expect(page.getByText('Goal set: Ship the docs site')).toBeVisible();

  // It survives `/clear` (it isn't memory of the conversation).
  await command(page, '/clear');
  await expect(cleared(page)).toBeVisible();
  await expect(goal).toBeVisible();

  // And a reload.
  await page.reload();
  await expect(goal).toBeVisible();

  // Clear goal, from the line's own popover: it's gone, above and in the chat.
  await goal.click();
  await page.getByRole('button', { name: 'Clear goal' }).click();
  await expect(goal).toHaveCount(0);
  await expect(page.getByText('Goal cleared').first()).toBeVisible();
});
