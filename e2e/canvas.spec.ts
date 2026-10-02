import { expect, test, type Locator, type Page } from '@playwright/test';

import { openConch } from './app';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Edit by hand and live data, end to end (ADR 0046): a chart edited in the
 * panel with its preview following, mistakes said in words, undo, ⌘S, a
 * version marked as yours that the assistant then builds on; a page edited
 * with its preview still sealed; the phone; and a page that reads live data
 * from a pretend site — asked once, read through Conch, updated, failing
 * calmly, taken back, pinned — with each way a page could abuse it refused.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

async function ask(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill(text);
  await composer.press('Enter');
}

/** Replace everything in the editor, as a paste would. */
async function replaceCode(page: Page, editor: Locator, text: string) {
  await editor.click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText(text);
}

const week = (fri: number) =>
  JSON.stringify(
    {
      type: 'bar',
      title: 'Visitors this week',
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      series: [{ name: 'Visitors', values: [120, 180, 150, 210, fri] }],
      unit: 'visitors',
    },
    null,
    2,
  );

test('a chart edited by hand: live preview, mistakes in words, undo, ⌘S, and the assistant builds on it', async ({
  page,
}) => {
  await page.goto('/');
  await ask(page, 'make me a chart of my visitors this week');
  const panel = page.getByRole('region', { name: 'Visitors this week' });
  await panel.getByRole('button', { name: 'Edit' }).click();
  const code = panel.getByRole('textbox', { name: 'Code of Visitors this week' });
  await expect(code).toBeVisible();
  const save = panel.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();

  // A mistake is said in words a person can act on, and Save waits.
  await replaceCode(page, code, '{\n  "type": "bar",\n  "labels": ["Mon"]\n  "series": []\n}');
  await expect(panel.getByText(/The chart’s JSON has a mistake on line 4/)).toBeVisible();
  await expect(save).toBeDisabled();
  // Undo takes it back.
  await expect(async () => {
    await panel.getByRole('button', { name: 'Undo' }).click();
    await expect(panel.getByText(/JSON has a mistake/)).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await expect(panel.getByRole('button', { name: 'Redo' })).toBeEnabled();

  // A real change: the preview follows (here, a press away: the panel is narrow).
  await replaceCode(page, code, week(999));
  const show = panel.getByRole('radiogroup', { name: 'Show' });
  if (await show.isVisible()) await show.getByRole('radio', { name: 'Preview' }).click();
  const preview = panel.getByRole('region', { name: 'Preview of Visitors this week' });
  await preview.getByRole('radio', { name: 'Table' }).click();
  await expect(preview.getByRole('row', { name: /Fri 999 visitors/ })).toBeVisible();

  // ⌘S saves from anywhere in the editor: a new version, marked as yours.
  await preview.getByRole('radio', { name: 'Table' }).focus();
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByText('Saved as version 2')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Visitors this week.*Chart · edited by you · version 2/ }),
  ).toBeVisible();
  await panel.getByRole('tab', { name: 'Changes' }).click();
  await expect(panel.getByText('999').first()).toBeVisible();

  // The assistant's next change starts from yours, and keeps it.
  await ask(page, 'make it a line');
  await expect(
    page.getByRole('button', { name: /Chart · version 3 · Made it a line, keeping your edit/ }),
  ).toBeVisible();
  await panel.getByRole('tab', { name: 'View' }).click();
  await expect(panel.getByRole('img', { name: /line chart/ })).toBeVisible();
  await panel.getByRole('radio', { name: 'Table' }).click();
  await expect(panel.getByRole('row', { name: /Fri 999 visitors/ })).toBeVisible();

  // Activity says it was you.
  await page.goto('/activity');
  await page.getByRole('radio', { name: 'Made' }).click();
  await expect(page.getByText('You edited “Visitors this week” (version 2)').first()).toBeVisible();
});

