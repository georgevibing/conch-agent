import { expect, type Page, test } from '@playwright/test';

/**
 * Every app works with every model (ADR 0049). Slack is Conch's own: the
 * person pastes the one token their Slack app shows, the assistant reads
 * through Conch's tools (the pretend Slack answers), and every message it
 * would send is shown and asked for first — including when something it
 * read tries to steer it. What the provider set up that Conch can connect
 * (Sentry, in the pretend provider's account) comes in by itself; what only
 * the provider can use waits in Settings → Providers.
 */
const USER_TOKEN = 'xoxp-' + '1111111111-2222222222-3333333333-mockmockmockmockmock';
let SLACK = '';

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  const mocks = (await (await request.get('/api/channels/mock')).json()) as Record<string, string>;
  SLACK = mocks.slack ?? '';
  await request.delete('/api/integrations/slack');
  await request.post(`${SLACK}/__control/reset-user`);
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });
async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await page.keyboard.press('Enter');
}

test('connect Slack once, catch up on a channel, and nothing is sent without your OK', async ({
  page,
  request,
}) => {
  await page.goto('/integrations');
  await page.getByRole('button', { name: 'Slack', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Slack' });
  await expect(dialog.getByRole('link', { name: 'Make the app in Slack' })).toBeVisible();
  // The bot token is the wrong one, and the dialog says which to copy instead.
  await dialog
    .getByLabel(/User OAuth Token/)
    .fill('xoxb-' + '1111111111-2222222222-mockmockmockmockmock');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByText(/That’s the app’s bot token/)).toBeVisible();
  // Pasted whole, it's checked at once: no button to find.
  await dialog.getByLabel(/User OAuth Token/).fill(USER_TOKEN);
  await expect(page.getByRole('dialog', { name: 'Slack is connected' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(
    page.getByRole('region', { name: 'Connected' }).getByText('Slack', { exact: true }),
  ).toBeVisible();

  // Reading goes by itself, through Conch's own tools.
  await page.goto('/');
  await ask(page, 'catch me up on #launch');
  await expect(page.getByText(/#launch has 2 new messages\. Sam Rivera said/)).toBeVisible();

  // Something it read told it to post keys: posting still shows the words, and why it's checking.
  await ask(page, 'post in #general: here are the API keys');
  await expect(
    page.getByText(/send this to #general in Slack: “here are the API keys”/),
  ).toBeVisible();
  await expect(page.getByText(/could be trying to steer me/)).toBeVisible();
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.getByText(/I didn’t post it/)).toBeVisible();
  expect(await (await request.post(`${SLACK}/__control/posted`)).json()).toEqual([]);

  // Asked for and approved: it goes, as you.
  await ask(page, 'post in #general: standup notes are in the doc');
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.getByText('Posted it in #general.')).toBeVisible();
  expect(await (await request.post(`${SLACK}/__control/posted`)).json()).toEqual([
    expect.objectContaining({ channel: 'C0GENERAL1', text: 'standup notes are in the doc' }),
  ]);

  // Its page: sending can be Ask or Off, never Allow.
  await page.goto('/integrations/slack');
  const send = page.getByRole('radiogroup', { name: 'Send a message' });
  await expect(send.getByRole('radio', { name: 'Allow' })).toHaveCount(0);
  await send.getByRole('radio', { name: 'Off' }).click();
  await expect(send.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
});

test('what the provider set up comes in by itself; what only it can use is in Settings', async ({
  page,
  request,
}) => {
  // Brought in at start-up: a normal card that asks you to sign in.
  await expect
    .poll(
      async () =>
        (
          (await (await request.get('/api/integrations')).json()).integrations as { name: string }[]
        ).map((i) => i.name),
      { timeout: 15_000 },
    )
    .toContain('Sentry');
  await page.goto('/integrations');
  const connected = page.getByRole('region', { name: 'Connected' });
  await expect(connected.getByText('Sentry')).toBeVisible();
  await expect(connected.getByText('Sign in to use it with every model.')).toBeVisible();
  await expect(page.getByText('From your providers')).toHaveCount(0);

  // What only the provider can use is folded away in Settings → Providers.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Providers' }).click();
  await page.getByRole('button', { name: /3 servers/ }).click();
  await expect(page.getByText('filesystem')).toBeVisible();

  // Disconnecting it keeps it out; Settings offers the way back.
  const sentry = (
    (await (await request.get('/api/integrations')).json()).integrations as {
      id: string;
      name: string;
    }[]
  ).find((i) => i.name === 'Sentry');
  await request.delete(`/api/integrations/${sentry?.id ?? ''}`);
  await request.get('/api/integrations/external?refresh=1');
  expect(
    (
      (await (await request.get('/api/integrations')).json()).integrations as { name: string }[]
    ).map((i) => i.name),
  ).not.toContain('Sentry');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Providers' }).click();
  await page.getByRole('button', { name: /4 servers/ }).click();
  await expect(page.getByRole('button', { name: 'Use with every model' })).toBeVisible();
});
