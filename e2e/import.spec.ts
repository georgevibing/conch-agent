import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { openConch, toProviders } from './app';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const run = promisify(execFile);
const root = join(import.meta.dirname, '..');

/**
 * Come home, end to end (ADR 0035), from a pretend OpenClaw: the offer when
 * you first open Conch, the preview with what starts unticked and why,
 * bringing things over with a backup first, what came and what's next,
 * Undo; and `pnpm conch import --dry-run`, which changes nothing.
 */
test.describe.configure({ mode: 'serial' });

test('the first run offers to bring your things, and Not now carries on', async ({
  page,
  request,
}) => {
  await request.patch('/api/settings', { data: { onboarded: false } });
  await page.goto('/');
  await toProviders(page);
  // A provider is ready, so the welcome carries on to the apps by itself.
  await page.getByRole('button', { name: 'Skip for now' }).click({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Bring your things from OpenClaw?' })).toBeVisible(
    { timeout: 10_000 },
  );
  await expect(page.getByRole('region', { name: 'Bring your things from OpenClaw' })).toContainText(
    '3 memories',
  );
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('heading', { name: /You’re all set/ })).toBeVisible();
});

test('previews, brings things over after a backup, says what’s next, and undoes it', async ({
  page,
  request,
}) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  await openConch(page);
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('openclaw');
  await page.getByRole('option', { name: /Bring your things from OpenClaw or Hermes/ }).click();

  // A page inside Settings, not a dialog of its own.
  const dialog = page.getByRole('dialog', { name: 'Settings' }).getByRole('tabpanel');
  await expect(
    dialog.getByRole('heading', { name: 'Bring your things from OpenClaw', level: 2 }),
  ).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Memories' })).toBeVisible();
  // Safe things start ticked; a worrying skill, the bot and the keys don't, and say why.
  await expect(dialog.getByRole('checkbox', { name: /Ada takes her tea/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /Solana helper/ })).not.toBeChecked();
  await expect(dialog.getByText('Conch found something worrying').first()).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /Your Telegram bot/ })).not.toBeChecked();
  await expect(dialog.getByText(/Stop OpenClaw first/)).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /Your OpenRouter key/ })).not.toBeChecked();
  // A daily note is offered, not ticked; a link out of the folder never shows up.
  await expect(dialog.getByRole('checkbox', { name: /Booked the dentist/ })).not.toBeChecked();
  await expect(dialog).not.toContainText('the-ssh-key');
  await expect(dialog).not.toContainText('not-real');

  await dialog.getByRole('button', { name: 'Show what it says' }).first().click();
  await expect(dialog.getByText(/British spelling/).first()).toBeVisible();

  await dialog.getByRole('button', { name: /^Bring \d+ things over$/ }).click();
  const summary = page.getByRole('region', { name: 'Your things from OpenClaw are here' });
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText('3 memories');
  await expect(summary).toContainText('1 skill, off for now');
  await expect(summary).toContainText('1 routine, as a draft');
  await expect(summary).toContainText('backed itself up first');
  await page.getByRole('button', { name: 'Done' }).click();

  // It's all here: the name, the memories, the draft routine, the skill (off).
  const settings = page.getByRole('dialog', { name: /Settings/ });
  await expect(settings.getByText('3 memories', { exact: true })).toBeVisible();
  expect(JSON.stringify(await (await request.get('/api/memories')).json())).toContain(
    'Ada takes her tea with lemon.',
  );
  await expect(settings.getByText(/came from OpenClaw/)).toBeVisible();
  const routines = await (await request.get('/api/routines')).json();
  expect(JSON.stringify(routines)).toContain('Morning briefing');
  expect(JSON.stringify(routines)).toContain('"draft"');

  await settings.getByRole('button', { name: 'Undo that import' }).click();
  await expect(page.getByText('Took back what came from OpenClaw')).toBeVisible();
  await expect(settings.getByText('Nothing remembered yet')).toBeVisible();
  const after = await (await request.get('/api/routines')).json();
  expect(JSON.stringify(after)).not.toContain('Morning briefing');
});

test('pnpm conch import --dry-run lists what would come, and changes nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'conch-e2e-import-cli-'));
  const { stdout } = await run(
    process.execPath,
    ['--import', 'tsx', 'src/cli.ts', 'import', '--from', 'openclaw', '--dry-run'],
    {
      cwd: join(root, 'apps/server'),
      env: {
        ...process.env,
        CONCH_HOME: home,
        CONCH_IMPORT_HOME: process.env.CONCH_E2E_IMPORT_HOME,
        FORCE_COLOR: '0',
      },
    },
  );
  expect(stdout).toContain('Ada takes her tea with lemon.');
  expect(stdout).toContain('Nothing was changed');
  expect(stdout).not.toContain('not-real');
});
