import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Teams, Matrix and WeChat (ADR 0045), against the pretend apps the mock
 * engine starts (`GET /api/channels/mock`): a pretend Bot Framework that
 * signs its activities like Microsoft's, a pretend homeserver with a pretend
 * Element running Matrix's own encryption, and a pretend WeChat (an Official
 * Account's servers, and WeCom's long connection). The public door is turned
 * on with a pretend Tailscale; what the internet would deliver to it, the
 * pretend apps deliver on this computer.
 */
let TEAMS = '';
let MATRIX = '';
let WECHAT = '';

test.beforeEach(async ({ request }) => {
  const mocks = (await (await request.get('/api/channels/mock')).json()) as Record<string, string>;
  TEAMS = mocks.microsoftteams ?? '';
  MATRIX = mocks.matrix ?? '';
  WECHAT = mocks.wechat ?? '';
  await request.patch('/api/settings', {
    data: { onboarded: true, profile: { name: 'Ada Lovelace' } },
  });
  for (const c of (await (await request.get('/api/channels')).json()).channels)
    await request.delete(`/api/channels/${c.id}`);
  await request.delete('/api/channels/door');
});

const control = (request: APIRequestContext, base: string, action: string, data: object = {}) =>
  request.post(`${base}/__control/${action}`, { data });

async function thatsMe(page: Page) {
  await page.getByRole('button', { name: 'That’s me' }).click();
  await expect(page.getByText('You’re connected, Ada')).toBeVisible();
}

