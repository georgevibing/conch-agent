import { expect, test } from '@playwright/test';

import { openConch, say } from './app';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Search by meaning, end to end (ADR 0041), with the mock engine's pretend
 * model and pretend Hugging Face (`engines/mock/meaning.ts`): the real
 * download, progress and hashes, nothing from the internet. Before anything
 * is downloaded a few everyday ideas already match; the offer says how big
 * the model is and that it stays here; one press gets it; then search finds
 * what you meant, and requests worded three ways become one skill suggestion.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('on a phone, the offer fits and its button is in reach', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/memory');
  await expect(page.getByText(/Search by meaning, too/)).toBeVisible();
  const button = page.getByRole('button', { name: 'Get it' });
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('before any download, a few everyday ideas match; the offer asks first, then one press gets meaning', async ({
  page,
  request,
}) => {
  for (const content of [
    'Got married on 12 June 2019 in Porto',
    'Drives a red vehicle to work',
    'Prefers dark roast coffee',
  ])
    await request.post('/api/memories', { data: { content } });

  await openConch(page);
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('meaning');
  await page.getByRole('option', { name: /Search memories by meaning/ }).click();
  const get = page.getByRole('button', { name: 'Get it' });
  await expect(page.getByText(/Search by meaning, too · .*stays on this computer/)).toBeVisible();
  // ⌘K brought you to the one button, without pressing it for you.
  await expect(get).toBeFocused();
  expect((await (await request.get('/api/memory/index')).json()).mode).toBe('words');

  // Words, spellings and a few concepts: "car" finds the vehicle already.
  const search = page.getByRole('textbox', { name: 'Search, or remember something new' });
  const memories = page.getByRole('list', { name: 'Memories' });
  const found = () => memories.getByRole('listitem').filter({ hasNotText: 'Remember' });
  await search.fill('my car');
  await expect(found()).toHaveCount(1);
  await expect(memories).toContainText('Drives a red vehicle to work');
  // What only a model knows isn't found yet.
  await search.fill('when did we tie the knot');
  await expect(found()).toHaveCount(0);

  await get.click();
  await expect(page.getByRole('progressbar', { name: /Downloaded/ })).toBeVisible();
  // Once it's there, the offer has nothing more to say.
  await expect(page.getByText(/Search by meaning/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 20_000 });

  // Now the same words find what you meant.
  await search.fill('');
  await search.fill('when did we tie the knot');
  await expect(found().first()).toContainText('Got married');
  const results = await (
    await request.get(`/api/memories/search?q=${encodeURIComponent('when did we tie the knot')}`)
  ).json();
  expect(results.results[0].content).toMatch(/married/);

  // Repair everything sees it, and it's fine.
  await request.post('/api/doctor/check');
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/doctor')).json()).items?.find(
          (i: { id: string }) => i.id === 'memory:index',
        )?.message,
      { timeout: 20_000 },
    )
    .toMatch(/Searches by meaning, with pretend-MiniLM/);
});

test('asked for in three chats in three different ways, it’s one suggestion — a draft, never saved by itself', async ({
  page,
  request,
}) => {
  // The model is here (the first journey got it, or this one does).
  await request.post('/api/memory/index/model', { data: { languages: ['en-GB'] } });
  await expect
    .poll(async () => (await (await request.get('/api/memory/index')).json()).mode, {
      timeout: 20_000,
    })
    .toBe('meaning');

  for (const words of [
    'Write my weekly summary of calendar meetings',
    'Give me a recap of the things on my calendar',
    'What happened at work these last days? A round-up please',
    'What is the weather like in Lisbon tomorrow',
  ]) {
    await page.goto('/');
    await say(page, words, /Ask me to/);
  }
  await page.goto('/skills');
  const card = page.getByRole('region', {
    name: 'You’ve asked for this in 3 chats. Save “Weekly summary” as a skill?',
  });
  await expect(card).toBeVisible({ timeout: 20_000 });
  const asked = card.getByRole('list', { name: 'What you asked' });
  await expect(asked).toContainText('Give me a recap');
  await expect(asked).toContainText('round-up');
  await expect(asked).not.toContainText('weather');
  const before = (await (await request.get('/api/skills')).json()).skills.length;
  await card.getByRole('button', { name: 'Look at the draft' }).click();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Weekly summary');
  await expect(page.getByRole('radio', { name: 'When I ask' })).toBeChecked();
  expect((await (await request.get('/api/skills')).json()).skills).toHaveLength(before);
});
