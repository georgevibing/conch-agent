import { expect, test } from '@playwright/test';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Undo, end to end (ADR 0030): the assistant writes a file for real; the chat
 * undoes it after showing exactly what changes, and redoes it; a file changed
 * since is a conflict, undone from Activity only when you say so.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('undo a change from the chat, with a preview, then redo it', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('write a note about the dentist on Tuesday');
  await composer.press('Enter');
  // What the turn changed, said once at the end of the reply (ADR 0103).
  const line = page.getByRole('region', { name: 'What changed' });
  await expect(line).toContainText('Created note.md');
  await expect(page.getByRole('button', { name: /Stop/ })).toHaveCount(0);

  await line.getByRole('button', { name: /Created note\.md/ }).click();
  await line.getByRole('button', { name: 'Undo: Created note.md' }).click();
  const dialog = page.getByRole('dialog', { name: 'Undo this change' });
  await expect(dialog.getByRole('region', { name: 'note.md' })).toContainText(
    'Removed: the assistant made it',
  );
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(line).toContainText('Undone · Created note.md');

  await line.getByRole('button', { name: 'Redo: Created note.md' }).click();
  const redo = page.getByRole('dialog', { name: 'Redo this change' });
  await expect(redo).toContainText('the dentist on Tuesday');
  await redo.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(line.getByRole('button', { name: 'Undo: Created note.md' })).toBeVisible();
});

test('a file changed since is a conflict: Activity undoes it only when you say so', async ({
  page,
}) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('write a note to call the plumber');
  await composer.press('Enter');
  // The first journey may have left a note.md here: made, or changed.
  await expect(page.getByRole('region', { name: 'What changed' })).toContainText(
    /(Created|Changed) note\.md/,
  );
  await expect(page.getByRole('button', { name: /Stop/ })).toHaveCount(0);
  await composer.fill('change the note');
  await composer.press('Enter');
  await expect(page.getByRole('region', { name: 'What changed' }).last()).toContainText(
    'Changed note.md',
  );
  await expect(page.getByRole('button', { name: /Stop/ })).toHaveCount(0);

  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('activity');
  await page
    .getByRole('option', { name: /^Activity/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  // This chat's first change (newest first): the note has changed since.
  await page
    .getByRole('button', { name: /^Undo: Created .*note\.md$/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Undo this change' });
  await expect(dialog).toContainText('It changed since.');
  await expect(dialog.getByRole('button', { name: 'Undo the others' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Undo all, replacing later changes' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^Redo: Created .*note\.md$/ }).first(),
  ).toBeVisible();
  await expect(page.getByText('You undid: note.md').first()).toBeVisible();

  // ⌘K: the newest change that can still be undone.
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('undo');
  await page.getByRole('option', { name: /Undo the last change/ }).click();
  // The later edit: undoing the first put the note back to before both.
  await expect(page.getByRole('dialog', { name: 'Undo this change' })).toContainText(
    'It changed since.',
  );
});
