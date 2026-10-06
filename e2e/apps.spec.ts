import { expect, test, type APIRequestContext } from '@playwright/test';

import { MockSlack } from '../apps/server/src/channels/mock/slack';

/**
 * One app, one card (ADR 0052), against the pretend Slack and the pretend
 * mail service the channels use. Setting up either half of an app offers the
 * other: Slack's halves are separate keys from the same Slack app, so the
 * offer starts the channel's setup with the app already made; Gmail's share an
 * app password, so talking to you by email is one press.
 */
let SLACK = '';
let MAIL = '';

interface Listed {
  integrations: { id: string }[];
}
interface Channels {
  channels: { id: string; kind: string; app?: string }[];
}
interface Conversation {
  origin?: { kind: string; channelId?: string };
}

const channels = async (request: APIRequestContext) =>
  ((await (await request.get('/api/channels')).json()) as Channels).channels;

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', {
    data: { onboarded: true, profile: { name: 'Ada Lovelace' } },
  });
  const mocks = (await (await request.get('/api/channels/mock')).json()) as Record<string, string>;
  SLACK = mocks.slack ?? '';
  MAIL = mocks.email ?? '';
  for (const c of await channels(request)) await request.delete(`/api/channels/${c.id}`);
  for (const i of ((await (await request.get('/api/integrations')).json()) as Listed).integrations)
    await request.delete(`/api/integrations/${i.id}`);
  await request.post(`${SLACK}/__control/reset-user`);
  await request.post(`${MAIL}/__control/reset`);
});

test('Slack: connect it as an app, turn on Talk to me here with the same Slack app, and a message arrives', async ({
  page,
  request,
}) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'Slack', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Connect Slack' })
    .getByLabel(/User OAuth Token/)
    .fill(MockSlack.USER_TOKEN);
  const connected = page.getByRole('dialog', { name: 'Slack is connected' });
  await expect(connected).toBeVisible();

  // The other half is offered, never done by itself.
  expect(await channels(request)).toEqual([]);
  await connected.getByRole('button', { name: 'Set it up' }).click();
  await expect(page).toHaveURL(/\/channels\/new\/slack\?with=app$/);

  // The Slack app is made already: only its bot token and an app-level token to copy, on
  // purpose (they're separate keys from the one that reads as you, ADR 0049).
  await expect(page.getByText('Made: Slack in Apps uses it').first()).toBeVisible();
  await page.getByLabel('Bot token').fill(MockSlack.BOT_TOKEN);
  await page.getByLabel('App-level token').fill(MockSlack.APP_TOKEN);
  await expect(page.getByText('Waiting for your message')).toBeVisible();
  await request.post(`${SLACK}/__control/say`, { data: { text: 'hi' } });
  await page.getByRole('button', { name: 'That’s me' }).click();
  await expect(page.getByText('You’re connected, Ada')).toBeVisible();

  // A message from Slack arrives, as a chat in Conch.
  await request.post(`${SLACK}/__control/say`, { data: { text: 'what is on today?' } });
  const [bot] = await channels(request);
  expect(bot).toMatchObject({ kind: 'slack', app: 'slack' });
  await expect
    .poll(async () =>
      ((await (await request.get('/api/conversations')).json()) as Conversation[]).some(
        (c) => c.origin?.kind === 'channel' && c.origin.channelId === bot?.id,
      ),
    )
    .toBe(true);

  // One Slack, one card: it reads for you and talks to you, and its tile is gone.
  await page.goto('/apps');
  const cards = page.getByRole('region', { name: 'Connected' });
  await expect(cards.getByRole('button', { name: 'Slack', exact: true })).toHaveCount(1);
  await expect(cards.getByText(/talks to you here/)).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Add another app' }).getByRole('button', { name: 'Slack' }),
  ).toHaveCount(0);
  await cards.getByRole('button', { name: 'Slack', exact: true }).click();
  const does = page.getByRole('list', { name: 'What Slack does' });
  await expect(does.getByRole('switch', { name: 'Read & search' })).toBeChecked();
  await expect(does.getByRole('switch', { name: 'Send (asks first)' })).toBeChecked();
  await expect(does.getByRole('switch', { name: 'Talk to me here' })).toBeChecked();

  // Where you are: Apps › Slack in the header, the page's name focused, Apps the way back.
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(trail.getByText('Slack')).toBeFocused();
  await expect(trail.getByText('Slack')).toHaveAttribute('aria-current', 'page');
  // Its talking half sits under it, on a phone too.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/channels/${bot?.id ?? ''}`);
  await expect(trail.getByRole('link')).toHaveText(['Apps', 'Slack']);
  await expect(page.getByRole('button', { name: 'Open conversations' })).toBeVisible();
  await trail.getByRole('link', { name: 'Slack' }).click();
  await expect(page).toHaveURL(/\/apps\/slack$/);
  await trail.getByRole('link', { name: 'Apps' }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(trail).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Apps', level: 1 })).toBeFocused();
});

test('Gmail: talk to it by email in one press, with the app password Gmail already has', async ({
  page,
  request,
}) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'Gmail', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Gmail' });
  await dialog.getByLabel('Gmail address').fill('ada@gmail.com');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('textbox', { name: 'App password' }).fill('abcd efgh ijkl mnop');
  const connected = page.getByRole('dialog', { name: 'Gmail is connected' });
  await expect(connected).toBeVisible();

  // Offered, never done by itself: nothing reads your mail for Conch until you press it.
  await expect(connected.getByText(/write to ada\+conch@gmail\.com/)).toBeVisible();
  expect(await channels(request)).toEqual([]);
  await connected.getByRole('button', { name: 'Turn it on' }).click();
  await expect(connected.getByText('You can talk to it by email now')).toBeVisible();
  expect(await channels(request)).toMatchObject([{ kind: 'email', app: 'gmail' }]);
  await connected.getByRole('button', { name: 'Done' }).click();

  // An email to yourself+conch is answered in its thread.
  const { messageId } = (await (
    await request.post(`${MAIL}/__control/deliver`, {
      data: { subject: 'From my phone', text: 'Hello there' },
    })
  ).json()) as { messageId: string };
  await expect
    .poll(async () => {
      const sent = (await (await request.post(`${MAIL}/__control/sent`)).json()) as {
        inReplyTo: string;
        subject: string;
      }[];
      return sent.find((m) => m.inReplyTo === messageId)?.subject;
    })
    .toBe('Re: From my phone');

  // One Gmail, one card, and Email isn't offered again.
  const cards = page.getByRole('region', { name: 'Connected' });
  await expect(cards.getByRole('button', { name: 'Gmail', exact: true })).toHaveCount(1);
  await page.getByRole('radio', { name: 'Talk to me here' }).click();
  await expect(cards.getByRole('button', { name: 'Gmail', exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Add another app' }).getByRole('button', { name: 'Email' }),
  ).toHaveCount(0);
  await cards.getByRole('button', { name: 'Gmail', exact: true }).click();
  await expect(
    page
      .getByRole('list', { name: 'What Gmail does' })
      .getByRole('switch', { name: 'Talk to me here' }),
  ).toBeChecked();
});
