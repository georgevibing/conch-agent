import { expect, test, type APIRequestContext } from '@playwright/test';

import { say } from './app';

/**
 * Quiet learning, end to end (ADR 0088, ADR 0097): once a chat you were in
 * goes quiet, a correction in it is learned silently — nothing in the chat
 * asks or announces it. What Conch knows lists it; Forget there takes it back,
 * and the same correction in another chat isn't learned again. The mock
 * engine's chats go quiet after a few seconds.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

const remembers = async (request: APIRequestContext, content: string) =>
  ((await (await request.get('/api/memories')).json()) as { content: string }[]).some(
    (m) => m.content === content,
  );

test('a correction is learned silently once the chat goes quiet, forgotten for good from Memory', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await say(page, 'Write me a script to rename my photos', /Ask me to/);
  await say(page, 'No, I meant TypeScript.', /Ask me to/);

  // Learned once the chat is quiet, and nothing in the chat says so.
  await expect.poll(() => remembers(request, 'Prefers TypeScript'), { timeout: 40_000 }).toBe(true);
  await expect(page.getByRole('group', { name: 'What Conch learned from this chat' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('region', { name: 'Remember this?' })).toHaveCount(0);

  // What Conch knows lists it; Forget takes it back.
  await page.goto('/memory');
  const memories = page.getByRole('list', { name: 'Memories' });
  await expect(memories).toContainText('Prefers TypeScript');
  await memories.getByRole('button', { name: 'Forget: Prefers TypeScript' }).click();
  await expect.poll(() => remembers(request, 'Prefers TypeScript')).toBe(false);
  const status = await (await request.get('/api/learning')).json();
  expect(status.never.map((n: { text: string }) => n.text)).toContain('Prefers TypeScript');

  // In another chat, the same correction isn't learned again.
  await page.goto('/');
  await say(page, 'Write me a script to tidy my downloads', /Ask me to/);
  await say(page, 'No, I meant TypeScript.', /Ask me to/);
  // Quiet for long enough to have been read, twice over.
  await page.waitForTimeout(20_000);
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
