import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * With the mock engine, channels talk to a pretend Telegram, Discord and Slack
 * on this machine; the gateway says where (`GET /api/channels/mock`, mock
 * engine only). The tests speak for the person on their phone through each
 * pretend app's /__control endpoints.
 */
let TELEGRAM = '';
let DISCORD = '';
let SLACK = '';

const BOTFATHER = `Done! Congratulations on your new bot. You will find it at t.me/my_conch_bot.
Use this token to access the HTTP API:
123456789:${'AAHmockmockmockmockmockmockmockmock1'}
Keep your token secure and store it safely.`;

interface Sent {
  method: string;
  message_id: number;
  text: string;
  buttons: { text: string; callback_data: string }[];
}

const telegramSent = async (request: APIRequestContext): Promise<Sent[]> =>
  (await request.post(`${TELEGRAM}/__control/sent`)).json() as Promise<Sent[]>;

test.beforeEach(async ({ request }) => {
  const mocks = (await (await request.get('/api/channels/mock')).json()) as Record<string, string>;
  TELEGRAM = mocks.telegram ?? '';
  DISCORD = mocks.discord ?? '';
  SLACK = mocks.slack ?? '';
  await request.patch('/api/settings', {
    data: { onboarded: true, profile: { name: 'Ada Lovelace' } },
  });
  for (const c of (await (await request.get('/api/channels')).json()).channels) {
    await request.delete(`/api/channels/${c.id}`);
  }
});

test('connect Telegram, say hello, chat from the phone and approve with a button', async ({
  page,
  request,
}) => {
  await page.goto('/');
  // Chat apps are in Apps, under Talk to me here (ADR 0052).
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Apps', level: 1 })).toBeVisible();
  await page.getByRole('radio', { name: 'Talk to me here' }).click();
  await expect(page.getByRole('list', { name: 'How it works' })).toBeVisible();
  await page.getByRole('button', { name: 'Telegram', exact: true }).click();

  // BotFather's two questions are answered for you.
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
    'Conch for Ada',
  );
  await expect(page.getByRole('textbox', { name: 'Username' })).toHaveValue(
    /^ada_conch_\d{4}_bot$/,
  );

  // Paste BotFather's whole message: the key is found, checked, and connected.
  await page.getByRole('button', { name: 'I have the key' }).click();
  await page.getByLabel('Bot key').fill(BOTFATHER);
  const open = page.getByRole('link', { name: 'Open in Telegram' });
  await expect(open).toBeVisible();
  const code = new URL((await open.getAttribute('href')) ?? '').searchParams.get('start');

  // Pressing Start in Telegram lets the owner in.
  await request.post(`${TELEGRAM}/__control/say`, { data: { text: `/start ${code}` } });
  await expect(page.getByText('You’re connected, Ada')).toBeVisible();
  await expect
    .poll(async () => (await telegramSent(request)).some((m) => m.text.includes('Hi Ada!')))
    .toBe(true);

  // A question from the phone becomes a chat; the assistant asks before running anything.
  await request.post(`${TELEGRAM}/__control/say`, { data: { text: 'please run the tests' } });
  let question: Sent | undefined;
  await expect
    .poll(async () => {
      question = (await telegramSent(request)).find((m) => m.buttons.length === 3);
      return Boolean(question);
    })
    .toBe(true);
  const allow = question?.buttons.find((b) => b.text === 'Allow');
  await request.post(`${TELEGRAM}/__control/press`, {
    data: { data: allow?.callback_data, messageId: question?.message_id },
  });
  await expect
    .poll(async () =>
      (await telegramSent(request)).some(
        (m) => m.method === 'editMessageText' && m.text.includes('Allowed'),
      ),
    )
    .toBe(true);

  // The same chat is in Conch, wearing Telegram's logo, and says where it came from.
  await page.getByRole('button', { name: 'Done' }).click();
  await page
    .getByRole('region', { name: 'Conversations from Telegram' })
    .getByRole('link')
    .first()
    .click();
  await expect(page.getByText('From Telegram.')).toBeVisible();
  await expect(page.getByText('please run the tests').first()).toBeVisible();
});

test('someone else asks to talk: a live request, let in with one press', async ({
  page,
  request,
}) => {
  const made = await (
    await request.post('/api/channels', { data: { kind: 'telegram', token: BOTFATHER } })
  ).json();
  const code = new URL(made.pairing.link).searchParams.get('start');
  await request.post(`${TELEGRAM}/__control/say`, { data: { text: `/start ${code}` } });
  await page.goto(`/channels/${made.id}`);
  await expect(page.getByRole('region', { name: /Who can talk/ })).toContainText('Ada');

  await request.post(`${TELEGRAM}/__control/say`, {
    data: { text: 'hi, can I ask you things?', from: { id: 5151, first_name: 'Grace' } },
  });
  const waiting = page.getByRole('region', { name: 'Waiting to be let in' });
  await expect(waiting).toContainText('hi, can I ask you things?');
  await waiting.getByRole('button', { name: 'Let them in' }).click();
  await expect(page.getByRole('region', { name: /Who can talk/ })).toContainText('Grace');
});

