import { expect, test } from '@playwright/test';

/**
 * Model, thinking and mode choices — from the pickers and from slash commands —
 * reach the engine (the mock echoes what it received), and defaults persist.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('slash commands and pickers configure the next reply', async ({ page, request }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });

  // "/" opens the command menu; Escape closes it.
  await composer.fill('/');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('option', { name: /\/model/ })).toBeVisible();
  await composer.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();

  // /effort and /mode never reach the model — they configure it.
  await composer.fill('/effort high');
  await composer.press('Enter');
  await expect(page.getByText('Thinking: High')).toBeVisible();
  await composer.fill('/mode plan');
  await composer.press('Enter');
  await expect(page.getByRole('button', { name: /Plan only/ })).toBeVisible();

  // Pick a model from the picker.
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.getByRole('radio', { name: /^Opus 5\.5/ }).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: /^Model: Opus 5\.5, High thinking/ }),
  ).toBeVisible();

  await composer.fill('What should I cook tonight?');
  await composer.press('Enter');
  await expect(page.getByText('opus · high effort · plan', { exact: false })).toBeVisible();

  // The choices stick to this conversation…
  const [conversation] = await (await request.get('/api/conversations')).json();
  expect(conversation.options).toMatchObject({
    model: 'opus',
    effort: 'high',
    permissionMode: 'plan',
  });

  // …and a new chat starts from the defaults again.
  await composer.fill('/new');
  await composer.press('Enter');
  await expect(page.getByRole('button', { name: /^Model: Default/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ask first/ })).toBeVisible();
});

test('make default and custom commands', async ({ page, request }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });

  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.getByRole('radio', { name: /Sonnet 5\.5/ }).click();
  await page.getByRole('button', { name: /Make this my default/ }).click();
  await expect
    .poll(async () => (await (await request.get('/api/state')).json()).preferences.model)
    .toBe('sonnet');
  await page.keyboard.press('Escape');

  // A starter command expands its template before sending.
  await composer.fill('/explain monads');
  await composer.press('Enter');
  await expect(page.getByText('Explain monads simply', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('sonnet · auto effort', { exact: false })).toBeVisible();

  // Unknown commands don't get sent.
  await composer.fill('/definitely-not-a-command');
  await composer.press('Enter');
  await expect(page.getByText('There’s no /definitely-not-a-command command')).toBeVisible();
});
