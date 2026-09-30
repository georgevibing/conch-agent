import { expect, test } from '@playwright/test';

/**
 * A model on this computer, end to end, against a pretend Ollama
 * (e2e/fake-ollama.ts): get a model with real progress, pick it, and chat with
 * it — with Conch's tools and a real context size, and nothing on the internet.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('gets a model with progress, then chats with it', async ({ page }) => {
  await page.goto('/');
  // The app is up (its shortcuts listen) once the message box is there.
  await expect(page.getByRole('textbox', { name: /Message/ })).toBeVisible();
  // ⌘K finds it by the words people use.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('offline');
  await page.getByRole('option', { name: /Model on this computer/ }).click();

  const region = page.getByRole('region', { name: 'Run a model on this computer' });
  const steps = region.getByRole('list', { name: 'What a model on this computer needs' });
  // Ollama is already here (the pretend one), so the model is the next thing.
  await expect(steps).toContainText('Done: Ollama');
  await expect(region).toContainText('Slower and less capable than the big cloud models');

  const get = region.getByRole('button', { name: /^Get / });
  const name = ((await get.textContent()) ?? '').replace(/^Get /, '').trim();
  await get.click();
  // Real progress: bytes, then done.
  await expect(region.getByText(/GB of 2\.5 GB/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your model on this computer' })).toBeVisible({
    timeout: 20_000,
  });
  const models = page.getByRole('radiogroup', { name: 'Models on this computer' });
  await expect(models.getByRole('radio', { name: new RegExp(name) })).toBeChecked();

  // Back to the chat: the picker lists it under its provider, and it answers.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model:/ }).click();
  await expect(page.getByRole('group', { name: 'On this computer' })).toContainText(name);
  await page.keyboard.press('Escape');

  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('Hello?');
  await composer.press('Enter');
  const reply = page.getByText(/Hello from the model on this computer\. I have (\d+) tools/);
  // Read it once it has finished arriving, not mid-stream.
  await expect(reply).toContainText(/tokens of context\./);
  // Conch's own tools reach a local model, with room for them in the context.
  const text = (await reply.textContent()) ?? '';
  expect(Number(/I have (\d+) tools/.exec(text)?.[1])).toBeGreaterThan(0);
  expect(Number(/and (\d+) tokens/.exec(text)?.[1])).toBeGreaterThanOrEqual(16_384);
});
