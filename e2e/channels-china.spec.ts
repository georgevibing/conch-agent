import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Feishu / Lark, DingTalk and QQ (ADR 0120), against the pretend apps the
 * mock engine starts (`GET /api/channels/mock`): a pretend Feishu with its
 * long connection of protobuf frames, a pretend DingTalk with its Stream
 * gateway, and a pretend QQ with its bot gateway. Every one connects out
 * from this computer, so the public door stays off.
 */
let FEISHU = '';
let DINGTALK = '';
let QQ = '';

test.beforeEach(async ({ request }) => {
  const mocks = (await (await request.get('/api/channels/mock')).json()) as Record<string, string>;
  FEISHU = mocks.feishu ?? '';
  DINGTALK = mocks.dingtalk ?? '';
  QQ = mocks.qq ?? '';
  await request.patch('/api/settings', {
    // These approve from the chat app: start chats in Ask first (ADR 0119), so a step asks.
    data: {
      onboarded: true,
      profile: { name: 'Ada Lovelace' },
      preferences: { permissionMode: 'default' },
    },
  });
  for (const c of (await (await request.get('/api/channels')).json()).channels)
    await request.delete(`/api/channels/${c.id}`);
});

const control = (request: APIRequestContext, base: string, action: string, data: object = {}) =>
  request.post(`${base}/__control/${action}`, { data });

/** The channel is connected to its pretend app (so what the app sends now arrives). */
async function online(request: APIRequestContext) {
  await expect
    .poll(async () =>
      (
        (await (await request.get('/api/channels')).json()).channels as {
          health: { state: string };
        }[]
      ).some((c) => c.health.state === 'online'),
    )
    .toBe(true);
}

async function thatsMe(page: Page) {
  await page.getByRole('button', { name: 'That’s me' }).click();
  await expect(page.getByText('You’re connected, Ada')).toBeVisible();
}

type FeishuSent = {
  id: string;
  to: string;
  text: string;
  buttons?: { label: string; value: string }[];
  edited?: string;
};

test('Feishu: scan a code, and the bot is made and knows you; its card approves in place', async ({
  page,
  request,
}) => {
  await page.goto('/apps?show=talk');
  await page.getByRole('button', { name: 'Feishu / Lark', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Connect Feishu / Lark', level: 1 }),
  ).toBeVisible();
  await page.getByRole('radio', { name: /Feishu \(飞书\)/ }).click();
  await expect(page.getByRole('img', { name: /Scan with Feishu/ })).toBeVisible();
  // Ada scans the code on the screen with (pretend) Feishu and confirms.
  await expect
    .poll(
      async () => ((await (await control(request, FEISHU, 'scan')).json()) as { ok: boolean }).ok,
    )
    .toBe(true);
  await expect(page.getByText(/and it knows you/)).toBeVisible({ timeout: 15_000 });
  const sent = async () => (await (await control(request, FEISHU, 'sent')).json()) as FeishuSent[];
  await expect.poll(async () => (await sent()).some((m) => m.text.includes('Hi Ada'))).toBe(true);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'It’s published' }).click();
  await expect(page.getByText('You’re connected, Ada')).toBeVisible();

  await control(request, FEISHU, 'say', { text: 'please run the tests' });
  let question: FeishuSent | undefined;
  await expect
    .poll(async () => {
      question = (await sent()).find((m) => m.buttons?.some((b) => b.label === 'Allow'));
      return Boolean(question);
    })
    .toBe(true);
  const allow = question?.buttons?.find((b) => b.label === 'Allow');
  const toast = (await (
    await control(request, FEISHU, 'press', { message_id: question?.id, value: allow?.value })
  ).json()) as { toast?: { content?: string } };
  expect(toast.toast?.content).toBe('Allowed');
  await expect
    .poll(async () => (await sent()).find((m) => m.id === question?.id)?.edited ?? '')
    .toContain('Allowed');
  const door = (await (await request.get('/api/channels/door')).json()) as { state: string };
  expect(door.state).toBe('off');
});

