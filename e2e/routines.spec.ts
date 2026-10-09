import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  // Each test starts with no routines.
  for (const r of await (await request.get('/api/routines')).json()) {
    await request.delete(`/api/routines/${r.id}`);
  }
});

test('create from an idea, run it, and read the result', async ({ page }) => {
  await page.goto('/routines');
  await expect(page.getByRole('heading', { name: 'Nothing scheduled yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Create your first routine' }).click();

  await page.getByRole('button', { name: /Morning briefing/ }).click();
  const editor = page.getByRole('dialog', { name: 'New routine' });
  // Conch words the schedule in its own computer's locale: "7:30 AM", or "7:30" where
  // clocks run to 24 hours.
  await expect(editor.getByText(/^Every weekday at 7:30( AM)?$/).first()).toBeVisible();
  await editor.getByRole('button', { name: 'Turn on' }).click();

  await expect(page).toHaveURL(/\/routines\/r_/);
  await expect(page.getByRole('heading', { name: 'Morning briefing', level: 1 })).toBeVisible();
  await expect(page.getByText(/Next run /).first()).toBeVisible();
  // Where you are: one trail in the header, Routines a step back to them all.
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(trail.getByText('Morning briefing')).toHaveAttribute('aria-current', 'page');
  await expect(trail.getByRole('link', { name: 'Routines' })).toHaveAttribute('href', '/routines');
  await expect(page.getByRole('main').getByRole('link', { name: 'Routines' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Run now' }).click();
  await expect(
    page.getByText('Sent your briefing: 3 meetings and rain after 4pm').first(),
  ).toBeVisible();

  // Each run is a real conversation, marked as a routine run.
  await page
    .getByRole('button', { name: /Sent your briefing/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/c\/c_/);
  await expect(page.getByRole('note')).toContainText('Morning briefing');
  await expect(page.getByText('Routine instruction')).toBeVisible();
  // Runs stay out of the chat list.
  await expect(page.getByRole('navigation').getByText('Morning briefing')).toHaveCount(0);
});

test('Conch drafts a routine from a chat; you turn it on', async ({ page, request }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('Every morning, give me a weather briefing');
  await composer.press('Enter');

  await expect(page.getByText('New routine').first()).toBeVisible();
  const before = await (await request.get('/api/routines')).json();
  const draft = before.find((r: { status: string }) => r.status === 'draft');
  expect(draft).toMatchObject({
    createdBy: 'agent',
    scheduleText: expect.stringMatching(/^Every weekday/),
  });

  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText(/Routine on/i)).toBeVisible();
  await expect
    .poll(async () => {
      const all = await (await request.get('/api/routines')).json();
      return all.find((r: { id: string }) => r.id === draft.id)?.status;
    })
    .toBe('active');

  // Asking again doesn't create a duplicate.
  await composer.fill('Every morning, give me a weather briefing');
  await composer.press('Enter');
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/routines')).json()).filter(
          (r: { title: string }) => r.title === 'Morning briefing',
        ).length,
    )
    .toBe(1);
});

test('the editor prevents mistakes', async ({ page }) => {
  await page.goto('/routines');
  await page
    .getByRole('button', { name: /New routine|Create your first routine/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Set it up yourself' }).click();
  const editor = page.getByRole('dialog', { name: 'New routine' });
  await expect(editor.getByRole('button', { name: 'Turn on' })).toBeDisabled();
  await expect(editor.getByText('Give it a name.')).toBeVisible();

  await editor.getByRole('textbox', { name: 'Name' }).fill('Water the plants');
  await editor
    .getByRole('textbox', { name: /What should Conch do/ })
    .fill('Remind me to water the plants.');
  await expect(editor.getByRole('button', { name: 'Turn on' })).toBeEnabled();
});

test('a routine’s page fits a phone, details open, however long its words', async ({
  browser,
  request,
}, info) => {
  const long =
    'Read my food diary with app_yazio__read_diary_entries_for_the_whole_week_including_snacks, ' +
    'then my runs from https://connect.example.com/modern/activities?activityType=running&sortOrder=desc&limit=50, ' +
    'and write the recap.\n' +
    'Keep the totals in ~/Documents/fitness/weekly-recaps/2026/recap-with-a-rather-long-file-name.md';
  const made = [
    await request.post('/api/routines', {
      data: {
        title: 'Weekly fitness recap',
        summary: 'Food, runs and sleep from the week, in a few lines.',
        prompt: long,
        schedule: { type: 'weekly', days: ['sun'], time: '18:00' },
        timezone: 'America/Argentina/ComodRivadavia',
        status: 'active',
        runLimitUsd: 3,
      },
    }),
    await request.post('/api/routines', {
      data: {
        title: 'When the shop calls in',
        prompt: long,
        when: { kind: 'hook' },
        status: 'active',
        timezone: 'Europe/Berlin',
      },
    }),
  ];
  const phone = await browser.newContext({
    baseURL: info.project.use.baseURL,
    storageState: info.project.use.storageState,
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await phone.newPage();
  for (const [i, res] of made.entries()) {
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };
    await page.goto(`/routines/${id}`);
    await page.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByText('Permissions')).toBeVisible();
    // Nothing on it scrolls the page sideways: long words wrap, code scrolls in its own box.
    // The page is the title's scroller and everything around it, up to the window.
    const sideways = await page.evaluate(() => {
      const out: string[] = [];
      for (let el = document.querySelector('h1'); el; el = el.parentElement)
        if (el.scrollWidth > el.clientWidth + 1)
          out.push(`${el.tagName}.${el.className}: ${el.scrollWidth} > ${el.clientWidth}`);
      return out;
    });
    expect(sideways).toEqual([]);
    // The page scrolls inside itself: a tall phone shows all of it in one picture.
    await page.setViewportSize({ width: 390, height: 2600 });
    await shot(page, `routine-${i}-phone.png`);
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await phone.close();
});

/** Light and dark, kept beside the test's own results (or `CONCH_SHOTS`). */
async function shot(page: Page, name: string) {
  const dir = process.env.CONCH_SHOTS ?? test.info().outputDir;
  await page.waitForTimeout(400);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: join(dir, scheme === 'light' ? name : name.replace('.png', '-dark.png')),
      fullPage: true,
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}
