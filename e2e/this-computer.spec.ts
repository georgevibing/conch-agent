import { pathToFileURL } from 'node:url';

import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

import { say } from './app';

/**
 * "This computer", proven (ADR 0063), in a real browser against the real gateway.
 *
 * Every other journey is a program on this computer: it sends the key. This one
 * is a browser, so it doesn't. Looking like this computer (loopback, a loopback
 * name, no proxy header) isn't enough any more — nginx's defaults and other
 * accounts on this computer look exactly like that — and only a browser Conch
 * opened itself, through the private file a launcher opens, gets in.
 */
test.use({ extraHTTPHeaders: {}, storageState: { cookies: [], origins: [] } });

const KEY = process.env.CONCH_E2E_HERE_KEY ?? '';

/** A launcher on this computer: it holds the key, and asks for a link. */
async function launcher(baseURL: string | undefined) {
  return playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { 'x-conch-here': KEY } });
}

async function link(baseURL: string | undefined, page = '/', file = false) {
  const asks = await launcher(baseURL);
  const res = await asks.post('/api/here/link', { data: { page, file } });
  expect(res.status()).toBe(200);
  const made = (await res.json()) as { url: string; code: string; file?: string };
  await asks.dispose();
  return made;
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });

test.beforeAll(async ({ baseURL }) => {
  const asks = await launcher(baseURL);
  await asks.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  await asks.dispose();
});

test('a browser Conch didn’t open is asked to open it from your apps, and gets nothing', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Open Conch from your apps' })).toBeVisible();
  await expect(page.getByText('pnpm conch open')).toBeVisible();
  await expect(composer(page)).toHaveCount(0);

  // The API says why, and gives nothing away.
  const state = await request.get('/api/state');
  expect(state.status()).toBe(401);
  expect((await state.json()).error).toBe('here-required');
  // The same through 127.0.0.1, which is what nginx's `proxy_pass http://127.0.0.1:…` sends.
  const port = new URL(page.url()).port;
  const hidden = await request.get(`http://127.0.0.1:${port}/api/conversations`);
  expect(hidden.status()).toBe(401);
});

test('a launcher’s private file opens Conch as this computer, and it stays that way', async ({
  page,
  baseURL,
}) => {
  const made = await link(baseURL, '/', true);
  expect(made.file).toBeTruthy();
  // What the app shortcut and the menu bar helper open: a file, never the code on a command line.
  await page.goto(pathToFileURL(made.file ?? '').href);
  await expect(composer(page)).toBeVisible({ timeout: 15_000 });
  // The code left the address bar as soon as the page read it.
  expect(page.url()).not.toContain('here=');
  // The live socket is let in too: a whole reply comes back.
  await say(page, 'hello', /./);

  // A new tab of the same browser is this computer too: the cookie lasts.
  const again = await page.context().newPage();
  await again.goto('/');
  await expect(composer(again)).toBeVisible();
});

test('a link works once: the second browser to open it is turned away', async ({
  browser,
  baseURL,
}) => {
  const made = await link(baseURL, '/?open=devices');
  const first = await browser.newContext({ extraHTTPHeaders: {}, storageState: undefined });
  const firstPage = await first.newPage();
  await firstPage.goto(made.url);
  await expect(composer(firstPage)).toBeVisible();

  const second = await browser.newContext({ extraHTTPHeaders: {}, storageState: undefined });
  const secondPage = await second.newPage();
  await secondPage.goto(made.url);
  await expect(
    secondPage.getByRole('heading', { name: 'Open Conch from your apps' }),
  ).toBeVisible();
  await expect(secondPage.getByText(/expired or was already used/)).toBeVisible();
  await first.close();
  await second.close();
});

test('the page says it plainly, light and dark', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Open Conch from your apps' })).toBeVisible();
  // Let the entrance settle, then keep both for visual review.
  await page.waitForTimeout(900);
  await page.screenshot({ path: test.info().outputPath('open-from-your-apps.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath('open-from-your-apps-dark.png') });
});
