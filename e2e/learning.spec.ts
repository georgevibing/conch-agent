import { expect, test, type APIRequestContext } from '@playwright/test';

import { say } from './app';

/**
 * Quiet learning, end to end (ADR 0088): once a chat you were in goes quiet,
 * a correction in it is learned and said at its end, in one quiet line. Why?
 * shows your words; Undo takes it back, a reload still says so, and the same
 * correction in another chat isn't learned again. The mock engine's chats go
 * quiet after a few seconds.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

const remembers = async (request: APIRequestContext, content: string) =>
  ((await (await request.get('/api/memories')).json()) as { content: string }[]).some(
    (m) => m.content === content,
  );

test('a correction is learned once the chat goes quiet, with Why? and Undo, and never again', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await say(page, 'Write me a script to rename my photos', /Ask me to/);
  await say(page, 'No, I meant TypeScript.', /Ask me to/);

  // Nothing asks for attention while the chat goes on; once it's quiet, one line says so.
  const line = page.getByRole('group', { name: 'What Conch learned from this chat' });
  await expect(line).toBeVisible({ timeout: 40_000 });
  await expect(line).toContainText('Learned 1 thing');
  await expect.poll(() => remembers(request, 'Prefers TypeScript')).toBe(true);

  await line.getByRole('button', { name: /Learned 1 thing/ }).click();
  await expect(line).toContainText('Prefers TypeScript');
  await line.getByRole('button', { name: 'Why?' }).click();
  const why = page.getByRole('dialog');
  await expect(why).toContainText('No, I meant TypeScript');
  await expect(why).toContainText('You corrected it');
  await page.keyboard.press('Escape');

  await line.getByRole('button', { name: 'Undo' }).click();
  await expect(line).toContainText('Undone · won’t learn this again');
  await expect.poll(() => remembers(request, 'Prefers TypeScript')).toBe(false);
  // What you pressed is written into the chat: a reload says it again.
  await page.reload();
  const again = page.getByRole('group', { name: 'What Conch learned from this chat' });
  await again.getByRole('button', { name: /Learned 1 thing/ }).click();
  await expect(again).toContainText('Undone · won’t learn this again');

  // The Memory page lists it among what Conch won't learn again.
  const status = await (await request.get('/api/learning')).json();
  expect(status.never.map((n: { text: string }) => n.text)).toContain('Prefers TypeScript');

  // In another chat, the same correction isn't learned again.
  await page.goto('/');
  await say(page, 'Write me a script to tidy my downloads', /Ask me to/);
  await say(page, 'No, I meant TypeScript.', /Ask me to/);
  // Quiet for long enough to have been read, twice over.
  await page.waitForTimeout(20_000);
  await expect(page.getByRole('group', { name: 'What Conch learned from this chat' })).toHaveCount(
    0,
  );
  expect(await remembers(request, 'Prefers TypeScript')).toBe(false);
});

test('a chat marked not to learn from is left alone', async ({ page, request }) => {
  await page.goto('/');
  await say(page, 'Write me a poem about the sea', /Ask me to/);
  const id = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  await request.put(`/api/learning/chats/${id}`, { data: { quiet: true } });
  await say(page, 'No, I meant a haiku.', /Ask me to/);
  await page.waitForTimeout(20_000);
  await expect(page.getByRole('group', { name: 'What Conch learned from this chat' })).toHaveCount(
    0,
  );
  expect(await remembers(request, 'Prefers a haiku')).toBe(false);
});
