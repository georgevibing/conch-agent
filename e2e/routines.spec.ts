import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  // Each test starts with no routines.
  for (const r of await (await request.get('/api/routines')).json()) {
    await request.delete(`/api/routines/${r.id}`);
  }
});

test('create from an idea, run it, and read the result', async ({ page }) => {
  await page.goto('/routines');
  await expect(page.getByRole('heading', { name: 'Nothing scheduled yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Create your first routine' }).click();

  await page.getByRole('button', { name: /Morning briefing/ }).click();
  const editor = page.getByRole('dialog', { name: 'New routine' });
  await expect(editor.getByText('Every weekday at 7:30 AM').first()).toBeVisible();
  await editor.getByRole('button', { name: 'Turn on' }).click();

  await expect(page).toHaveURL(/\/routines\/r_/);
  await expect(page.getByRole('heading', { name: 'Morning briefing', level: 1 })).toBeVisible();
  await expect(page.getByText(/Next run /).first()).toBeVisible();

  await page.getByRole('button', { name: 'Run now' }).click();
  await expect(
    page.getByText('Sent your briefing: 3 meetings and rain after 4pm').first(),
  ).toBeVisible();

  // Each run is a real conversation, marked as a routine run.
  await page
    .getByRole('button', { name: /Sent your briefing/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/c\/c_/);
  await expect(page.getByRole('note')).toContainText('Morning briefing');
  await expect(page.getByText('Routine instruction')).toBeVisible();
  // Runs stay out of the chat list.
  await expect(page.getByRole('navigation').getByText('Morning briefing')).toHaveCount(0);
});

test('Conch drafts a routine from a chat; you turn it on', async ({ page, request }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('Every morning, give me a weather briefing');
  await composer.press('Enter');

  await expect(page.getByText('New routine').first()).toBeVisible();
  const before = await (await request.get('/api/routines')).json();
  const draft = before.find((r: { status: string }) => r.status === 'draft');
  expect(draft).toMatchObject({
    createdBy: 'agent',
    scheduleText: expect.stringMatching(/^Every weekday/),
  });

  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText(/Routine on/i)).toBeVisible();
  await expect
    .poll(async () => {
      const all = await (await request.get('/api/routines')).json();
      return all.find((r: { id: string }) => r.id === draft.id)?.status;
    })
    .toBe('active');

  // Asking again doesn't create a duplicate.
  await composer.fill('Every morning, give me a weather briefing');
  await composer.press('Enter');
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/routines')).json()).filter(
          (r: { title: string }) => r.title === 'Morning briefing',
        ).length,
    )
    .toBe(1);
});

test('the editor prevents mistakes', async ({ page }) => {
  await page.goto('/routines');
  await page
    .getByRole('button', { name: /New routine|Create your first routine/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Set it up yourself' }).click();
  const editor = page.getByRole('dialog', { name: 'New routine' });
  await expect(editor.getByRole('button', { name: 'Turn on' })).toBeDisabled();
  await expect(editor.getByText('Give it a name.')).toBeVisible();

  await editor.getByRole('textbox', { name: 'Name' }).fill('Water the plants');
  await editor
    .getByRole('textbox', { name: /What should Conch do/ })
    .fill('Remind me to water the plants.');
  await expect(editor.getByRole('button', { name: 'Turn on' })).toBeEnabled();
});
