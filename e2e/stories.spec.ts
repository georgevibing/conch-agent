import { expect, test } from '@playwright/test';

/**
 * The chat tells what the assistant is doing (ADR 0103), end to end with the
 * mock engine's "look around": three steps told as a story with the
 * provider's own words while it runs, the steps in plain words when opened,
 * Why? answered from the chat's log, and the exact call one press further.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('a run of steps is one story: its steps in words, Why?, and the exact call', async ({
  page,
}) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('Please look around the project');
  await composer.press('Enter');
  await expect(page.getByText('a small garden planner', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Stop/ })).toHaveCount(0);

  // No raw tool names in the chat: one line that says what happened.
  const story = page.locator('[data-story]');
  await expect(story).toHaveCount(1);
  await expect(story).toHaveAttribute('data-status', 'done');
  await expect(page.getByText('Bash', { exact: true })).toHaveCount(0);

  await story.getByRole('button').first().click();
  const steps = story.getByRole('list', { name: 'Steps' });
  await expect(steps.getByRole('listitem')).toHaveCount(3);
  await expect(steps).toContainText('package.json');

  // Why? answers from the chat's log, in plain words, without stopping anything.
  await steps.getByRole('button', { name: 'Why?' }).first().click();
  await expect(
    steps.getByText('It did this to see what was there', { exact: false }),
  ).toBeVisible();

  // The exact call: what was typed and what came back.
  await steps.getByRole('listitem').first().getByRole('button').first().click();
  await expect(story.getByRole('region', { name: 'Output' })).toContainText('garden');
});
