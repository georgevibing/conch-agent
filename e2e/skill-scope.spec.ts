import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { askFirst, autoAgain, openConch } from './app';

/**
 * Skill scope, end to end (ADR 0047): once a skill's instructions are in a
 * chat, the chat stays held to its list in later turns, after a reload, and
 * says so in one quiet line; only you stop it, it asks first, and Activity
 * notes both. And your key for signing skills is locked with this computer's
 * key: the terminal still signs with Conch running, nothing is in the clear,
 * and a key someone changed fails in words.
 */

const run = promisify(execFile);
const root = join(import.meta.dirname, '..');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const home = process.env.CONCH_E2E_SKILL_SCOPE_HOME ?? '';
const held = 'Held to Quick setup’s list. See what it can do';
const stop = 'Stop holding this chat to Quick setup’s list';

/** `pnpm conch …` beside this gateway, on its home (its key is a file here, as in every test run). */
async function conch(...args: string[]) {
  return run(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: join(root, 'apps/server'),
    env: { ...process.env, CONCH_HOME: home, CONCH_VAULT_KEYSTORE: 'file', FORCE_COLOR: '0' },
  });
}

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Sam' } } });
});
test.afterEach(async ({ request }) => {
  await autoAgain(request);
});

test('a chat stays held to a skill’s list until you stop it, and Activity says so', async ({
  page,
  request,
}) => {
  // Ask first, for the mode's own question once the hold is gone: Auto wouldn't ask (ADR 0119).
  await askFirst(request);
  const folder = join(home, 'skills', 'quick-setup');
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, 'SKILL.md'),
    '---\nname: quick-setup\ndescription: Sets a project up with git. Use when asked to set one up.\npermissions: commands:git\n---\n# Quick setup\n\nSet the project up with git.\n',
  );
  await request.get('/api/skills?refresh=1');

  await openConch(page);
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('/quick-setup for this project');
  await composer.press('Enter');
  await expect(
    page.getByRole('note').filter({ hasText: 'Using the Quick setup skill' }),
  ).toBeVisible();
  const line = page.getByRole('group', { name: 'Skills this chat is held to' });
  await expect(line.getByRole('button', { name: held })).toBeVisible();

  // The list it's held to, a press away.
  await line.getByRole('button', { name: held }).click();
  await expect(page.getByRole('dialog', { name: 'What Quick setup can do' })).toContainText(
    'run commands (only git)',
  );
  await page.keyboard.press('Escape');

  // A later turn is still held to it, and asks with why. A reload changes nothing.
  await expect(page.getByRole('button', { name: /^Stop$/ })).toHaveCount(0, { timeout: 20_000 });
  await page.reload();
  await expect(line.getByRole('button', { name: held })).toBeVisible();
  await composer.fill('now run the tests');
  await composer.press('Enter');
  const card = page.getByRole('group', { name: /asks first/ });
  await expect(card).toContainText(
    'This chat is held to the “Quick setup” skill’s list, and it doesn’t say it needs to run this command. So I’m checking first.',
  );
  await expect(card.getByRole('button', { name: 'Always allow' })).toHaveCount(0);
  // While it's waiting on you, stopping waits too.
  await expect(line.getByRole('button', { name: stop })).toBeDisabled();
  await card.getByRole('button', { name: 'Deny' }).click();
  // The call's story says so (ADR 0103).
  await expect(page.getByRole('button', { name: /You said no/ }).first()).toBeVisible();
  await expect(line.getByRole('button', { name: stop })).toBeEnabled({ timeout: 20_000 });

  // On a phone, the line and its button fit.
  await page.setViewportSize({ width: 390, height: 844 });
  const button = await line.getByRole('button', { name: stop }).boundingBox();
  expect(button && button.x + button.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 800 });

  // From ⌘K: it asks first, and keeping it changes nothing.
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('stop holding');
  await page.getByRole('option', { name: new RegExp(stop) }).click();
  const ask = page.getByRole('alertdialog', { name: `${stop}?` });
  await expect(ask).toContainText('Its instructions are still in this chat.');
  await ask.getByRole('button', { name: 'Keep holding' }).click();
  await expect(line.getByRole('button', { name: held })).toBeVisible();

  // From the line itself: stopped, and the chat says so.
  await line.getByRole('button', { name: stop }).click();
  await page
    .getByRole('alertdialog', { name: `${stop}?` })
    .getByRole('button', { name: 'Stop holding' })
    .click();
  await expect(
    page.getByText('You stopped holding this chat to Quick setup’s list.'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'Skills this chat is held to' })).toHaveCount(0);

  // The same command now asks only the way this chat's mode does: with "Always allow".
  await composer.fill('run the tests again');
  await composer.press('Enter');
  const again = page.getByRole('group', { name: /asks first/ }).last();
  await expect(again.getByRole('button', { name: 'Always allow' })).toBeVisible();
  await expect(again).not.toContainText('held to');
  await again.getByRole('button', { name: 'Deny' }).click();
  // Each no reads as one story line (its steps and raw call stay folded).
  await expect(page.getByRole('button', { name: /Didn’t run the tests/ })).toHaveCount(2);

  // Activity has both.
  await page.goto('/activity');
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  await expect(page.getByText('Held to Quick setup’s list')).toBeVisible();
  await expect(page.getByText('You stopped holding this chat to Quick setup’s list')).toBeVisible();
});

