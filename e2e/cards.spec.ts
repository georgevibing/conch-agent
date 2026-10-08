import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * A card in the chat, done something with (ADR 0105): the forecast saved as a
 * real picture this browser drew, and the same picture sent to the pretend
 * Telegram as a photo — after the press, the app and the question, never
 * before.
 */
const TOKEN = '123456789:' + 'AAHmockmockmockmockmockmockmockmock1';

let TELEGRAM = '';

interface Upload {
  method: string;
  kind: string;
  name: string;
  size: number;
  type?: string;
  caption?: string;
}

const uploads = async (request: APIRequestContext): Promise<Upload[]> =>
  (await request.post(`${TELEGRAM}/__control/uploads`)).json() as Promise<Upload[]>;

test.beforeEach(async ({ request }) => {
  const mocks = (await (await request.get('/api/channels/mock')).json()) as Record<string, string>;
  TELEGRAM = mocks.telegram ?? '';
  await request.patch('/api/settings', {
    data: { onboarded: true, profile: { name: 'Ada Lovelace' } },
  });
  for (const c of (await (await request.get('/api/channels')).json()).channels)
    await request.delete(`/api/channels/${c.id}`);
});

/** Connect the pretend Telegram and say hello from the phone, as the owner. */
async function telegramConnected(request: APIRequestContext) {
  const channel = await (
    await request.post('/api/channels', { data: { kind: 'telegram', token: TOKEN } })
  ).json();
  const code = new URL(String(channel.pairing?.link)).searchParams.get('start');
  await request.post(`${TELEGRAM}/__control/say`, { data: { text: `/start ${code}` } });
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/channels/${channel.id}`)).json()).people?.length ?? 0,
      { timeout: 20_000 },
    )
    .toBe(1);
  await expect
    .poll(async () => (await (await request.get('/api/cards/apps')).json()).apps.length, {
      timeout: 20_000,
    })
    .toBe(1);
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });

async function forecast(page: Page) {
  await page.goto('/');
  await composer(page).fill('What’s the weather in Lisbon?');
  await composer(page).press('Enter');
  const card = page.getByRole('region', { name: /^Weather in / });
  await expect(card).toBeVisible({ timeout: 30_000 });
  // The fonts have to be there before a picture is made of the words.
  await page.evaluate(() => document.fonts.ready);
  return card;
}

/** A PNG's own idea of its size, from the IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('Save as image downloads a real picture of the card', async ({ page }) => {
  const card = await forecast(page);

  const download = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Save as image' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Weather in .+\.png$/);

  const path = await file.path();
  const bytes = await (await import('node:fs/promises')).readFile(path);
  const { width, height } = pngSize(bytes);
  // Drawn at 2×, so the picture is twice the card on screen: a real forecast
  // card is never a few hundred pixels, and never a nearly-empty file.
  expect(width).toBeGreaterThan(600);
  expect(height).toBeGreaterThan(600);
  expect(bytes.length).toBeGreaterThan(20_000);

  // Not one flat colour: the card's own ink is in there.
  const distinct = new Set<number>();
  for (let i = 0; i < bytes.length; i += 97) distinct.add(bytes[i] ?? 0);
  expect(distinct.size).toBeGreaterThan(40);

  await expect(card.getByText('Saved')).toBeVisible();
});

test('Send asks which app, then names it, then the photo arrives', async ({ page, request }) => {
  await telegramConnected(request);
  const card = await forecast(page);

  const before = (await uploads(request)).length;
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Send this forecast to')).toBeVisible();
  // Choosing the app only asks the question. Nothing has gone.
  await page.getByRole('button', { name: 'Telegram', exact: true }).click();
  await expect(page.getByText('Send this forecast to Telegram?')).toBeVisible();
  expect(await uploads(request)).toHaveLength(before);

  const answered = page.waitForResponse('**/api/cards/send', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Send to Telegram' }).click();
  const response = await answered;
  expect(await response.json()).toMatchObject({ app: 'Telegram' });
  await expect(card.getByText('Sent to Telegram')).toBeVisible();

  const sent = (await uploads(request)).slice(before);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ method: 'sendPhoto', kind: 'photo', type: 'image/png' });
  expect(sent[0]?.name).toMatch(/^Weather in .+\.png$/);
  expect(sent[0]?.size).toBeGreaterThan(20_000);
  expect(sent[0]?.caption).toContain('Weather in');
});

test('with no chat app connected there is no Send at all', async ({ page }) => {
  const card = await forecast(page);
  await expect(card.getByRole('button', { name: 'Save as image' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
});

test('nothing is sent without a card’s own picture from this chat', async ({ request }) => {
  await telegramConnected(request);
  // The pretend Telegram keeps everything this gateway ever sent it.
  const before = (await uploads(request)).length;
  // An attachment id from nowhere, and one that was uploaded but belongs to no
  // chat Conch has: both refused, and the phone stays quiet.
  const stray = await (
    await request.post('/api/attachments', {
      headers: { 'content-type': 'application/octet-stream', 'x-conch-name': 'stray.png' },
      data: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      ),
    })
  ).json();
  for (const attachmentId of ['att_nothing', String(stray.attachment.id)]) {
    const refused = await request.post('/api/cards/send', {
      data: { conversationId: 'c_made_up', attachmentId, caption: 'take this' },
    });
    expect(refused.status()).toBe(404);
  }
  expect(await uploads(request)).toHaveLength(before);
});
