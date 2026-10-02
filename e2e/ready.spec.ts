import { expect, test } from '@playwright/test';

/**
 * The whole happy path a new user walks, against the real gateway + mock engine:
 * onboarding → personalise → first chat with memory and a permission prompt →
 * reload (history persists) → Settings shows what Conch remembered.
 */
test('first run to first conversation', async ({ page, request }) => {
  await page.goto('/');

  // Welcome
  await expect(page.getByRole('heading', { name: 'Hello.' })).toBeVisible();
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'What would you like help with?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Connect: the provider is already connected, so this advances by itself.
  await expect(page.getByText(/Claude Max/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your notes or document' })).toBeVisible({
    timeout: 8000,
  });
  await page
    .getByRole('textbox', { name: 'Your notes or document' })
    .fill('Maya owns the launch checklist. Deadline Friday.');
  await page.getByRole('button', { name: 'Make a useful brief', exact: true }).click();
  await expect(page.getByText('Ready to review', { exact: true })).toBeVisible();
  expect((await (await request.get('/api/state')).json()).onboarded).toBe(false);
  await page.reload();
  await expect(page.getByText('Ready to review', { exact: true })).toBeVisible();
  const job = (await (await request.get('/api/first-job')).json()).task;
  expect(job.verification).toBe('verified');
  expect(
    job.operations.filter((op: { tool: string }) => op.tool === 'artifact_create'),
  ).toHaveLength(1);
  await page.getByRole('button', { name: 'Make Conch yours' }).click();

  // Personality
  const name = page.getByRole('textbox', { name: 'What should I be called?' });
  await name.fill('Pearl');
  await page.getByRole('radio', { name: /Concise/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // About you
  await page.getByRole('textbox', { name: 'What should I call you?' }).fill('Ada');
  await page.getByRole('textbox', { name: /Anything I should know/ }).fill('I build compilers.');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Make yourself at home, Ada.' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Conch', exact: true }).click();

  // Settings were saved on the server.
  // (The last save is on its way as the button is pressed: wait for it, don't race it.)
  await expect
    .poll(async () => (await request.get('/api/state')).json())
    .toMatchObject({
      onboarded: true,
      persona: { name: 'Pearl', tone: 'concise' },
      profile: { name: 'Ada', about: 'I build compilers.' },
    });

  // Start an ordinary chat after reviewing the saved first job.
  await page.goto('/');
  // Empty chat greets by name.
  await expect(page.getByText(/Ada\./).first()).toBeVisible();

  // First message: memory + permission + streamed reply.
  const composer = page.getByRole('textbox', { name: 'Message Pearl' });
  await composer.fill('Please remember that I love espresso and list files');
  await composer.press('Enter');

  await expect(page).toHaveURL(/\/c\/c_/);
  await expect(page.getByText(/Remembered/)).toBeVisible();
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.getByText(/Allowed/)).toBeVisible();
  await expect(page.getByText("Got it — I'll remember that.", { exact: false })).toBeVisible();

  // History survives a reload.
  await page.reload();
  await expect(page.getByText("Got it — I'll remember that.", { exact: false })).toBeVisible();
  // …under the title the (mock) model gave it, not its first line.
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Remember love espresso list files' }),
  ).toBeVisible();

  // The memory is listed in Settings → Memory and on disk via the API.
  const memories = await (await request.get('/api/memories')).json();
  expect(memories[0]).toMatchObject({
    source: 'agent',
    content: expect.stringContaining('espresso'),
  });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page
    .getByRole('option', { name: /remember about me/ })
    .first()
    .click();
  await expect(page.getByRole('list', { name: 'Memories' }).getByText(/espresso/)).toBeVisible();
});

test('a running reply can be stopped', async ({ page }) => {
  await page.goto('/');
  // Onboarding was completed by the previous test on this server.
  const composer = page.getByRole('textbox', { name: /Message/ });
  await expect(composer).toBeVisible();
  // A reply that runs until it's stopped: a short one can finish before the
  // click lands on a slow runner, and then there's nothing left to stop.
  await composer.fill('Tell me something interesting, take your time');
  await composer.press('Enter');
  await page.getByRole('button', { name: /Stop/ }).click();
  await expect(page.getByText(/Stopped/)).toBeVisible();
});

test('a new chat is named after what it is about', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('Hello! How is your day going?');
  await composer.press('Enter');

  // The first line shows straight away, then a descriptive title replaces it.
  const sidebar = page.getByRole('navigation', { name: 'Conversations' });
  await expect(sidebar.getByRole('link', { name: 'Friendly check-in' })).toBeVisible();
  await expect(page.getByRole('main').locator('header')).toContainText('Friendly check-in');
  await expect(page).toHaveTitle('Friendly check-in · Conch');

  // It was saved: a reload shows the same title, settled.
  await page.reload();
  const link = sidebar.getByRole('link', { name: 'Friendly check-in' });
  await expect(link).toBeVisible();
  await expect(link.locator('[aria-busy]')).toHaveCount(0);
});
