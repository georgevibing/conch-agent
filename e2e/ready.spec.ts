import { expect, test } from '@playwright/test';

/**
 * The whole happy path a new user walks, against the real gateway + mock engine:
 * the welcome (ADR 0068) → a first chat started from it, with memory and a
 * permission prompt → reload (history persists) → Settings shows what Conch remembered.
 */
test('first run to first conversation', async ({ page, request }) => {
  await page.goto('/');

  // Hello
  await expect(page.getByRole('heading', { name: 'Hi, I’m Conch.' })).toBeVisible();
  await page.getByRole('button', { name: 'Let’s begin' }).click();

  // A name, then what you'd like a hand with, tapped.
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ada');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Nice to meet you, Ada.' })).toBeVisible();
  await page.getByRole('button', { name: 'Coding' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // How it sounds: choosing a voice is hearing it.
  await page.getByRole('radio', { name: 'Concise' }).click();
  await expect(page.getByText('Hi Ada. I’m Conch. Ready when you are.')).toBeVisible();
  await page.getByRole('button', { name: 'Sounds good' }).click();

  // A mind to think with: the provider is already connected, so this carries on by itself.
  await expect(page.getByText(/Claude Max/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bring the apps you live in.' })).toBeVisible({
    timeout: 8000,
  });
  await page.getByRole('button', { name: 'Skip for now' }).click();

  // Ready, with somewhere to start made from what was picked.
  await expect(page.getByRole('heading', { name: 'You’re all set, Ada.' })).toBeVisible();
  expect((await (await request.get('/api/state')).json()).onboarded).toBe(false);
  await page.getByRole('button', { name: 'Walk me through a project folder of mine' }).click();

  // Settings were saved on the server, and the chat opens with that first question in it.
  await expect
    .poll(async () => (await request.get('/api/state')).json())
    .toMatchObject({
      onboarded: true,
      persona: { tone: 'concise' },
      profile: { name: 'Ada', about: 'I’d mostly like a hand with coding.' },
    });
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toHaveValue(
    'Walk me through a project folder of mine',
  );

  // Start an ordinary chat.
  await page.goto('/');
  // Empty chat greets by name.
  await expect(page.getByText(/Ada\./).first()).toBeVisible();

  // First message: memory + permission + streamed reply.
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('Please remember that I love espresso and list files');
  await composer.press('Enter');

  await expect(page).toHaveURL(/\/c\/c_/);
  // Remembering is a step of the run (ADR 0103), told on its story's row.
  await expect(page.getByRole('button', { name: /[Rr]emember(ed|ing) something/ })).toBeVisible();
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  // The answer folds into the call's story: the card goes.
  await expect(page.getByRole('group', { name: /asks first/ })).toHaveCount(0);
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
