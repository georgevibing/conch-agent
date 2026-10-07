import { expect, test, type Page } from '@playwright/test';

import { say } from './app';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** The sidebar's Tasks entry, whose badge counts what's working. */
const tasksLink = (page: Page) =>
  page.getByRole('navigation', { name: 'Conversations' }).getByRole('button', { name: /^Tasks/ });

/** The chat open right now, in the list, with whatever sits under it. */
const openChatRow = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Conversations' })
    .getByRole('listitem')
    .filter({ has: page.locator('[aria-current="page"]') });

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
  await expect(tasksLink(page).getByLabel('1 working')).toBeVisible();
  await expect(card).toContainText(/Running|Ran/);

  // The chat is still yours meanwhile.
  await composer.fill('what’s the weather like?');
  await composer.press('Enter');
  await expect(page.getByText('what’s the weather like?', { exact: true })).toBeVisible();

  await expect(card).toContainText(/Finished ·/, { timeout: 15_000 });
  await expect(card).toContainText('Finished: Run the checks slowly');
  await expect(card.getByRole('button', { name: 'Resume safely' })).toHaveCount(0);

  // Its own chat is no chat of the list's: it sits under the chat that sent it,
  // and opens from the card.
  await expect(
    page
      .getByRole('navigation', { name: 'Conversations' })
      .locator('[data-chat-link]')
      .filter({ hasText: 'Run the checks slowly' }),
  ).toHaveCount(0);
  await expect(openChatRow(page).getByRole('list', { name: /^Tasks from/ })).toContainText(
    'Run the checks slowly',
  );
  // It opens over the chat; its own chat is a press further, with the way back.
  await card.getByRole('button', { name: 'Open' }).click();
  const sheet = page.getByRole('dialog', { name: 'Run the checks slowly' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Continue in full' }).click();
  const strip = page.getByRole('navigation', { name: 'Task' });
  await expect(strip).toBeVisible();
  await strip.getByRole('link').click();
  await expect(page.getByText('what’s the weather like?', { exact: true })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Conversations' })
    .getByRole('button', { name: /^Tasks/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  const finished = page.getByRole('region', { name: 'Finished' }).getByRole('article', {
    name: 'Run the checks slowly',
  });
  await expect(finished).toContainText('Finished: Run the checks slowly');
  // What it did waits behind Details once it's done.
  await finished.getByRole('button', { name: 'Details' }).click();
  await expect(finished.getByRole('list', { name: 'What it did' })).toContainText('npm test');
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
  await card.getByRole('button', { name: 'Resume safely' }).click();
  await expect(card).toContainText('Running npm run watch');
  await card.getByRole('button', { name: 'Stop' }).click();
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(card).toHaveCount(0);
});

test('helpers work side by side on one card, open over the chat, and come back together', async ({
  page,
}) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('look over the project in parallel');
  await composer.press('Enter');
  // Started together: one card, a line each.
  const card = page.getByRole('article', { name: '3 tasks' });
  await expect(card).toBeVisible();
  for (const name of ['Read the README', 'Check the tests', 'Skim the changelog'])
    await expect(card.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByText('I split that into three')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Check the tests' })).toBeVisible();
  // All finished: the lines are the result.
  await expect(card).toContainText('3 done');
  await expect(card.getByRole('img', { name: /finished/ })).toHaveCount(0);

  // Each opens over the chat, the others a tap away; closing it is going back.
  const url = page.url();
  await card.getByRole('button', { name: /Check the tests/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Check the tests' });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/\?task=/);
  const tabs = sheet.getByRole('tablist', { name: '3 tasks started together' });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await tabs.getByRole('tab', { name: /Skim the changelog/ }).click();
  await expect(page.getByRole('dialog', { name: 'Skim the changelog' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'Check the tests' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(page.url()).toBe(url);
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
  await expect(tasksLink(page).getByLabel('1 need your OK')).toBeVisible();
  // Answered on its card, in the chat it came from: no need to go to its own chat.
  const ask = card.getByRole('group', { name: 'It’s asking' });
  await expect(ask).toContainText('git push');
  await ask.getByRole('button', { name: 'Allow' }).click();
  await expect(card).toContainText(/Finished ·/, { timeout: 15_000 });
});

test('a chat’s tasks sit under it in the sidebar, and open from there', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await say(page, 'hello', /Ask me to/);
  await composer.fill('Keep checking for a while');
  await composer.press(`${mod}+Shift+Enter`);
  const row = openChatRow(page);
  const toggle = row.getByRole('button', { name: /tasks from/ });
  // A badge on the chat's own row: how many, and in full to a screen reader.
  await expect(toggle).toHaveText('1');
  await expect(toggle).toHaveAccessibleName(/1 task · 1 working/);
  const tasks = row.getByRole('list', { name: /^Tasks from/ });
  await expect(tasks).toContainText('Keep checking for a while');
  await expect(tasks).toContainText('npm run watch');
  // Stopped from the list, and it opens from there, over the chat.
  await tasks.getByRole('button', { name: 'Stop' }).click();
  await expect(tasks).toContainText('Stopped');
  await tasks.getByRole('link', { name: /Keep checking for a while/ }).click();
  await expect(page.getByRole('dialog', { name: 'Keep checking for a while' })).toContainText(
    'Stopped',
  );
});
