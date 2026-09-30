import { expect, type Page, test } from '@playwright/test';

/**
 * Connect from the chat. Asking about an app that isn't connected offers to
 * connect it right there; the mock engine answers the way the prompt asks a
 * real model to, and in mock mode Linear, Notion and Canva are the pretend
 * vendor (real OAuth, a consent page, real MCP).
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

test('ask about Linear, connect it without leaving the chat, and ask again', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'what’s assigned to me in Linear this week?');

  // The reply doesn't make anything up; the offer sits under it.
  await expect(page.getByText('I can’t see your Linear yet')).toBeVisible();
  const card = page.getByRole('group', { name: 'Linear isn’t connected yet' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Connect it and Conch can find, create and update issues');
  const chat = page.url();
  expect(chat).toMatch(/\/c\//);

  // Connect opens the connect dialog in place; the sign-in happens in a popup.
  await card.getByRole('button', { name: 'Connect Linear' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Linear' });
  const popupOpened = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Continue with Linear' }).click();
  const popup = await popupOpened;
  await popup.getByRole('button', { name: 'Allow' }).click();
  const connected = page.getByRole('dialog', { name: 'Linear is connected' });
  await expect(connected).toBeVisible();
  await popup.waitForEvent('close', { timeout: 5000 }).catch(() => undefined);
  expect(page.url()).toBe(chat);

  // Ask again: the same question, and this time the answer uses Linear.
  await connected.getByRole('button', { name: 'Ask again' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('I found 3 results')).toBeVisible();
  await expect(page.getByText('what’s assigned to me in Linear this week?')).toHaveCount(2);
  // The offer settles: connected, nothing left to press.
  const settled = page.getByRole('group', { name: 'Linear is connected' });
  await expect(settled).toBeVisible();
  await expect(settled.getByRole('button')).toHaveCount(0);

  // It's part of the conversation's log: a reload shows the same.
  await page.reload();
  await expect(page.getByRole('group', { name: 'Linear is connected' })).toBeVisible();
  await expect(page.getByText('I found 3 results')).toBeVisible();
});

test('“Not now” is for this chat; “Don’t suggest” is for good, until you undo it', async ({
  page,
}) => {
  await page.goto('/');
  await ask(page, 'save this to notion');
  const notion = page.getByRole('group', { name: 'Notion isn’t connected yet' });
  await expect(notion).toBeVisible();
  await notion.getByRole('button', { name: 'Not now' }).click();
  await expect(notion).toHaveCount(0);
  await expect(composer(page)).toBeFocused();
  await page.reload();
  await expect(page.getByText('I can’t see your Notion yet')).toBeVisible();
  await expect(page.getByRole('group', { name: /Notion/ })).toHaveCount(0);

  // Once per app per chat: asking again about Notion here offers nothing,
  // though the assistant still says it can't see it rather than making it up.
  await ask(page, 'what’s in my Notion wiki about onboarding?');
  await expect(page.getByText('I can’t see your Notion yet')).toHaveCount(2);
  await expect(page.getByRole('group', { name: /Notion/ })).toHaveCount(0);

  await ask(page, 'find my Canva designs for the bake sale');
  const canva = page.getByRole('group', { name: 'Canva isn’t connected yet' });
  await expect(canva).toBeVisible();
  await canva.getByRole('button', { name: 'Don’t suggest Canva' }).click();
  await expect(page.getByText('Conch won’t suggest Canva again.')).toBeVisible();

  // Anywhere else too.
  await page.goto('/');
  await ask(page, 'make an Instagram post in Canva');
  await expect(page.getByText('I can’t see your Canva yet')).toBeVisible();
  await expect(page.getByRole('group', { name: /Canva/ })).toHaveCount(0);

  // Settings lists it, with a way back.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Models & modes' }).click();
  const muted = page.getByRole('list', { name: 'Apps not suggested' });
  await expect(muted.getByText('Canva')).toBeVisible();
  await muted.getByRole('button', { name: 'Suggest Canva again' }).click();
  await expect(page.getByText('On for every app.')).toBeVisible();
});
