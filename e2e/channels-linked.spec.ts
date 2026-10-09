import { expect, test, type APIRequestContext } from '@playwright/test';

import { askFirst, autoAgain } from './app';

/**
 * WhatsApp and Signal, linked by QR code (ADR 0043). With the mock engine
 * Conch talks to a pretend WhatsApp and a pretend signal-cli on this machine
 * (`GET /api/channels/mock` says where); the tests are the phone, through
 * their /__control endpoints: scanning the code, writing in the chat with
 * yourself, unlinking. Nothing reaches the real WhatsApp or Signal.
 */
let WHATSAPP = '';
let SIGNAL = '';

interface WaSent {
  kind: string;
  chat: string;
  id?: string;
  text?: string;
}

const waSent = async (request: APIRequestContext): Promise<WaSent[]> =>
  (await request.post(`${WHATSAPP}/__control/sent`)).json() as Promise<WaSent[]>;

const signalSent = async (request: APIRequestContext) =>
  (await (await request.post(`${SIGNAL}/__control/sent`)).json()) as {
    method: string;
    params: Record<string, unknown>;
  }[];

test.beforeEach(async ({ request }) => {
  const mocks = (await (await request.get('/api/channels/mock')).json()) as Record<string, string>;
  WHATSAPP = mocks.whatsapp ?? '';
  SIGNAL = mocks.signal ?? '';
  await request.patch('/api/settings', {
    data: { onboarded: true, profile: { name: 'Ada Lovelace' } },
  });
  for (const c of (await (await request.get('/api/channels')).json()).channels) {
    await request.delete(`/api/channels/${c.id}`);
  }
});
test.afterEach(async ({ request }) => {
  await autoAgain(request);
});

test('link WhatsApp by scanning, chat in Message yourself, and approve with a number', async ({
  page,
  request,
}) => {
  // The question from the phone is Ask first's: Auto runs the tests without one (ADR 0119).
  await askFirst(request);
  await page.goto('/');
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await page.getByRole('radio', { name: 'Talk to me here' }).click();
  await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();

  // The code is there at once, with the taps to make and what an unofficial client risks.
  await expect(page.getByRole('img', { name: 'Scan with WhatsApp on your phone' })).toBeVisible();
  await expect(page.getByText('WhatsApp’s terms allow only its own apps')).toBeVisible();
  await expect(page.getByRole('figure', { name: /Linked devices in WhatsApp/ })).toBeVisible();

  // The phone scans it: linked, and the account is yours, with nothing more to do.
  await request.post(`${WHATSAPP}/__control/scan`);
  await expect(page.getByText('You’re connected, Ada')).toBeVisible();
  await expect(page.getByText('Linked +1 555 000 1111')).toBeVisible();
  await expect
    .poll(async () => (await waSent(request)).some((m) => m.text?.includes('chat with yourself')))
    .toBe(true);

  // A message in Message yourself becomes a chat; the question comes back as numbered answers.
  await request.post(`${WHATSAPP}/__control/say`, { data: { text: 'please run the tests' } });
  let question: WaSent | undefined;
  await expect
    .poll(async () => {
      question = (await waSent(request)).find((m) => m.text?.includes('Reply with a number'));
      return Boolean(question);
    })
    .toBe(true);
  await request.post(`${WHATSAPP}/__control/say`, { data: { text: '1' } });
  await expect
    .poll(async () =>
      (await waSent(request)).some(
        (m) => m.kind === 'edit' && m.id === question?.id && m.text?.includes('Allowed'),
      ),
    )
    .toBe(true);

  // Your friends' chats are never read: nothing new reaches Conch.
  await request.post(`${WHATSAPP}/__control/say`, { data: { text: 'dinner?', from: 'friend' } });

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('+1 555 000 1111 on WhatsApp')).toBeVisible();
  await expect(page.getByText(/Conch never reads their chats/)).toBeVisible();
  const chats = page.getByRole('region', { name: 'Conversations from WhatsApp' });
  await expect(chats.getByRole('link')).toHaveCount(1);
  await chats.getByRole('link').first().click();
  await expect(page.getByText('please run the tests').first()).toBeVisible();
});

test('Signal: link, then unlinked on the phone, link again from its page', async ({
  page,
  request,
}) => {
  await page.goto('/channels/new/signal');
  await expect(page.getByRole('img', { name: 'Scan with Signal on your phone' })).toBeVisible();
  await request.post(`${SIGNAL}/__control/scan`);
  await expect(page.getByText('You’re connected, Ada')).toBeVisible();
  await expect
    .poll(async () =>
      (await signalSent(request)).some(
        (m) =>
          m.params.noteToSelf === true && String(m.params.message).includes('chat with yourself'),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Done' }).click();

  // Taken off Linked devices on the phone: the page says so, with the way back.
  await request.post(`${SIGNAL}/__control/unlink`);
  await expect(page.getByText('Link Signal again')).toBeVisible();
  await page.getByRole('button', { name: 'Show the code' }).click();
  await expect(page.getByRole('img', { name: 'Scan with Signal on your phone' })).toBeVisible();
  await request.post(`${SIGNAL}/__control/scan`);
  await expect(page.getByText('Link Signal again')).toBeHidden();
  await expect(page.getByText('Online')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the code still shows, and says to scan it from another screen', async ({ page }) => {
    await page.goto('/channels/new/whatsapp');
    await expect(page.getByRole('img', { name: 'Scan with WhatsApp on your phone' })).toBeVisible();
    await expect(page.getByText(/A phone can’t scan its own screen/)).toBeVisible();
    // Nothing wider than the screen.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