test('a page edited by hand stays sealed; Esc asks before throwing an edit away', async ({
  page,
}) => {
  await page.goto('/');
  await ask(page, 'make me a page that works out a tip');
  const panel = page.getByRole('region', { name: 'Tip calculator' });
  await expect(
    page.frameLocator('iframe[title="Tip calculator"]').getByText('Tip: 6.00'),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Edit' }).click();
  const code = panel.getByRole('textbox', { name: 'Code of Tip calculator' });
  await replaceCode(
    page,
    code,
    '<h1>Tip, edited</h1><p id="out"></p><script>document.getElementById("out").textContent="Tip: "+(40*0.2).toFixed(2)</script>',
  );
  const show = panel.getByRole('radiogroup', { name: 'Show' });
  if (await show.isVisible()) await show.getByRole('radio', { name: 'Preview' }).click();
  const frame = panel.locator('iframe[title="Tip calculator"]');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frame).toHaveAttribute('src', /\/versions\/draft\/frame\?theme=\w+&rev=\d+/);
  await expect(
    page.frameLocator('iframe[title="Tip calculator"]').getByText('Tip: 8.00'),
  ).toBeVisible();

  // The draft is as sealed as a saved page: nobody, no network, no Conch.
  const inside = page.frames().find((f) => f.url().includes('/versions/draft/frame'));
  expect(inside).toBeDefined();
  const tries = await inside!.evaluate(async () => {
    const attempt = async (f: () => unknown) => {
      try {
        return `ok:${String(await f())}`;
      } catch (e) {
        return `refused:${(e as Error).name}`;
      }
    };
    return {
      origin: self.origin,
      cookie: await attempt(() => document.cookie),
      fetchApi: await attempt(() => fetch('/api/state').then((r) => r.status)),
    };
  });
  expect(tries).toEqual({
    origin: 'null',
    cookie: expect.stringMatching(/^refused:SecurityError/),
    fetchApi: expect.stringMatching(/^refused:TypeError/),
  });

  // Esc with changes asks first; keep editing, then let it go.
  if (await show.isVisible()) await show.getByRole('radio', { name: 'Edit' }).click();
  await code.click();
  await page.keyboard.press('Escape');
  const discard = page.getByRole('alertdialog', {
    name: 'Discard your changes to “Tip calculator”?',
  });
  await discard.getByRole('button', { name: 'Keep editing' }).click();
  await expect(code).toBeVisible();
  await code.click();
  await page.keyboard.press('Escape');
  await discard.getByRole('button', { name: 'Discard' }).click();
  await expect(panel.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(
    page.frameLocator('iframe[title="Tip calculator"]').getByText('Tip: 6.00'),
  ).toBeVisible();
});

test('on a phone: edit or preview, a table’s mistake in words, and Esc doesn’t lose the sheet', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/');
  await ask(page, 'make me a table of my budget');
  const sheet = page.getByRole('dialog', { name: 'Made for you' });
  await sheet.getByRole('button', { name: 'Edit' }).click();
  const code = sheet.getByRole('textbox', { name: 'Code of Budget' });
  await replaceCode(page, code, 'Item,Cost\nRent,1200,extra\nFood,400');
  await expect(sheet.getByText('Line 2 has 3 values, but the header has 2.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
  await replaceCode(page, code, 'Item,Cost\nRent,1300\nFood,400');
  await sheet.getByRole('radio', { name: 'Preview' }).click();
  await expect(sheet.getByRole('row', { name: /Rent 1300/ })).toBeVisible();
  await sheet.getByRole('radio', { name: 'Edit' }).click();
  await code.click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved as version 2')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Edit' })).toBeVisible();
  await context.close();
});

