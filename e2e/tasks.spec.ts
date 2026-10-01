import { expect, test } from '@playwright/test';

import { say } from './app';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Hand it off, end to end (ADR 0033): send something to the background and
 * keep chatting; its live card, the Tasks page and the result coming back;
 * stopping and trying again; helpers side by side; a task that needs your OK.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('sent to the background, it works while you chat, and its result comes back', async ({
  page,
}) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await say(page, 'hello', /Ask me to/);
  await expect(page).toHaveURL(/\/c\//);

  await composer.fill('Run the checks slowly');
  await page.getByRole('button', { name: 'Do it in the background' }).click();
  await expect(composer).toHaveValue('');
  const card = page.getByRole('article', { name: 'Run the checks slowly' });
  // The sidebar says something's working, while it is: the task is a short one.
  await expect(card).toContainText('Working');
  await expect(page.getByLabel('1 working')).toBeVisible();
  await expect(card).toContainText(/Running|Ran/);

  // The chat is still yours meanwhile.
  await composer.fill('what’s the weather like?');
  await composer.press('Enter');
  await expect(page.getByText('what’s the weather like?', { exact: true })).toBeVisible();

  await expect(card).toContainText('Done', { timeout: 15_000 });
  await expect(card).toContainText('Finished: Run the checks slowly');

  // Its own chat stays out of the list, and opens from the card.
  await expect(
    page.getByRole('navigation', { name: 'Conversations' }).getByRole('link', {
      name: 'Run the checks slowly',
    }),
  ).toHaveCount(0);
  await card.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('note')).toContainText('Working in the background.');
  await page.getByRole('link', { name: 'Back to the chat' }).click();
  await expect(page.getByText('what’s the weather like?', { exact: true })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Conversations' })
    .getByRole('button', { name: /^Tasks/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Finished' }).getByRole('article', {
      name: 'Run the checks slowly',
    }),
  ).toContainText('Finished: Run the checks slowly');
  await expect(page.getByRole('list', { name: 'What it did' })).toContainText('npm test');
});

test('a task stops when you say, runs again with one press, and goes when you remove it', async ({
  page,
}) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('Keep checking for a while');
  await composer.press(`${mod}+Shift+Enter`);
  await page
    .getByRole('navigation', { name: 'Conversations' })
    .getByRole('button', { name: /^Tasks/ })
    .click();
  const card = page.getByRole('article', { name: 'Keep checking for a while' });
  await expect(card).toContainText('Working');
  await expect(card).toContainText('Running npm run watch');
  await card.getByRole('button', { name: 'Stop' }).click();
  await expect(card).toContainText('Stopped');
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card).toContainText('Running npm run watch');
  await card.getByRole('button', { name: 'Stop' }).click();
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(card).toHaveCount(0);
});

test('helpers work side by side, each with its own card, and their results come back together', async ({
  page,
}) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('look over the project in parallel');
  await composer.press('Enter');
  for (const name of ['Read the README', 'Check the tests', 'Skim the changelog'])
    await expect(page.getByRole('article', { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByText('I split that into three')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Check the tests' })).toBeVisible();
  for (const name of ['Read the README', 'Check the tests', 'Skim the changelog'])
    await expect(page.getByRole('article', { name: new RegExp(name) })).toContainText('Done');
});

test('a task that needs your OK says so, and waits only for you', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await say(page, 'hi', /Ask me to/);
  await expect(page).toHaveURL(/\/c\//);
  await composer.fill('Ship it, but ask first');
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('background');
  await page.getByRole('option', { name: /Do it in the background/ }).click();
  const card = page.getByRole('article', { name: 'Ship it, but ask first' });
  await expect(card).toContainText('Needs your OK');
  await expect(page.getByLabel('1 need your OK')).toBeVisible();
  await card.getByRole('button', { name: 'See what it’s asking' }).click();
  const ask = page.getByRole('group', { name: 'Permission request' });
  await expect(ask).toContainText('git push');
  await ask
    .getByRole('button', { name: /^Allow/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Back to the chat' }).click();
  await expect(card).toContainText('Done', { timeout: 15_000 });
});
