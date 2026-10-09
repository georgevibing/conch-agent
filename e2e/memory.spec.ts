import { expect, test } from '@playwright/test';

import { say } from './app';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * It learns you, end to end (ADR 0032, ADR 0097): a memory a page planted is
 * held and asked about (ADR 0087), an ordinary one learned after reading is
 * remembered where you can see it, with Undo; the tidy-up quietly merges
 * repeats and updates what changed, and the last one can be undone; what
 * Conch knows is searchable and exportable; something asked for in three
 * chats is offered as a skill, never saved by itself.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('a memory a page planted is held and asked about, never used until you say (ADR 0087)', async ({
  page,
  request,
}) => {
  const recall = async () =>
    (await (await request.get('/api/memories/search?q=invoices')).json()).results.length;
  await page.goto('/');
  await say(page, 'read https://news.example/today and summarise it', /Ask me to/);
  await expect(page.getByText(/Read news\.example\./)).toBeVisible();
  // The page told the assistant where invoices go; it took the bait.
  await say(page, 'remember what the page says about invoices', /Got it/);

  const card = page.getByRole('region', { name: 'Remember this?' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Invoices are sent to billing@news.example');
  await expect(card).toContainText(
    'This came from news.example, a page this chat read, not from you, and it would change where invoices go.',
  );
  await expect(card).toContainText('From news.example, a page this chat read');
  await expect(page.getByRole('button', { name: /^Remembered something/ })).toHaveCount(0);
  // Held, not saved: recall doesn't find it.
  expect(await recall()).toBe(0);

  // The same question comes first on What Conch knows.
  await page.goto('/memory');
  const waiting = page.getByRole('region', { name: 'Needs you' });
  await expect(waiting).toContainText('it would change where invoices go');
  await page.goBack();

  await page
    .getByRole('region', { name: 'Remember this?' })
    .getByRole('button', { name: 'Don’t remember' })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Not remembered' })).toBeVisible();
  expect(await recall()).toBe(0);
  // What you chose is written into the chat, so a reload shows it again.
  await page.reload();
  await expect(page.getByText(/Not remembered: Invoices are sent/)).toBeVisible();
});

test('an ordinary memory after reading is remembered at once, and Undo forgets it', async ({
  page,
  request,
}) => {
  const recall = async () =>
    (await (await request.get('/api/memories/search?q=summaries')).json()).results.length;
  await page.goto('/');
  await say(page, 'read https://news.example/today and summarise it', /Ask me to/);
  await expect(page.getByText(/Read news\.example\./)).toBeVisible();
  await say(page, 'remember that I prefer short summaries', /Got it/);

  // Someone is watching this chat, so it's remembered at once, where they can see it and undo it.
  // A step like any other (ADR 0103): its row opens to the memory, and Undo is there.
  const step = page.getByRole('button', { name: /^Remembered something/ });
  await expect(step).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Remember this?' })).toHaveCount(0);
  await expect.poll(recall).toBe(1);

  await step.click();
  await page.getByRole('button', { name: 'Undo “I prefer short summaries”' }).click();
  await expect(page.getByRole('button', { name: /^Remembered something\s+Undone/ })).toBeVisible();
  await expect.poll(recall).toBe(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Remembered something\s+Undone/ })).toBeVisible();
});

test('the tidy-up quietly merges repeats and updates what changed, and can be undone', async ({
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

  // No report, no Keep: what it knows is simply up to date.
  const memories = page.getByRole('list', { name: 'Memories' });
  await expect(memories).toContainText('Lives in Lisbon', { timeout: 20_000 });
  await expect(memories.getByText(/coffee/)).toHaveCount(1);
  await expect(memories).not.toContainText('Lives in Berlin');
  await expect(page.getByRole('button', { name: 'Keep', exact: true })).toHaveCount(0);

  // The last tidy-up is one press from undone: both come back, as they were.
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Undo the last tidy-up' }).click();
  await expect(memories.getByText(/coffee/)).toHaveCount(2);
  await expect(memories).toContainText('Lives in Berlin');

  // Search forgives the typo.
  await page.getByRole('textbox', { name: 'Search, or remember something new' }).fill('berln');
  await expect(memories.getByRole('listitem').filter({ hasText: 'Lives in' })).toHaveCount(1);

  // Yours to take: a document of everything kept.
  const exported = await request.get('/api/memories/export');
  expect(exported.headers()['content-disposition']).toMatch(/conch-memories-.*\.md/);
  expect(await exported.text()).toContain('- Lives in Berlin');
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
