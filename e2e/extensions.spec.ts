import { expect, test, type Page } from '@playwright/test';

/**
 * Providers and chat apps made with Conch (ADR 0122), end to end on the real
 * parts: the mock engine makes them the maker's real way, on the pretend
 * world it starts (`GET /api/channels/mock` → `pretend`): Pretend AI, a model
 * company that speaks OpenAI's chat, and Parley, a chat app with a bot API.
 * The card tests each live with what the person types, Add keeps it in
 * Conch, the provider answers a chat from the model picker, and a hello
 * comes through Parley into the same channels every built-in uses.
 */
const PRETEND_AI_KEY = 'pai-' + 'pretendpretendpretend0001';
const PARLEY_TOKEN = 'parley-' + 'bottokenbottoken0001';
let PRETEND = '';

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  const mocks = (await (await request.get('/api/channels/mock')).json()) as Record<string, string>;
  PRETEND = mocks.pretend ?? '';
  await request.post(`${PRETEND}/__control/reset`);
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });

test('make a provider with Conch, test it, add it, and chat with it', async ({ page }) => {
  await page.goto('/');
  await composer(page).fill('add Pretend AI as a provider');
  await composer(page).press('Enter');
  await expect(page.getByText(/Paste your Pretend AI key into the card/)).toBeVisible({
    timeout: 30_000,
  });

  const card = page.getByRole('group', { name: 'Pretend AI' });
  const review = card.getByRole('region', { name: 'Pretend AI, as a provider' });
  await expect(review).toContainText('its key goes only to api.pretend-ai.example');
  await expect(review.getByRole('list', { name: 'Pretend AI’s models' })).toContainText(
    'Pretend One',
  );
  const add = card.getByRole('button', { name: 'Add Pretend AI to my providers' });
  await expect(add).toBeDisabled();

  // A wrong key: said plainly, and nothing is added.
  await review.getByRole('textbox', { name: 'Pretend AI key' }).fill('pai-' + 'wrongwrong');
  await review.getByRole('button', { name: 'Test it' }).click();
  await expect(review.getByRole('alert')).toContainText('refused your key');
  await expect(add).toBeDisabled();

  // The right one: its first words stream in, and Add is one press.
  await review.getByRole('textbox', { name: 'Pretend AI key' }).fill(PRETEND_AI_KEY);
  await review.getByRole('button', { name: 'Test it' }).click();
  await expect(review.getByText('Hello from Pretend AI!')).toBeVisible();
  await expect(review.getByText(/Pretend One answered in/)).toBeVisible();
  await add.click();
  await expect(card.getByText('Pretend AI is one of your providers')).toBeVisible();

  // It's in the model picker like any provider, and it answers.
  await page.goto('/');
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.getByRole('group', { name: 'Pretend AI' }).getByRole('radio').first().click();
  await page.keyboard.press('Escape');
  await composer(page).fill('hi there');
  await composer(page).press('Enter');
  await expect(page.getByText(/Hello from Pretend AI\. You said: “hi there”/)).toBeVisible({
    timeout: 20_000,
  });

  // Settings → Providers shows it among yours, made by you (with the mock pinned, the gallery and
  // Add your own wait: the unit tests cover them).
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Providers' }).click();
  await expect(page.getByRole('article', { name: 'Pretend AI' })).toContainText('Made by you');
});

test('connect a pretend chat app with Conch, and a hello comes through it', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await composer(page).fill('connect me on Parley');
  await composer(page).press('Enter');
  await expect(page.getByText(/Paste your bot’s token into the card/)).toBeVisible({
    timeout: 30_000,
  });
  const card = page.getByRole('group', { name: 'Parley' });
  const review = card.getByRole('region', { name: 'Talk to me on Parley' });
  await expect(review).toContainText('it can’t read your chats or use your apps');
  await review.getByRole('textbox', { name: 'Parley bot token' }).fill(PARLEY_TOKEN);
  await review.getByRole('button', { name: 'Test it' }).click();
  await expect(review.getByText(/Connected as Conch on Parley \(@conch\)/)).toBeVisible();
  await card.getByRole('button', { name: 'Add Parley to Talk to me here' }).click();
  await expect(card.getByText('Parley is connected')).toBeVisible();

  // Ada writes to the bot on Parley; on its page in Conch, she says it's her.
  const { channels } = (await (await request.get('/api/channels')).json()) as {
    channels: { id: string; kind: string }[];
  };
  const channel = channels.find((c) => c.kind === 'app');
  expect(channel).toBeTruthy();
  await request.post(`${PRETEND}/__control/say`, {
    data: { from: { id: 'ada', name: 'Ada' }, text: 'hi' },
  });
  await page.goto(`/channels/${channel?.id ?? ''}`);
  await page.getByRole('button', { name: 'That’s me' }).click();
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${PRETEND}/__control/sent`)).json()) as { text: string }[])
          .map((m) => m.text)
          .join('\n'),
      { timeout: 15_000 },
    )
    .toMatch(/Hi Ada!/);
});