test('your signing key is locked with this computer’s key, and a changed one fails in words', async ({
  page,
}) => {
  const folder = join(home, 'shared', 'notes');
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, 'SKILL.md'),
    '---\nname: notes\ndescription: Keeps notes. Use when asked to keep notes.\n---\n# Notes\n\nKeep notes.\n',
  );
  // Signing works from the terminal while Conch is running, with no key in the clear.
  const signed = await conch('skills', 'sign', folder, '--as', 'Sam');
  expect(signed.stdout).toContain('Signed “notes” as Sam.');
  const kept = await readFile(join(home, 'skills.signing.json'), 'utf8');
  expect(kept).toMatch(/^\{"conch-sealed":1/);
  expect(kept).not.toMatch(/privateKey/);

  // Someone changes it: nothing is signed, and it says what to do.
  const sealed = JSON.parse(kept) as { c: string };
  const c = `${sealed.c.slice(0, 20)}${sealed.c[20] === 'A' ? 'B' : 'A'}${sealed.c.slice(21)}`;
  await writeFile(join(home, 'skills.signing.json'), JSON.stringify({ ...sealed, c }));
  const failed = await conch('skills', 'sign', folder).catch(
    (error: { stdout: string; code: number }) => error,
  );
  expect('code' in failed && failed.code).toBe(1);
  expect(failed.stdout).toContain(
    '✗ Your key for signing skills can’t be opened: the file was changed, or it was locked on another computer. Nothing was signed.',
  );
  expect(failed.stdout).toContain('pnpm conch skills key --new');
  // It was left as it was: no new key quietly made in its place.
  expect(JSON.parse(await readFile(join(home, 'skills.signing.json'), 'utf8')).c).toBe(c);
  expect((await readdir(home)).filter((f) => f.startsWith('skills.signing'))).toEqual([
    'skills.signing.json',
  ]);

  // Repair everything says so, with the one thing to do.
  await openConch(page);
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('repair');
  await page.getByRole('option', { name: /Repair everything/ }).click();
  const settings = page.getByRole('dialog', { name: /Settings/ });
  await expect(settings.getByText('Your key for signing skills').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(settings).toContainText('Restore it from a passphrase-locked backup', {
    timeout: 30_000,
  });
});

test('a skill described in a sentence is written for you, and same-row cards line up', async ({
  page,
}) => {
  await openConch(page);
  await page.goto('/skills/new');
  const box = page.getByRole('textbox', { name: /know how to do/ });
  await box.fill('review my week from my calendar every friday');
  await page.getByRole('button', { name: 'Write the steps for me' }).click();
  // The steps come in, under a note that says who wrote them and offers your words back.
  await expect(page.getByText(/wrote these from your words/)).toBeVisible({ timeout: 15_000 });
  await expect(box).toHaveValue(/## Steps\n1\. Ask for anything missing/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Review week');
  await page.getByRole('button', { name: 'Back to my words' }).click();
  await expect(box).toHaveValue('review my week from my calendar every friday');
  await page.getByRole('button', { name: 'Write the steps for me' }).click();
  await expect(box).toHaveValue(/## Steps/, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Create skill' }).click();
  await expect(page).toHaveURL(/\/skills\/review-week/);

  // Cards that share a row share its height.
  await page.goto('/skills');
  const cards = page.locator('ul li article');
  await expect(cards.first()).toBeVisible();
  const boxes = await cards.evaluateAll((all) =>
    all.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), height: Math.round(r.height) };
    }),
  );
  const rows = new Map<number, number[]>();
  for (const b of boxes) rows.set(b.top, [...(rows.get(b.top) ?? []), b.height]);
  for (const heights of rows.values()) expect(new Set(heights).size).toBe(1);
});
