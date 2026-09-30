import { expect, test, type Page } from '@playwright/test';

/**
 * The terminal, end to end: a real shell on this machine, in the drawer.
 * Ctrl+` opens it with a terminal ready; what it printed is still there after
 * hiding the drawer and reloading the page; tabs come and go; and turning
 * terminals off in Settings takes the button, the drawer and the shells with it.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

/** The header's button (the drawer has its own "Hide the terminal" too). */
const toggle = (page: Page) =>
  page.locator('main > header').getByRole('button', { name: /the terminal/ });
const drawer = (page: Page) => page.getByRole('region', { name: 'Terminal' });

/** What the terminal says, as a screen reader reads it (the setting is on below). */
const screenText = (page: Page) => page.locator('.xterm-accessibility-tree').first();

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  // Screen reader support also puts what the shell prints in the page, where we can read it.
  const res = await request.patch('/api/terminal/settings', {
    data: { enabled: true, screenReader: true },
  });
  expect(res.ok()).toBe(true);
});

test('a real shell a keystroke away, still there when you come back', async ({ page }) => {
  const csp = watchCsp(page);
  await page.goto('/');
  await expect(toggle(page)).toHaveAccessibleName('Show the terminal');

  // Ctrl+` opens the drawer with a terminal already running, and focused.
  await page.keyboard.press(`${mod}+Backquote`);
  const tabs = page.getByRole('tablist', { name: 'Terminals' });
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(page.getByText('Connecting…')).toBeHidden({ timeout: 15_000 });

  // Works in bash, zsh and PowerShell alike; only the shell can print 42.
  await page.keyboard.type('echo "conch-$((6*7))"');
  await page.keyboard.press('Enter');
  await expect(screenText(page)).toContainText('conch-42', { timeout: 15_000 });

  // Hidden and shown again: the same shell, with what it printed.
  await page.keyboard.press(`${mod}+Backquote`);
  await expect(tabs).toBeHidden();
  await toggle(page).click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(screenText(page)).toContainText('conch-42');

  // Even a reload finds it where you left it.
  await page.reload();
  await toggle(page).click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(screenText(page)).toContainText('conch-42', { timeout: 15_000 });

  // Another tab, then closing it.
  await drawer(page).getByRole('button', { name: 'New terminal' }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await drawer(page).getByRole('button', { name: 'Close this terminal' }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);

  expect(csp).toEqual([]);
});

test('turned off, the terminal steps aside, and one click turns it back on', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(toggle(page)).toBeVisible();
  await page.keyboard.press(`${mod}+Backquote`);
  const tabs = page.getByRole('tablist', { name: 'Terminals' });
  await expect(tabs.getByRole('tab')).toHaveCount(1);

  // Off in Settings: the shells end and the header button goes.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Terminal' }).click();
  await page.getByRole('switch', { name: 'Let me open terminals in Conch' }).click();
  await expect
    .poll(async () => (await (await request.get('/api/terminal')).json()).terminals.length)
    .toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByText('The terminal is turned off', { exact: true })).toBeVisible();
  await drawer(page).getByRole('button', { name: 'Hide the terminal' }).click();
  await expect(toggle(page)).toHaveCount(0);

  // Ctrl+` still explains itself, and turns it back on right there.
  await page.keyboard.press(`${mod}+Backquote`);
  await page.getByRole('button', { name: 'Turn it on' }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(page.getByText('Connecting…')).toBeHidden({ timeout: 15_000 });
  await expect(toggle(page)).toHaveAccessibleName('Hide the terminal');
});
