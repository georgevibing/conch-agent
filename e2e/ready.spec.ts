import { expect, test } from '@playwright/test';

/**
 * The whole happy path a new user walks, against the real gateway + mock engine:
 * the welcome (ADR 0068) → a first chat started from it, with memory and a
 * step that goes ahead in Auto → reload (history persists) → Settings shows what Conch
 * remembered.
 */
test('first run to first conversation', async ({ page, request }) => {
  await page.goto('/');

  // Hello and a name, together.
  await expect(page.getByRole('heading', { name: 'Hi, I’m Conch.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ada');
  await page.keyboard.press('Enter');

  // A mind to think with: the provider is already connected, so this carries on by itself.
  await expect(page.getByText(/Claude Max/)).toBeVisible();

  // Ready, with somewhere to start.
  await expect(page.getByRole('heading', { name: 'You’re all set, Ada.' })).toBeVisible({
    timeout: 8000,
  });
  expect((await (await request.get('/api/state')).json()).onboarded).toBe(false);
  await page.getByRole('button', { name: 'Help me plan my week' }).click();

  // Settings were saved on the server, and the chat opens with that first question in it.
  await expect
    .poll(async () => (await request.get('/api/state')).json())
    .toMatchObject({ onboarded: true, profile: { name: 'Ada' } });
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toHaveValue(
    'Help me plan my week',
  );

  // Start an ordinary chat.
  await page.goto('/');
  // Empty chat greets by name.
  await expect(page.getByText(/Ada\./).first()).toBeVisible();

  // First message: memory + a step + streamed reply.
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('Please remember that I love espresso and list files');
  await composer.press('Enter');

  await expect(page).toHaveURL(/\/c\/c_/);
  // Remembering is a step of the run (ADR 0103), told on its story's row.
  await expect(page.getByRole('button', { name: /[Rr]emember(ed|ing) something/ })).toBeVisible();
  // A new chat is in Auto (ADR 0119): looking through the folder is routine, so nothing asks.
  await expect(page.getByText("Got it — I'll remember that.", { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /looked through the folder/ })).toBeVisible();
  await expect(page.getByRole('group', { name: /asks first/ })).toHaveCount(0);

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
