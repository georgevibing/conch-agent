import { expect, type Page, test } from '@playwright/test';

/**
 * Your chats knowing about each other (ADR 0134). One chat keeps editing a
 * file; another, started meanwhile, is told by Conch that a chat is working
 * in its folder, and `list_chats` says which one and what it's doing. The
 * row in the chat says how many are busy, and opens the busy one.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true } });
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });

test('a chat knows another is editing in its folder, and opens it from the row', async ({
  page,
}) => {
  await page.goto('/');
  await composer(page).fill('Keep editing the notes');
  await composer(page).press('Enter');
  await expect(page).toHaveURL(/\/c\//);
  const busy = page.url();
  // It's on the file now.
  await expect(page.getByText(/notes\.md/).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByText('What’s on your mind?')).toBeVisible();
  await composer(page).fill('What are my other chats doing?');
  await composer(page).press('Enter');
  await expect(page.getByText('Conch told me another chat is working in this folder.')).toBeVisible(
    { timeout: 20_000 },
  );
  await expect(page.getByText(/Working now: “.+” \(editing files\)\./)).toBeVisible();

  const row = page.getByRole('button', { name: /Checked on your other chats/ });
  await expect(row).toContainText('1 working');
  await row.click();
  const list = page.getByRole('list', { name: 'Your other chats' });
  await expect(list.getByRole('button')).toContainText([/Editing files.*Same folder/]);
  await list.getByRole('button').first().click();
  await expect(page).toHaveURL(busy);

  // Done with it: Stop ends the editing.
  await composer(page).focus();
  await page.keyboard.press('Escape');
});
