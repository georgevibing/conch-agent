import { expect, test } from '@playwright/test';

import { say } from './app';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * It learns you, end to end (ADR 0032): a memory learned after reading a page
 * is remembered where you can see it, with Undo; the tidy-up merges repeats and updates what changed, with
 * Undo; what Conch knows is searchable and exportable; something asked for in
 * three chats is offered as a skill, never saved by itself.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('remembering after reading a page says so in the chat, and Undo forgets it', async ({
  page,
  request,
}) => {
  const recall = async () =>
    (await (await request.get('/api/memories/search?q=invoices')).json()).results.length;
  await page.goto('/');
  await say(page, 'read https://news.example/today and summarise it', /Ask me to/);
  await expect(page.getByText(/Read news\.example\./)).toBeVisible();
  // "Sent to", not "go to": the pretend assistant takes "go to" and an address as a page to open.
  await say(page, 'remember that invoices are sent to billing@news.example', /Got it/);

  // Someone is watching this chat, so it's remembered at once, where they can see it and undo it.
  await expect(page.getByText('Remembered', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep' })).toHaveCount(0);
  await expect.poll(recall).toBe(1);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Forgot', { exact: true })).toBeVisible();
  await expect.poll(recall).toBe(0);
  // What you pressed is written into the chat, so a reload shows it again.
  await page.reload();
  await expect(page.getByText('Forgot', { exact: true })).toBeVisible();
});

test('the tidy-up merges repeats and updates what changed, every change with Undo', async ({
  page,
  request,
}) => {
  await request.post('/api/memories', { data: { content: 'Prefers dark roast coffee' } });
  await request.post('/api/memories', { data: { content: 'prefers dark-roast coffee!' } });
  await request.post('/api/memories', { data: { content: 'Lives in Berlin' } });
  await page.goto('/');
  await say(page, 'I moved to Lisbon. Any tips for the first week?', /Ask me to/);

  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('tidy');
  await page.getByRole('option', { name: /Tidy up memories/ }).click();
  const report = page.getByRole('region', { name: 'Conch tidied 2 memories' });
  await expect(report).toBeVisible({ timeout: 20_000 });
  await expect(report).toContainText('Was: Lives in Berlin');
  await expect(report).toContainText('Now: Lives in Lisbon');
  await expect(report).toContainText('They said the same thing.');

  const memories = page.getByRole('list', { name: 'Memories' });
  await expect(memories).toContainText('Lives in Lisbon');
  await expect(memories.getByText(/coffee/)).toHaveCount(1);

  // Undo the merge: both come back, as they were.
  const merged = report.getByRole('listitem').filter({ hasText: 'Merged' });
  await merged.getByRole('button', { name: 'Undo' }).click();
  await expect(merged).toContainText('Undone');
  await expect(memories.getByText(/coffee/)).toHaveCount(2);

  // Search forgives the typo; the switch for every night is right here.
  await page.getByRole('textbox', { name: 'Search memories' }).fill('lisbn');
  await expect(memories.getByRole('listitem')).toHaveCount(1);
  await expect(memories).toContainText('Lives in Lisbon');
  await expect(page.getByRole('switch', { name: /Tidy up every night/ })).not.toBeChecked();

  // Yours to take: a document of everything kept.
  const exported = await request.get('/api/memories/export');
  expect(exported.headers()['content-disposition']).toMatch(/conch-memories-.*\.md/);
  expect(await exported.text()).toContain('- Lives in Lisbon');
});

test('asked for in three chats, it’s offered as a skill — a draft to read, never saved by itself', async ({
  page,
  request,
}) => {
  for (const words of [
    'Write my weekly summary of calendar meetings',
    'write the weekly summary of my calendar meetings',
    'Please write my weekly calendar summary of meetings',
  ]) {
    await page.goto('/');
    await say(page, words, /Ask me to/);
  }
  await page.goto('/skills');
  const card = page.getByRole('region', {
    name: 'You’ve asked for this in 3 chats. Save “Weekly summary” as a skill?',
  });
  await expect(card).toBeVisible({ timeout: 20_000 });
  const before = (await (await request.get('/api/skills')).json()).skills.length;
  await card.getByRole('button', { name: 'Look at the draft' }).click();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Weekly summary');
  await expect(page.getByRole('textbox', { name: /What should/ })).toHaveValue(
    /five bullet points/,
  );
  await expect(page.getByRole('radio', { name: 'When I ask' })).toBeChecked();
  expect((await (await request.get('/api/skills')).json()).skills).toHaveLength(before);

  // Turned down for good, it stays down.
  await page.goto('/skills');
  await page.getByRole('button', { name: 'Don’t suggest this' }).click();
  await expect(card).toHaveCount(0);
  const again = await (await request.get('/api/skills/suggestions?fresh=1')).json();
  expect(again.suggestions).toEqual([]);
});