test('live data: asked once, read through Conch, updated, failing calmly, taken back, pinned — and never abused', async ({
  page,
  request,
}) => {
  // One wait of 15 seconds: the same address isn't read again sooner.
  test.setTimeout(120_000);
  await page.goto('/');
  await ask(page, 'make me a live page');
  const panel = page.getByRole('region', { name: 'Weather now' });
  const frame = page.frameLocator('iframe[title="Weather now"]');
  // Until you say, the page gets nothing, and says why.
  await expect(frame.getByText(/This page wants to read from localhost:\d+/)).toBeVisible();
  const question = panel.getByRole('group', {
    name: /Let “Weather now” read live data from localhost:\d+/,
  });
  await expect(question).toBeVisible();
  const site = /localhost:(\d+)/.exec((await question.textContent()) ?? '')?.[0] ?? '';
  expect(site).not.toBe('');
  await expect(question.getByText(`http://${site}/weather?city={city}`)).toBeVisible();
  // On this computer: it takes a second, explicit yes.
  const allow = question.getByRole('button', { name: 'Allow' });
  await expect(allow).toBeDisabled();
  await question.getByRole('checkbox', { name: /Let it read from this computer/ }).click();
  await allow.click();
  await expect(frame.getByText('berlin: 21°')).toBeVisible();
  await expect(panel.getByText(/Live · Updated just now · every 1 min/)).toBeVisible();

  // Every way a page might abuse the bridge, refused.
  const reads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/live-data')) reads.push(r.url());
  });
  const inside = page.frames().find((f) => f.url().includes('/frame') && f.url().includes('live='));
  expect(inside).toBeDefined();
  const id = /artifacts\/(a_[A-Za-z0-9]+)/.exec(inside!.url())?.[1];
  const tries = await inside!.evaluate(
    async ({ id, site }) => {
      const attempt = async (f: () => unknown) => {
        try {
          return `ok:${String(await f())}`;
        } catch (e) {
          return `refused:${(e as Error).name}`;
        }
      };
      type Read = { ok: boolean; message: string; text: string };
      const conch = (
        window as unknown as {
          conch: { data: (s: string, p?: unknown) => Promise<Read> };
        }
      ).conch;
      return {
        // No bridge: the page has no network of its own, to Conch or the site.
        fetchConch: await attempt(() =>
          fetch(`/api/artifacts/${id}/versions/1/live-data`, { method: 'POST' }).then(
            (r) => r.status,
          ),
        ),
        fetchSite: await attempt(() =>
          fetch(`http://${site}/weather?city=berlin`).then((r) => r.status),
        ),
        // Only what it declared, filled in only as declared.
        undeclared: (await conch.data('elsewhere')).message,
        freeText: (await conch.data('weather', { city: 'my secret is 1234' })).message,
        // A redirect to cloud metadata is never followed.
        redirect: (await conch.data('weather', { city: 'lisbon' })).message,
      };
    },
    { id, site },
  );
  expect(tries.fetchConch).toMatch(/^refused:TypeError/);
  expect(tries.fetchSite).toMatch(/^refused:TypeError/);
  expect(tries.undeclared).toMatch(/doesn’t declare “elsewhere”/);
  expect(tries.freeText).toMatch(/doesn’t allow/);
  // Sent on to cloud metadata: refused, never followed.
  expect(tries.redirect).toMatch(
    /169\.254\.169\.254, which this page may not read from|never connects to/,
  );
  // A message that doesn't come from the page's own frame is never passed on.
  const before = reads.length;
  await page.evaluate(() =>
    window.postMessage({ conch: 'artifact', data: { id: 'x1', source: 'weather' } }, '*'),
  );
  await inside!.evaluate(() =>
    parent.postMessage(
      {
        conch: 'artifact',
        data: { id: 'x2', source: 'weather', params: { city: 'x'.repeat(200) } },
      },
      '*',
    ),
  );
  await page.waitForTimeout(500);
  expect(reads.length).toBe(before);
  // Nothing of yours went with any read.
  expect((await (await request.get(`http://${site}/__state`)).json()).reads).toBeGreaterThan(0);

  // The site goes down: calm, with what it had. (The same address is reused for 15 seconds.)
  await request.post(`http://${site}/__control`, { data: { fail: true } });
  await page.waitForTimeout(15_500);
  // (It may have read again by itself by now, every minute: then the button says Try again.)
  await panel.getByRole('button', { name: /Update now|Try again/ }).click();
  await expect(
    panel.getByText(/Couldn’t update: The site answered with an error \(503\)/),
  ).toBeVisible();
  await expect(frame.getByText('berlin: 21°')).toBeVisible();
  await request.post(`http://${site}/__control`, { data: { fail: false, temp: 23 } });

  // Settings → Security lists it, and the checkup says a page reads this computer.
  await page.keyboard.press(`${mod}+,`);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Security' }).click();
  await expect(settings.getByText(`A page can read from ${site} on this computer`)).toBeVisible();
  const list = settings.getByRole('list', { name: 'Sites pages may read from' });
  await expect(list.getByText(site)).toBeVisible();
  await list.getByRole('button', { name: `Take back ${site} from Weather now` }).click();
  await expect(settings.getByText('No page reads live data')).toBeVisible();
  await page.keyboard.press('Escape');

  // Taken back: the page asks again. Pinned as an app, it keeps showing live data.
  await expect(question).toBeVisible();
  await panel.getByRole('button', { name: 'Pin as an app' }).click();
  await page
    .getByRole('region', { name: 'Pinned' })
    .getByRole('button', { name: 'Weather now' })
    .click();
  await expect(page).toHaveURL(/\/apps\/a_/);
  const app = page.getByRole('region', { name: 'Weather now' });
  const again = app.getByRole('group', { name: /Let “Weather now” read live data/ });
  await again.getByRole('checkbox', { name: /Let it read from this computer/ }).click();
  await again.getByRole('button', { name: 'Allow' }).click();
  await expect(
    page.frameLocator('iframe[title="Weather now"]').getByText('berlin: 23°'),
  ).toBeVisible();
  await expect(app.getByText(/Live · Updated just now/)).toBeVisible();

  // ⌘K finds where the OKs are kept.
  await openConch(page);
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('live data');
  await page.getByRole('option', { name: /Settings: Live data in pages/ }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Settings' })
      .getByRole('list', { name: 'Sites pages may read from' }),
  ).toBeVisible();
});
