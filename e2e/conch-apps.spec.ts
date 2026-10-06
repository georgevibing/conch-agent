import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { openConch, say } from './app';

/**
 * Apps you make, share and add (ADR 0061), end to end on the real parts: the
 * mock engine makes Tally the real way (the maker's tools, the check, the
 * card), the person adds it, a message uses its tool, its page counts with a
 * press, that page is drawn by the page kit (its head lines up with its icon,
 * its select is Conch's own), it's saved as a file, removed, and added back
 * from that file. Then
 * the attacks from inside its page: no network, no other app's tools, and
 * no change without a press.
 *
 * The gateway never sees a GitHub sign-in (its `GH_CONFIG_DIR` is empty), so
 * nothing here can publish anything.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

const tally = (page: Page) => page.frameLocator('iframe[title="Tally"]');

test('make Tally, add it, use it, count on its page, save it, remove it and add it back', async ({
  page,
  request,
}, testInfo) => {
  // 1. Apps → Add your own → Describe it → Build it.
  await page.goto('/apps');
  await page.getByRole('button', { name: 'Add your own' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add your own' });
  await expect(dialog.getByRole('tab', { name: 'Describe it' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await dialog
    .getByRole('textbox', { name: 'What should it do?' })
    .fill('Count things for me, with a big button');
  await dialog.getByRole('button', { name: /Build it/ }).click();
  await expect(page).toHaveURL(/\/c\/c_/, { timeout: 15_000 });

  // 2. The mock builds Tally; its card comes under the reply → Add to my apps.
  await expect(page.getByText(/Press Add to my apps on the card/)).toBeVisible({
    timeout: 30_000,
  });
  const card = page.getByRole('group', { name: 'Tally' });
  await expect(card).toContainText('Reaches no websites');
  await card.getByRole('button', { name: 'Add Tally to my apps' }).click();
  await expect(page.getByText('Tally is in your apps')).toBeVisible();
  // Its page is in the sidebar.
  await expect(page.getByRole('region', { name: 'Pinned apps' })).toContainText('Tally');

  // 3. A message uses its tool: a change, so it asks first.
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('count one more');
  await composer.press('Enter');
  await page
    .getByRole('button', { name: /^Allow( once)?$/ })
    .first()
    .click({ timeout: 20_000 });
  await expect(page.getByText('Counted. The tally is at 1.')).toBeVisible({ timeout: 20_000 });

  // 4. The app's page → Open Tally → a press in the page counts, with no question.
  await page.goto('/apps/capp_tally');
  await expect(page.getByRole('heading', { level: 1, name: 'Tally' })).toBeVisible();
  await expect(page.getByText('Made by you · 1.0.0')).toBeVisible();
  await page.getByRole('button', { name: 'Open Tally' }).click();
  await expect(page).toHaveURL(/\/apps\/capp_tally\/main$/);
  await expect(tally(page).locator('#total')).toHaveText('1');
  await tally(page).getByRole('button', { name: 'Count one more' }).click();
  await expect(tally(page).locator('#total')).toHaveText('2');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // 4a. The page is drawn by the page kit, not by the system (ADR 0061).
  // Its head: the icon and the title block share one middle, at any width.
  const offMiddle = () =>
    tally(page)
      .locator('.nc-page-head')
      .evaluate((head) => {
        const icon = head.querySelector('svg')?.getBoundingClientRect();
        const titles = head.querySelector('div')?.getBoundingClientRect();
        if (!icon || !titles) throw new Error('Tally’s page has no head');
        return Math.abs(icon.y + icon.height / 2 - (titles.y + titles.height / 2));
      });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(offMiddle, { message: `the head at ${width}px` }).toBeLessThan(1.5);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  // Its select: the system's arrow is gone, Conch's chevron is drawn, and the
  // words stop well before it — which a bare <select> never did.
  const select = tally(page).locator('#by');
  await expect(select).toHaveCSS('appearance', 'none');
  const look = await select.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      room: Number.parseFloat(style.paddingInlineEnd),
      chevrons: style.backgroundImage.split('linear-gradient').length - 1,
      height: node.getBoundingClientRect().height,
    };
  });
  expect(look.room).toBeGreaterThanOrEqual(28);
  expect(look.chevrons).toBe(2);
  // The same height as the button beside it: one row, not two sizes.
  const button = await tally(page).getByRole('button', { name: 'Count one more' }).boundingBox();
  expect(Math.abs(look.height - (button?.height ?? 0))).toBeLessThan(1.5);
  // And it is a real select: choosing works with the keyboard and the pointer.
  await select.selectOption('5');
  await expect(select).toHaveValue('5');
  await select.selectOption('1');

  // Its page says where it is, Apps › Tally › its name, and Tally goes back to the app.
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(trail.getByRole('link')).toHaveText(['Apps', 'Tally']);
  await trail.getByRole('link', { name: 'Tally' }).click();
  await expect(page).toHaveURL(/\/apps\/capp_tally$/);
  // Where it is now, whichever trail the route has settled on (the page's own
  // trail says Apps › Tally › Tally until the app's page takes over).
  await expect(trail.locator('[aria-current="page"]')).toHaveText('Tally');

  // 5. Save as a file.
  await page.goto('/apps/capp_tally');
  await page.getByRole('button', { name: 'Share' }).click();
  const share = page.getByRole('dialog', { name: 'Share Tally' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    share.getByRole('button', { name: 'Save as a file' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('tally.conchapp');
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  expect(readFileSync(file).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
  await page.keyboard.press('Escape');

  // 6. Remove it (keeping what it counted) → add it back from that file.
  await page.getByRole('button', { name: 'Remove Tally' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Remove Tally?' });
  await expect(ask.getByRole('checkbox', { name: /Keep what it saved/ })).toBeChecked();
  await ask.getByRole('button', { name: 'Remove' }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(page.getByRole('article', { name: 'Tally' })).toHaveCount(0);
  expect((await (await request.get('/api/conch-apps')).json()).apps).toHaveLength(0);

  await page.getByRole('button', { name: 'Add your own' }).click();
  await page.getByRole('tab', { name: 'From a link' }).click();
  // The browser's own chooser (the system's dialog is for a person at this computer).
  await page.setInputFiles('input[type=file]', file);
  const found = page.getByRole('region', { name: 'Tally' });
  await expect(found).toContainText(/Signed by /);
  await found.getByRole('button', { name: 'Add Tally to my apps' }).click();
  await expect(page).toHaveURL(/\/apps\/capp_tally$/);
  await expect(page.getByText(/Signed by .* · 1\.0\.0/)).toBeVisible();
  // What it counted was kept, and this is your own app (the file carries your signature),
  // so it carries on where it was.
  await page.getByRole('button', { name: 'Open Tally' }).click();
  await expect(tally(page).locator('#total')).toHaveText('2');
});

test('from inside its page, an app can’t fetch, can’t call another app’s tools, and can’t change anything without a press', async ({
  page,
  request,
}) => {
  const leaks: string[] = [];
  await page.context().route(/evil\.example/, async (route) => {
    leaks.push(route.request().url());
    await route.fulfill({ status: 204 });
  });
  // Tally, made and added the way a person does (none from before).
  await request.delete('/api/conch-apps/tally');
  await openConch(page);
  await say(page, 'make me an app that counts things', /Press Add to my apps on the card/);
  await page.getByRole('button', { name: 'Add Tally to my apps' }).click();
  await expect(page.getByText('Tally is in your apps')).toBeVisible();

  await page.goto('/apps/capp_tally/main');
  // Whatever it counted before (the journey above keeps its notes).
  const total = page.locator('iframe[title="Tally"]');
  await expect(tally(page).locator('#total')).toHaveText(/^\d+$/);
  const before = (await tally(page).locator('#total').textContent()) ?? '';
  await expect(total).toBeVisible();
  const frame = page.frames().find((f) => f.url().includes('/pages/main/frame'));
  if (!frame) throw new Error('Tally’s page isn’t there');

  // No network: not Conch, not the internet.
  const reached = await frame.evaluate(async () => {
    const tries = ['/api/conch-apps', '/api/conch-apps/tally/call', 'https://evil.example/x'];
    const out: string[] = [];
    for (const url of tries)
      try {
        await fetch(url, { method: url.endsWith('call') ? 'POST' : 'GET' });
        out.push(`reached ${url}`);
      } catch {
        out.push('blocked');
      }
    return out;
  });
  expect(reached).toEqual(['blocked', 'blocked', 'blocked']);
  expect(leaks).toEqual([]);

  // Only its own app's tools: anything else is refused in words, and nothing runs.
  const other = await frame.evaluate(() =>
    (
      window as unknown as { conch: { call: (t: string, i: object) => Promise<unknown> } }
    ).conch.call('delete_everything', {}),
  );
  expect(other).toMatchObject({ ok: false });
  const forged = await frame.evaluate(
    () =>
      new Promise((resolve) => {
        // A message that claims to be another app's: the panel answers for this app only.
        window.addEventListener('message', (e) => resolve(e.data));
        window.parent.postMessage(
          { conch: 'artifact', call: { id: 'x1', tool: 'app_other__wipe', input: {} } },
          '*',
        );
      }),
  );
  expect(forged).toMatchObject({ conch: 'app-call', result: { ok: false, reason: 'error' } });

  // A change with no press asks first; Not now means nothing changed.
  await page.mouse.click(5, 300);
  const answer = frame.evaluate(() =>
    (
      window as unknown as { conch: { call: (t: string, i: object) => Promise<unknown> } }
    ).conch.call('count', { by: 5 }),
  );
  const ask = page.getByRole('alertdialog', { name: 'Let Tally count one more?' });
  await expect(ask).toContainText('by: 5');
  await ask.getByRole('button', { name: 'Not now' }).click();
  expect(await answer).toMatchObject({ ok: false });
  await expect(tally(page).locator('#total')).toHaveText(before);
  const count = await request.post('/api/conch-apps/tally/call', {
    data: { tool: 'read_count', input: {} },
  });
  expect(await count.json()).toMatchObject({ ok: true, json: { total: Number(before) } });

  // And the gateway holds the line by itself: a change with no press is refused.
  const unpressed = await request.post('/api/conch-apps/tally/call', {
    data: { tool: 'count', input: { by: 1 } },
  });
  expect(await unpressed.json()).toMatchObject({ ok: false, reason: 'confirm' });
});

test('app pages autoload saved queries, remember preferences and update after a tool runs elsewhere', async ({
  page,
  request,
}, testInfo) => {
  await request.delete('/api/conch-apps/tally?keepData=0');
  await openConch(page);
  await say(page, 'make me an app that counts things', /Press Add to my apps on the card/);
  await page.getByRole('button', { name: 'Add Tally to my apps' }).click();
  await expect(page.getByText('Tally is in your apps')).toBeVisible();
  await page.goto('/apps/capp_tally/main');
  await expect(tally(page).locator('#total')).toHaveText('0');
  const frame = await page
    .locator('iframe[title="Tally"]')
    .elementHandle()
    .then((h) => h?.contentFrame());
  if (!frame) throw new Error('Tally’s page is missing');
  // Real opaque frame → bridge → authenticated host → bounded local state.
  await frame.evaluate(async () => {
    const app = (
      window as unknown as { conch: { state: { set(key: string, value: unknown): Promise<void> } } }
    ).conch;
    await app.state.set('selected-day', 'today');
  });
  // The same service call used by chat invalidates cached reads and notifies this open page.
  const changed = await request.post('/api/conch-apps/tally/call', {
    data: { tool: 'count', input: { by: 7 }, confirmed: true },
  });
  expect(changed.ok()).toBe(true);
  await expect(tally(page).locator('#total')).toHaveText('7');
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(
      (mode) => localStorage.setItem('conch.theme', JSON.stringify({ mode })),
      theme,
    );
    await page.reload();
    await expect(tally(page).locator('#total')).toHaveText('7');
    await page.screenshot({ path: testInfo.outputPath(`app-queries-${theme}.png`) });
  }
  const reopened = await page
    .locator('iframe[title="Tally"]')
    .elementHandle()
    .then((h) => h?.contentFrame());
  if (!reopened) throw new Error('Tally’s page is missing');
  expect(
    await reopened.evaluate(async () =>
      (
        window as unknown as { conch: { state: { get(key: string): Promise<unknown> } } }
      ).conch.state.get('selected-day'),
    ),
  ).toBe('today');
  const peek = await request.post('/api/conch-apps/tally/call', {
    data: { tool: '__query', input: { tool: 'read_count', input: {}, mode: 'peek' } },
  });
  expect(await peek.json()).toMatchObject({ ok: true, json: { value: { json: { total: 7 } } } });
  const unsafe = await request.post('/api/conch-apps/tally/call', {
    data: { tool: '__query', input: { tool: 'count', input: { by: 100 } }, confirmed: true },
  });
  expect(await unsafe.json()).toMatchObject({ ok: false });
});
