import { expect, test, type Page } from '@playwright/test';

import { openConch, say } from './app';

/**
 * The chat list, organised (ADR 0089), in a real browser: pin a chat, make a
 * folder and drag a chat into it, choose two and archive them together, and
 * find it all as it was after a reload.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

const list = (page: Page) => page.getByRole('navigation', { name: 'Conversations' });

async function titles(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/conversations');
  const chats = (await res.json()) as { title: string; titling?: boolean }[];
  return chats.map((c) => c.title);
}

test('pin, file, drag, select and archive, and it all stays after a reload', async ({ page }) => {
  await openConch(page);
  for (const text of ['Plan a week in Lisbon', 'Groceries for Sunday', 'Birthday ideas for Maya']) {
    await page.getByRole('button', { name: 'New chat' }).click();
    await say(page, text, /Ask me to/);
  }
  // Each is titled by now; work with whatever names they were given.
  await expect.poll(async () => (await titles(page)).length).toBe(3);
  const [newest, middle, oldest] = await titles(page);
  if (!newest || !middle || !oldest) throw new Error('three chats');
  const nav = list(page);

  // Pin from the menu.
  await nav.getByRole('button', { name: `Options for ${oldest}` }).click();
  await page.getByRole('menuitem', { name: 'Pin' }).click();
  const pinned = nav.getByRole('region', { name: 'Pinned' });
  await expect(pinned.getByRole('link', { name: oldest })).toBeVisible();

  // A folder, from the list's own menu.
  await nav.getByRole('button', { name: 'Show and sort chats' }).click();
  await page.getByRole('menuitem', { name: 'New folder…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Home');
  await dialog.getByRole('radio', { name: 'House' }).click();
  await dialog.getByRole('button', { name: 'Create folder' }).click();
  const folder = nav.getByRole('region', { name: 'Home' });
  await expect(folder).toBeVisible();

  // Dragged onto the folder.
  await nav.getByRole('link', { name: middle }).dragTo(folder);
  await expect(folder.getByRole('link', { name: middle })).toBeVisible();

  // ⌘-click two, then archive them together.
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await nav.getByRole('link', { name: newest }).click({ modifiers: [mod] });
  await nav.getByRole('checkbox', { name: middle }).check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Archived 2 chats' })).toBeVisible();
  await expect(nav.getByRole('link', { name: newest })).toHaveCount(0);

  await page.reload();
  await expect(list(page).getByRole('region', { name: 'Pinned' })).toContainText(oldest);
  await expect(list(page).getByRole('region', { name: 'Home' })).toBeVisible();
  await expect(list(page).getByRole('link', { name: 'Archived 2 chats' })).toBeVisible();
});
