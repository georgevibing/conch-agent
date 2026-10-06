import { expect, test } from '@playwright/test';

/**
 * A server of your own, end to end (ADR 0053), against a pretend llama.cpp
 * (e2e/fake-openai.ts): type its address, Conch says what answered, add it,
 * and its model is in the picker and answers — with Conch's tools.
 */
let address = '';

test.beforeAll(async ({ request }) => {
  const info = (await (await request.get('http://127.0.0.1:4357/')).json()) as {
    address: string;
  };
  address = info.address;
});

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('adds a server by its address, then chats with its model', async ({ page }) => {
  // Not pinned to the mock: the real providers on this computer are asked what
  // they offer, which is slow the first time and slower on a busy machine.
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: /Message/ })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Providers' }).click();

  // The gallery has it with the models on this computer.
  const tile = page.getByRole('article', { name: 'Another server' });
  await tile.getByRole('button', { name: 'Another server' }).click();

  // Conch looks as the address is typed, and says what it found before anything is added.
  const add = page.getByRole('button', { name: 'Add server' });
  await expect(add).toBeDisabled();
  await page.getByLabel('Address').fill(address);
  await expect(page.getByText('llama.cpp, with 1 model. Ready to add.')).toBeVisible();
  await add.click();
  await expect(page.getByRole('heading', { name: /llama\.cpp is connected/ })).toBeVisible();

  // Back to the chat: the picker lists its model under its name, and it answers.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model:/ }).click();
  // The picker's list is every provider on this computer saying what it offers:
  // the first one of a session asks the real programs, which can take a while.
  await expect(page.getByRole('group', { name: 'llama.cpp' })).toBeVisible({ timeout: 45_000 });
  await page.getByRole('group', { name: 'llama.cpp' }).getByRole('radio').first().click();
  await page.keyboard.press('Escape');

  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('Hello?');
  await composer.press('Enter');
  const reply = page.getByText(/Hello from your own server\. I have (\d+) tools\./);
  await expect(reply).toBeVisible();
  // Conch's own tools reach a server of your own.
  const tools = Number(/I have (\d+) tools/.exec((await reply.textContent()) ?? '')?.[1]);
  expect(tools).toBeGreaterThan(0);
});
