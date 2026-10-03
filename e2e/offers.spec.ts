import { expect, test } from '@playwright/test';

import { openConch, say } from './app';

/**
 * The chat knows Conch (ADR 0060). Asked something an app or a skill that
 * isn't on would answer, the assistant offers it under its reply; taking the
 * offer carries the chat on by itself, with no second question. In mock mode
 * Linear is the pretend vendor (real OAuth, a consent page, real MCP), and
 * the mock offers it for "what's on my plate", and a skill for "plan my week".
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', {
    data: { onboarded: true, profile: { name: 'Ada' }, preferences: { mutedSuggestions: [] } },
  });
  for (const i of (await (await request.get('/api/integrations')).json()).integrations)
    await request.delete(`/api/integrations/${i.id}`);
  for (const s of (await (await request.get('/api/skills')).json()).skills)
    await request.delete(`/api/skills/${s.id}`);
});

test('the assistant offers Linear; connecting it carries the chat on by itself', async ({
  page,
}) => {
  await openConch(page);
  await say(page, 'what’s on my plate this week?', 'Connect Linear and I’ll look');

  // Nobody named Linear: the assistant offered it, in its own words, under its reply.
  const card = page.getByRole('group', { name: 'Linear isn’t connected yet' });
  await expect(card).toContainText('Your Linear issues would show what’s on your plate.');
  const chat = page.url();

  // Connect opens the connect dialog in place; the sign-in happens in a popup.
  await card.getByRole('button', { name: 'Connect Linear' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Linear' });
  const popupOpened = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Continue with Linear' }).click();
  const popup = await popupOpened;
  await popup.getByRole('button', { name: 'Allow' }).click();
  await popup.waitForEvent('close', { timeout: 5000 }).catch(() => undefined);

  // Nothing more to press: the dialog closes, a quiet line says so, and the answer comes.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Connected Linear' })).toContainText(
    'carrying on',
  );
  await expect(page.getByText('I found 3 results')).toBeVisible({ timeout: 20_000 });
  expect(page.url()).toBe(chat);
  // No second question of yours.
  await expect(page.getByText('what’s on my plate this week?')).toHaveCount(1);

  // What else it can do: a chip sends exactly its words.
  const also = page.getByRole('group', { name: 'Also try' });
  await expect(also.getByRole('button')).toHaveCount(2);
  await also.getByRole('button', { name: 'What’s assigned to me this cycle?' }).click();
  await expect(page.getByText('What’s assigned to me this cycle?')).toHaveCount(1);
  // Something newer is in the chat: the chips have gone.
  await expect(also).toHaveCount(0);

  // It's the conversation's log: a reload shows the same.
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Connected Linear' })).toBeVisible();
  await expect(page.getByRole('group', { name: /Linear isn’t connected/ })).toHaveCount(0);
});

test('a skill that’s off shows what it may do, turns on, and the chat carries on', async ({
  page,
  request,
}) => {
  await request.post('/api/skills', {
    data: {
      title: 'Weekly review',
      description: 'Plans the week the way I like it.',
      instructions: 'Plan the week: the hard thing first, on Monday.',
      mode: 'off',
    },
  });
  await openConch(page);
  await say(page, 'plan my week', 'Turn it on and I’ll use it');

  const card = page.getByRole('group', { name: 'The “Weekly review” skill is off' });
  await card.getByRole('button', { name: 'Turn on Weekly review' }).click();
  // What it may do, in place, before anything is on.
  await expect(card.getByRole('region', { name: 'What Weekly review can do' })).toBeVisible();
  await card.getByRole('button', { name: 'Turn on Weekly review' }).click();

  await expect(
    page.getByRole('status').filter({ hasText: 'Turned on Weekly review' }),
  ).toBeVisible();
  await expect(page.getByText('Here’s your week, planned with “Weekly review”')).toBeVisible({
    timeout: 20_000,
  });
  const skills = (await (await request.get('/api/skills')).json()).skills as {
    title: string;
    mode: string;
  }[];
  expect(skills.find((s) => s.title === 'Weekly review')?.mode).toBe('auto');
});

test('Not now puts an offer away; a newer message overtakes one nobody answered', async ({
  page,
}) => {
  await openConch(page);
  await say(page, 'what’s on my plate this week?', 'Connect Linear and I’ll look');
  await page
    .getByRole('group', { name: 'Linear isn’t connected yet' })
    .getByRole('button', { name: 'Not now' })
    .click();
  await expect(page.getByRole('group', { name: /Linear/ })).toHaveCount(0);

  await page.goto('/');
  await say(page, 'what’s on my plate this week?', 'Connect Linear and I’ll look');
  await expect(page.getByRole('group', { name: 'Linear isn’t connected yet' })).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('never mind');
  await composer.press('Enter');
  await expect(
    page.getByRole('note').filter({ hasText: 'Offered to connect Linear' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Linear' })).toHaveCount(0);
});