test('Discord: add to a server by itself, then “Is this you?”', async ({ page, request }) => {
  await page.goto('/channels/new/discord');
  await page.getByRole('button', { name: 'I made it' }).click();
  await page
    .getByLabel('Bot token')
    .fill('MTEwMDAwMDAwMDAwMDAwMDAw.' + 'GmockA.mockmockmockmockmockmockmockmockmock12');
  const add = page.getByRole('link', { name: 'Add Conch to Discord' });
  await expect(add).toHaveAttribute('href', /permissions=0/);
  // The bot arrives in a server: the step ticks itself off.
  await request.post(`${DISCORD}/__control/join`);
  await expect(page.getByText('Waiting for your message')).toBeVisible();
  await request.post(`${DISCORD}/__control/say`, { data: { text: 'hi' } });
  await page.getByRole('button', { name: 'That’s me' }).click();
  await expect(page.getByText('You’re connected, Ada')).toBeVisible();
});

test('Slack: two keys, sorted whichever box they land in', async ({ page, request }) => {
  await page.goto('/channels/new/slack');
  await expect(page.getByRole('link', { name: 'Make the app in Slack' })).toHaveAttribute(
    'href',
    /new_app=1&manifest_json=/,
  );
  await page.getByRole('button', { name: 'I made it' }).click();
  // The app-level token pasted into the bot token's box goes where it belongs.
  await page
    .getByLabel('Bot token')
    .fill('xapp-1-A0MOCKAPP-3333333333-mockmockmockmockmockmockmock');
  await expect(page.getByLabel('Bot token')).toHaveValue('');
  await page
    .getByLabel('Bot token')
    .fill('xoxb-' + '1111111111-2222222222-mockmockmockmockmockmock');
  await expect(page.getByText('Waiting for your message')).toBeVisible();
  await request.post(`${SLACK}/__control/say`, { data: { text: 'hi' } });
  await page.getByRole('button', { name: 'That’s me' }).click();
  await expect(page.getByText('You’re connected, Ada')).toBeVisible();
});

test('Telegram settings choose the model before a chat and the web shows the same choice', async ({
  page,
  request,
}) => {
  const made = await (
    await request.post('/api/channels', { data: { kind: 'telegram', token: BOTFATHER } })
  ).json();
  const code = new URL(made.pairing.link).searchParams.get('start');
  const before = (await telegramSent(request)).length;
  await request.post(`${TELEGRAM}/__control/say`, { data: { text: `/start ${code}` } });
  await expect
    .poll(async () =>
      (await telegramSent(request)).slice(before).some((m) => m.text.includes('Hi Ada!')),
    )
    .toBe(true);
  const say = async (text: string) => request.post(`${TELEGRAM}/__control/say`, { data: { text } });
  const choose = async (label: string) => {
    const message = (await telegramSent(request)).at(-1);
    const button = message?.buttons.find((b) => b.text === label);
    expect(button, `button ${label}`).toBeDefined();
    const count = (await telegramSent(request)).length;
    await request.post(`${TELEGRAM}/__control/press`, {
      data: { data: button?.callback_data, messageId: message?.message_id },
    });
    await expect
      .poll(async () => {
        const sent = await telegramSent(request);
        return sent.length > count;
      })
      .toBe(true);
  };
  // /model opens on the provider in use, and a tap on a model is the choice.
  await say('/model');
  await expect
    .poll(async () => (await telegramSent(request)).at(-1)?.text)
    .toContain('Choose a model from Claude Code');
  await choose('Sonnet 5.5');
  await expect
    .poll(async () => (await telegramSent(request)).at(-1)?.text)
    .toContain('Now using Sonnet 5.5');
  await say('/effort');
  await expect
    .poll(async () => (await telegramSent(request)).at(-1)?.text)
    .toContain('Choose how hard');
  await choose('High');
  await expect
    .poll(async () => (await telegramSent(request)).at(-1)?.text)
    .toContain('Thinking effort: High');
  await say('Hello from my configured Telegram chat');
  let conversationId = '';
  await expect
    .poll(async () => {
      const conversations = (await (await request.get('/api/conversations')).json()) as {
        id: string;
        origin?: { channelId?: string };
      }[];
      conversationId = conversations.find((c) => c.origin?.channelId === made.id)?.id ?? '';
      return conversationId;
    })
    .not.toBe('');
  await page.goto(`/c/${conversationId}`);
  await expect(page.getByText('From Telegram.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Sonnet 5.5/ }).first()).toBeVisible();
  await expect(page.getByText('Hello from my configured Telegram chat').first()).toBeVisible();
  await say('/status');
  await expect
    .poll(async () => (await telegramSent(request)).at(-1)?.text)
    .toContain('Effort: High');
  await expect
    .poll(async () => (await telegramSent(request)).at(-1)?.text)
    .toContain('Model: Sonnet 5.5');
});
