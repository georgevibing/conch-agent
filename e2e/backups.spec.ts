import { readFile } from 'node:fs/promises';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Back up and restore, end to end, on a Conch that can start itself again
 * (it runs under the supervisor here, like `pnpm start`): back up to a file,
 * change something, restore the file, and see it back — then undo it.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

const memories = async (request: APIRequestContext) =>
  ((await (await request.get('/api/memories')).json()) as { id: string; content: string }[]).map(
    (m) => m.content,
  );

async function openBackups(page: Page, action: 'Back up now' | 'Restore a backup') {
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill(action === 'Back up now' ? 'back up' : 'restore');
  await page.getByRole('option', { name: new RegExp(action) }).click();
}

test('back up, change something, restore it, see it back, and undo', async ({ page, request }) => {
  test.setTimeout(120_000);
  await request.post('/api/memories', { data: { content: 'Ada takes her tea with lemon.' } });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toBeVisible();

  // Back up now, from ⌘K: a small dialog, and a file.
  await openBackups(page, 'Back up now');
  const backUp = page.getByRole('dialog', { name: 'Back up your Conch' });
  await expect(backUp.getByRole('switch', { name: 'Include chats' })).toBeChecked();
  const downloading = page.waitForEvent('download');
  await backUp.getByRole('button', { name: 'Download backup' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^Conch backup \d{4}-\d\d-\d\d\.conchbackup$/);
  const file = await download.path();
  expect((await readFile(file)).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
  await expect(backUp).toBeHidden();
  await expect(page.getByText('Backup downloaded')).toBeVisible();

  // Change something.
  const [lemon] = (await (await request.get('/api/memories')).json()) as { id: string }[];
  await request.delete(`/api/memories/${lemon?.id ?? ''}`);
  await request.post('/api/memories', { data: { content: 'Only after the backup.' } });
  expect(await memories(request)).toEqual(['Only after the backup.']);

  // Restore the file: checked, previewed in plain words, one button.
  const settings = page.getByRole('dialog', { name: /Settings/ });
  await expect(
    settings.getByRole('region', { name: /Backed up automatically|The first backup/ }),
  ).toBeVisible();
  const choosing = page.waitForEvent('filechooser');
  await settings.getByRole('button', { name: 'Restore from a file…' }).click();
  await (await choosing).setFiles(file);
  const restore = page.getByRole('dialog', { name: 'Restore this backup?' });
  const contents = restore.getByRole('list', { name: 'What this backup brings back' });
  await expect(contents).toContainText('1 memory');
  await expect(contents).toContainText('Keys and sign-ins aren’t in it');
  await expect(restore.getByText(/kept first, so you can undo this/)).toBeVisible();
  await restore.getByRole('button', { name: 'Restore' }).click();

  // Conch starts again, calmly, and the page comes back by itself.
  await expect(page.getByText('Restoring your Conch…')).toBeVisible();
  await expect(page.getByText('Your chats are safe', { exact: false })).toBeVisible();
  await expect(page.getByText('Your Conch is restored')).toBeVisible({ timeout: 60_000 });
  expect(await memories(request)).toEqual(['Ada takes her tea with lemon.']);

  // And in Settings → Memory, where a person would look.
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('memory');
  await page.getByRole('option', { name: /Settings: Memory/ }).click();
  await expect(page.getByText('Ada takes her tea with lemon.')).toBeVisible();
  await expect(page.getByText('Only after the backup.')).toHaveCount(0);

  // Undo, from Settings → Health: back to how it was just before.
  await page.keyboard.press('Escape');
  await openBackups(page, 'Restore a backup');
  await page.getByRole('button', { name: 'Undo restore' }).click();
  const undo = page.getByRole('dialog', { name: 'Undo the restore?' });
  await undo.getByRole('button', { name: 'Undo restore' }).click();
  await expect(page.getByText('Restoring your Conch…')).toBeVisible();
  await expect(page.getByText('Restore undone')).toBeVisible({ timeout: 60_000 });
  expect(await memories(request)).toEqual(['Only after the backup.']);
});