test('Lark by hand: keys checked as pasted, what the console needs worked out, opening the chat is the hello', async ({
  page,
  request,
}) => {
  await page.goto('/channels/new/feishu');
  await page.getByRole('radio', { name: /^Lark/ }).click();
  await page.getByRole('button', { name: 'Make the app by hand instead' }).click();
  await page.getByRole('button', { name: 'I made it' }).click();
  await page.getByLabel('App ID').fill('App ID: cli_' + 'a1b2c3d4e5f60718');
  await expect(page.getByLabel('App ID')).toHaveValue('cli_' + 'a1b2c3d4e5f60718');
  await page.getByLabel('App Secret').fill('wrong-secret');
  await expect(page.getByText(/Lark doesn’t accept this App ID and App Secret/)).toBeVisible();
  await page.getByLabel('App Secret').fill('MockFeishuAppSecret0123456789abc');
  await expect(page.getByRole('textbox', { name: 'Permissions' })).toHaveValue(/im:message/);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'It’s published' }).click();
  // Ada opens the chat with the bot in (pretend) Lark: that's her hello.
  await online(request);
  await control(request, FEISHU, 'enter');
  await thatsMe(page);
});

test('DingTalk: Stream mode, keys checked as pasted, approvals answered with a number', async ({
  page,
  request,
}) => {
  await page.goto('/channels/new/dingtalk');
  await expect(page.getByRole('heading', { name: 'Connect DingTalk', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'I made it' }).click();
  await page.getByLabel('Client ID').fill('ding' + 'mockrobot0001xyz');
  await page.getByLabel('Client Secret').fill('nope');
  await expect(page.getByText(/DingTalk doesn’t accept this Client ID/)).toBeVisible();
  await page
    .getByLabel('Client Secret')
    .fill('MockDingTalkClientSecret' + '0123456789abcdefghijklmnopqrstuv');
  await page.getByRole('button', { name: 'It’s published' }).click();
  await online(request);
  await control(request, DINGTALK, 'say', { text: '你好' });
  await thatsMe(page);
  const sent = async () =>
    (await (await control(request, DINGTALK, 'sent')).json()) as { text: string }[];
  await expect.poll(async () => (await sent()).some((m) => m.text.includes('Hi Ada'))).toBe(true);
  await control(request, DINGTALK, 'say', { text: 'please run the tests' });
  await expect
    .poll(async () => (await sent()).some((m) => /Reply with a number/.test(m.text)))
    .toBe(true);
  await control(request, DINGTALK, 'say', { text: '1' });
  await expect.poll(async () => (await sent()).some((m) => m.text.includes('Allowed'))).toBe(true);
});

test('QQ: the quick bot page, keys checked as pasted, adding the bot is the hello', async ({
  page,
  request,
}) => {
  await page.goto('/channels/new/qq');
  await expect(page.getByRole('heading', { name: 'Connect QQ', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'I made it' }).click();
  await page.getByRole('textbox', { name: 'AppID' }).fill('102' + '345678');
  await page.getByRole('textbox', { name: 'AppSecret' }).fill('MockQqAppSecret0123456789abcdef');
  await online(request);
  await control(request, QQ, 'befriend');
  await thatsMe(page);
  await expect(page.getByText('Who can find it')).toBeVisible();
  const sent = async () =>
    (await (await control(request, QQ, 'sent')).json()) as {
      text: string;
      buttons?: { label: string; data: string }[];
      id: string;
    }[];
  await expect.poll(async () => (await sent()).some((m) => m.text.includes('Hi Ada'))).toBe(true);
  await control(request, QQ, 'say', { text: 'please run the tests' });
  let question: { id: string; buttons?: { label: string; data: string }[] } | undefined;
  await expect
    .poll(async () => {
      question = (await sent()).find((m) => m.buttons?.length);
      return Boolean(question);
    })
    .toBe(true);
  const allow = question?.buttons?.find((b) => b.label === 'Allow');
  await control(request, QQ, 'press', { data: allow?.data, message_id: question?.id });
  await expect.poll(async () => (await sent()).some((m) => m.text.includes('Allowed'))).toBe(true);
});
