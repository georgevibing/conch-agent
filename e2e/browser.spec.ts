import { createServer, type Server } from 'node:http';

import { expect, test } from '@playwright/test';

/**
 * The browser, end to end: the gateway drives a real headless browser (the
 * one on this machine) against a little site served here, and the mock
 * engine asks for what a real one would. Everything a person sees is real:
 * the panel, the questions, the handoff.
 */

const pages: Record<string, string> = {
  '/': `<title>Staylight · Hotels in Lisbon</title><h1>Hotels in Lisbon</h1>
    <div>Casa do Rio · €128 <a href="/hotel/0">See availability</a></div>
    <p><a href="/signin">Sign in</a></p>`,
  '/hotel/0': `<title>Casa do Rio</title><h1>Casa do Rio</h1><p>€384 total</p><button>Book now</button>`,
  '/signin': `<title>Sign in · Staylight</title><h1>Sign in</h1>
    <form onsubmit="event.preventDefault();document.title='Signed in';document.body.textContent='Welcome back'">
    <label>Email <input name="email" type="email"></label>
    <label>Password <input name="password" type="password"></label>
    <button>Sign in</button></form>`,
};

let site: Server;
let origin = '';

test.beforeAll(async () => {
  site = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>${pages[req.url ?? '/'] ?? pages['/']}`);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  // The gateway's browser keeps connections alive; don't wait for it to let go.
  site.closeAllConnections();
  await new Promise((resolve) => site.close(resolve));
});

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  // The test site is on this computer, which the browser avoids unless told.
  const res = await request.patch('/api/browser/settings', { data: { allowLocal: true } });
  expect(res.ok()).toBe(true);
});

test('watch it browse, allow the site once, and find it all in the chat', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /^Message/ });
  await composer.fill(`Open ${origin}/ and click “See availability”`);
  await composer.press('Enter');

  // The panel slides in by itself and shows the page.
  const panel = page.getByRole('complementary', { name: 'Browser panel' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: /Address: .*127\.0\.0\.1/ })).toBeVisible();

  // Acting on a new site asks once, showing what it's about to do.
  await expect(page.getByText('Let Conch use 127.0.0.1?')).toBeVisible();
  await expect(page.getByText('First: Click “See availability”')).toBeVisible();
  await page.getByRole('button', { name: 'Allow in this chat' }).click();

  await expect(page.getByText(/clicked “See availability”/)).toBeVisible();
  await expect(page.getByText('Allowed on 127.0.0.1 in this chat')).toBeVisible();
  await expect(page.getByRole('button', { name: /Browsed 127\.0\.0\.1 · 2 steps/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: /Address: .*\/hotel\/0/ })).toBeVisible();

  // Close it; the header brings it back.
  await panel.getByRole('button', { name: 'Close the browser panel' }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Show the browser' }).click();
  await expect(panel).toBeVisible();
});

test('hand over to sign in: you type, the assistant never sees it', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /^Message/ });
  await composer.fill(`Open ${origin}/signin and sign in for me`);
  await composer.press('Enter');

  const turn = page.getByRole('group', { name: 'Your turn in the browser' });
  await expect(turn).toBeVisible();
  await expect(turn).toContainText('Sign in to 127.0.0.1');

  // You drive: the keys go to the page through the panel.
  const keys = page.getByRole('textbox', { name: 'Type into the page' });
  await keys.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.type('ada@example.com');
  await page.keyboard.press('Tab');
  await page.keyboard.type('pearl-secret-42');
  await page.keyboard.press('Enter');
  await turn.getByRole('button', { name: 'I’m done' }).click();

  await expect(page.getByText(/waited while you signed in/)).toBeVisible();
  await expect(page.getByText(/You took care of it/)).toBeVisible();
  await expect(page.locator('main')).not.toContainText('pearl-secret-42');
});

test('settings show the browser it found, and changes stick', async ({ page, request }) => {
  await page.goto('/');
  await page.keyboard.press('Control+,');
  await page.getByRole('tab', { name: 'Browser' }).click();
  await expect(page.getByRole('heading', { name: 'Browser', level: 3 })).toBeVisible();
  const cookies = page.getByRole('switch', { name: 'Decline cookie banners for you' });
  await expect(cookies).toBeChecked();
  await cookies.click();
  await expect(cookies).not.toBeChecked();
  await expect
    .poll(async () => (await (await request.get('/api/browser')).json()).settings.declineCookies)
    .toBe(false);
});
