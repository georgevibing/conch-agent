import { expect, type Page, test } from '@playwright/test';

/**
 * A model that can only chat (ADR 0050). The mock's Chat Lite can't use apps:
 * the picker says so, and a message that needs a connected app waits with a
 * one-tap switch to a model that can. Switching sends it by itself, once, and
 * the app's tool really runs (the pretend Linear, through Conch's bridge).
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', {
    data: { onboarded: true, profile: { name: 'Ada' }, preferences: { mutedSuggestions: [] } },
  });
  for (const i of (await (await request.get('/api/integrations')).json()).integrations) {
    await request.delete(`/api/integrations/${i.id}`);
  }
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });

async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await page.keyboard.press('Enter');
}

/** Connect the pretend Linear from the chat's offer: real OAuth, in a popup. */
async function connectLinear(page: Page) {
  await page.goto('/');
  await ask(page, 'what’s assigned to me in Linear this week?');
  const card = page.getByRole('group', { name: 'Linear isn’t connected yet' });
  await card.getByRole('button', { name: 'Connect Linear' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Linear' });
  const popupOpened = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Continue with Linear' }).click();
  const popup = await popupOpened;
  await popup.getByRole('button', { name: 'Allow' }).click();
  await popup.waitForEvent('close', { timeout: 5000 }).catch(() => undefined);
  // Connected: the dialog closes and the chat carries on by itself (ADR 0060).
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('I found 3 results')).toBeVisible({ timeout: 20_000 });
}

test('a chat-only model offers one that can use the app, switches, and sends it once', async ({
  page,
  request,
}) => {
  await connectLinear(page);

  // A new chat, on the model that can only chat: the picker says so.
  await page.goto('/');
  await page.getByRole('button', { name: /^Model:/ }).click();
  const lite = page.getByRole('radio', { name: /^Chat Lite/ });
  await expect(lite).toContainText('Chat only — can’t use your apps');
  await expect(page.getByRole('radio', { name: /^Opus 5\.5/ })).not.toContainText('Chat only');
  await lite.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Model: Chat Lite/ })).toBeVisible();

  // Asking about Linear: it waits, with the switch right there.
  await ask(page, 'what’s assigned to me in Linear this week?');
  const card = page.getByRole('group', { name: 'Chat Lite can’t use Linear' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Opus 5.5 can. Switch, and your message goes by itself.');
  await expect(page.getByText('I found 3 results')).toHaveCount(0);

  // One tap: the chat switches, the message goes by itself, and Linear really answers.
  await card.getByRole('button', { name: 'Switch to Opus 5.5' }).click();
  await expect(page.getByText('I found 3 results')).toBeVisible();
  await expect(page.getByText('Switched to Opus 5.5 to use Linear')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Model: Opus 5\.5/ })).toBeVisible();
  await expect(page.getByText('what’s assigned to me in Linear this week?')).toHaveCount(1);

  // The chat keeps the model, and its log says what happened — a reload shows the same.
  const id = page.url().split('/c/')[1] ?? '';
  const detail = await (await request.get(`/api/conversations/${id}`)).json();
  expect(detail.conversation.options).toMatchObject({ engine: 'mock', model: 'opus' });
  expect(
    detail.events.filter((e: { type: string }) => e.type === 'tool.started').length,
  ).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByText('Switched to Opus 5.5 to use Linear')).toBeVisible();
  await expect(page.getByText('I found 3 results')).toBeVisible();
});

test('“Answer without it” keeps the model, and it isn’t asked again in that chat', async ({
  page,
}) => {
  await connectLinear(page);
  await page.goto('/');
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.getByRole('radio', { name: /^Chat Lite/ }).click();
  await page.keyboard.press('Escape');

  await ask(page, 'search Linear for the launch issue');
  const card = page.getByRole('group', { name: 'Chat Lite can’t use Linear' });
  await card.getByRole('button', { name: 'Answer without it' }).click();
  await expect(page.getByText('Answered without Linear')).toBeVisible();
  // It answered as a model that can only chat: no app was used.
  await expect(page.getByText('I found 3 results')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Model: Chat Lite/ })).toBeVisible();

  // Asked once per model in a chat: the next message about it just goes.
  await ask(page, 'and Linear tickets for next week?');
  await expect(page.getByText('and Linear tickets for next week?')).toBeVisible();
  await expect(page.getByRole('group', { name: /can’t use Linear/ })).toHaveCount(0);
});