test('Matrix: sign in once, then an encrypted DM where a reaction approves', async ({
  page,
  request,
}) => {
  await page.goto('/apps?show=talk');
  await page.getByRole('button', { name: 'Matrix', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect Matrix', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'It has an account' }).click();
  await page.getByLabel('Homeserver').fill(MATRIX);
  await page.getByLabel('Username').fill('conch');
  await page.getByRole('textbox', { name: 'Password' }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('That username and password don’t match.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Password' }).fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('start a direct message with @conch:mock.local')).toBeVisible();

  // Ada opens an encrypted DM with the bot in (pretend) Element and says hi.
  await control(request, MATRIX, 'dm', { encrypted: true });
  await expect
    .poll(
      async () => (await (await control(request, MATRIX, 'say', { text: 'hi' })).json()).event_id,
      {
        timeout: 15_000,
      },
    )
    .toBeTruthy();
  await thatsMe(page);
  const seen = async () =>
    (await (await control(request, MATRIX, 'seen')).json()) as {
      event_id: string;
      text: string;
      encrypted: boolean;
      reaction?: string;
      edits?: string;
    }[];
  await expect
    .poll(async () => (await seen()).find((m) => m.text.includes('Hi Ada'))?.encrypted)
    .toBe(true);

  await control(request, MATRIX, 'say', { text: 'please run the tests' });
  let question: { event_id: string } | undefined;
  await expect
    .poll(async () => {
      question = (await seen()).find((m) => m.text.includes('Allow') && !m.reaction && !m.edits);
      return Boolean(question);
    })
    .toBe(true);
  await control(request, MATRIX, 'react', { event_id: question?.event_id, key: '✅' });
  await expect
    .poll(async () =>
      (await seen()).some((m) => m.edits === question?.event_id && m.text.includes('Allowed')),
    )
    .toBe(true);
});

test('Teams: the bot’s ID and secret, the public address, the app to upload, then hello', async ({
  page,
  request,
}) => {
  await page.goto('/channels/new/microsoftteams');
  await page.getByRole('button', { name: 'I made it' }).click();
  await page.getByLabel('Bot ID').fill('Bot ID 00000000-0000-4000-8000-00000000c0c4');
  await expect(page.getByLabel('Bot ID')).toHaveValue('00000000-0000-4000-8000-00000000c0c4');
  await page.getByLabel('Client secret').fill('mock~Teams.Secret_value-0123456789abcdefgh');

  // The public address: one press (a pretend Tailscale Funnel).
  await page.getByRole('button', { name: 'Turn on with Tailscale' }).click();
  const endpoint = page.getByRole('textbox', { name: 'Endpoint address' });
  await expect(endpoint).toHaveValue(
    /^https:\/\/conch-studio\.tail1234\.ts\.net\/conch\/hooks\/[\w-]{24}$/,
  );
  // What the person pastes in the Developer Portal.
  await control(request, TEAMS, 'endpoint', { url: await endpoint.inputValue() });
  await page.getByRole('button', { name: 'I pasted it' }).click();
  await expect(page.getByRole('link', { name: 'Download the Teams app' })).toHaveAttribute(
    'href',
    /\/api\/channels\/ch_[\w-]+\/teams-app$/,
  );
  await page.getByRole('button', { name: 'It’s in Teams' }).click();

  expect((await (await control(request, TEAMS, 'say', { text: 'hi' })).json()).status).toBe(200);
  await thatsMe(page);
  await expect
    .poll(async () =>
      ((await (await control(request, TEAMS, 'sent')).json()) as { text: string }[]).some((m) =>
        m.text.includes('Hi Ada'),
      ),
    )
    .toBe(true);
});

test('WeChat: a WeCom bot by default, with nothing opened to the internet', async ({
  page,
  request,
}) => {
  await page.goto('/channels/new/wechat');
  await expect(page.getByText(/Personal WeChat accounts can’t be bots/)).toBeVisible();
  await expect(page.getByRole('radio', { name: /A WeCom bot/ })).toBeChecked();
  await page.getByRole('button', { name: 'I made it' }).click();
  await page.getByLabel('Bot ID').fill('aibMockBot0001');
  await page.getByLabel('Secret', { exact: true }).fill('mockBotSecret0123456789abcdefABCDEF');
  await expect(page.getByText('Open the bot in WeCom')).toBeVisible();
  await control(request, WECHAT, 'wecom-say', { text: '你好' });
  await thatsMe(page);
  const door = (await (await request.get('/api/channels/door')).json()) as { state: string };
  expect(door.state).toBe('off');
});

test('WeChat: an Official Account through the public door, checked by WeChat itself', async ({
  page,
  request,
}) => {
  await page.goto('/channels/new/wechat');
  await page.getByRole('radio', { name: /An Official Account/ }).click();
  await page.getByRole('button', { name: 'I have one' }).click();
  await page.getByLabel('AppID').fill('wx0123456789abcdef');
  await page.getByLabel('AppSecret').fill('0123456789abcdef0123456789abcdef');
  await page.getByRole('button', { name: 'Turn on with Tailscale' }).click();
  await page.getByRole('button', { name: 'Show the Token and EncodingAESKey' }).click();
  const url = await page.getByRole('textbox', { name: 'URL (服务器地址)' }).inputValue();
  const token = await page.getByRole('textbox', { name: 'Token (令牌)' }).inputValue();
  const aesKey = await page
    .getByRole('textbox', { name: 'EncodingAESKey (消息加解密密钥)' })
    .inputValue();
  expect(aesKey).toMatch(/^[A-Za-z0-9]{43}$/);
  // Pressing 提交 in WeChat: it checks the address answers its signed echo.
  expect(
    (await (await control(request, WECHAT, 'configure', { url, token, aesKey })).json()).status,
  ).toBe(200);
  // The step ticks itself off: WeChat was heard from.
  await expect(page.getByText('WeChat checked the address', { exact: true })).toBeVisible();

  // A message, encrypted in safe mode; the reply comes back in the same delivery.
  const said = (await (await control(request, WECHAT, 'say', { text: '你好' })).json()) as {
    reply?: string;
  };
  expect(said.reply).toMatch(/That’s me/);
  await thatsMe(page);
});

test('⌘K finds the new apps by name, and a setup reads on a phone', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('matrix');
  await expect(page.getByRole('option', { name: /Connect Matrix/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/channels/new/microsoftteams');
  await expect(
    page.getByRole('heading', { name: 'Connect Microsoft Teams', level: 1 }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
