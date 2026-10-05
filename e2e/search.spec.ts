import { expect, test } from '@playwright/test';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Search, end to end: chats you've had are found by what was said, the result
 * opens the chat at that message with every match lit, and ⌘F finds within it.
 */
test('search across chats and find within one', async ({ page, request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const send = async (text: string, count: number) => {
    const composer = page.getByRole('textbox', { name: 'Message Conch' });
    await composer.fill(text);
    await composer.press('Enter');
    // Wait until the turn has finished (and so has been indexed).
    await expect
      .poll(
        async () => {
          const list = (await (await request.get('/api/conversations')).json()) as {
            status: string;
          }[];
          return list.length === count && list.every((c) => c.status === 'idle');
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  };

  await send('What is the capital of Portugal? I keep forgetting Lisbon', 1);
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByText('What’s on your mind?')).toBeVisible();
  await send('Tell me about the marmalade recipe from my grandmother', 2);

  // ⌘K, type part of a word from the *first* chat.
  await page.keyboard.press(`${mod}+k`);
  const box = page.getByRole('combobox');
  const dialog = page.getByRole('dialog');
  await expect(box).toBeFocused();
  const frame = await dialog.boundingBox();
  const input = await box.boundingBox();
  expect(input!.height).toBeGreaterThanOrEqual(44);
  const expectSteady = async () => {
    expect(await dialog.boundingBox()).toEqual(frame);
    expect(await box.boundingBox()).toEqual(input);
  };
  await box.fill('lisb');
  const hit = page.getByRole('option', { name: /capital of Portugal/ });
  await expect(hit).toBeVisible();
  await expect(hit.locator('mark').first()).toHaveText(/lisb/i);
  await expect(page.getByRole('region', { name: 'Preview' })).toContainText('Lisbon');

  await expectSteady();

  // Typos still find it.
  await box.fill('marmelade');
  await expect(page.getByText('No exact matches — showing close ones')).toBeVisible();
  await expect(page.getByRole('option', { name: /marmalade recipe/ }).first()).toBeVisible();

  await expectSteady();

  // Empty results and action previews keep the same room for typing.
  await box.fill('zzzz-nothing-matches');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('Find “zzzz-nothing-matches” in this chat');
  await expectSteady();
  await box.fill('settings');
  await expect(page.getByRole('option', { name: 'Settings', exact: true })).toBeVisible();
  await expectSteady();
  await box.fill('');
  await expect(page.getByRole('option').first()).toBeVisible();
  await expectSteady();

  // Open the Lisbon hit: lands in that chat with find open on the match.
  await box.fill('lisbon');
  await page
    .getByRole('option', { name: /capital of Portugal/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/c\//);
  const find = page.getByRole('searchbox', { name: 'Find in this conversation' });
  await expect(find).toHaveValue('lisbon');
  await expect(find).toBeFocused();
  await expect(page.getByRole('search').getByRole('status')).toHaveText(/^1 of \d+$/);

  // Find within the chat.
  await find.fill('zzzz-nothing');
  await expect(page.getByRole('search').getByRole('status')).toHaveText('No matches');
  await find.press('Escape');
  await expect(find).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toBeFocused();

  // ⌘F reopens it with the last query selected.
  await page.keyboard.press(`${mod}+f`);
  await expect(find).toBeVisible();
  await expect(find).toHaveValue('zzzz-nothing');
});
