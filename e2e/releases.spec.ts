import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { commit, git, makeKey, tag, type Key } from '../apps/server/src/release/testing';
import { brokenConch, notes, pretendConch } from './releases-world';

/**
 * Releases (ADR 0048), end to end, against a pretend upstream: a bare git
 * origin whose release tags are really signed (`git tag -s` with a key from
 * `ssh-keygen`), and a pretend Conch installed from it at 0.1.0, running
 * under the supervisor like `pnpm start`.
 *
 * The new release is noticed once, quietly; its notes are what the tag says;
 * a forged release is refused in plain words; the channel decides what's
 * offered; and updating makes the release ready in its own folder, swaps it
 * in and restarts — the page comes back by itself on the new version.
 */
const world = process.env.CONCH_E2E_RELEASES_WORLD ?? '';
const where = () =>
  JSON.parse(readFileSync(join(world, 'world.json'), 'utf8')) as {
    origin: string;
    maker: string;
    conch: string;
    key: Key;
  };

async function status(request: APIRequestContext) {
  return (await (await request.get('/api/updates')).json()) as {
    conch: {
      version: string;
      source: string;
      latest?: { version: string };
      refused?: string;
      previous?: string;
      running?: unknown;
    };
  };
}

/** The running gateway's boot id; empty while it's restarting. */
async function bootId(request: APIRequestContext): Promise<string> {
  try {
    return ((await (await request.get('/api/health')).json()) as { bootId?: string }).bootId ?? '';
  } catch {
    return '';
  }
}

/** Look now (the mock engine never looks by itself), and wait for the answer. */
async function look(request: APIRequestContext) {
  await request.post('/api/updates/check', { data: {} });
  await expect
    .poll(async () => (await (await request.get('/api/updates')).json()).checking)
    .toBe(false);
}

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

test('a new release: noticed once, its notes, a forged one refused, the channel, then the update and the restart', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await look(request);
  expect((await status(request)).conch).toMatchObject({
    version: '0.1.0',
    source: 'releases',
    latest: { version: '0.2.0' },
  });

  // A calm line at the top of the app, once.
  await page.goto('/');
  const banner = page.getByRole('region', { name: 'Conch 0.2 is ready' });
  await expect(banner).toBeVisible();
  // On a phone it's the same line, every button still in reach.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['What’s new', 'Update', 'Not now'])
    await expect(banner.getByRole('button', { name, exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 720 });
  await banner.getByRole('button', { name: 'What’s new' }).click();

  // Settings → Health → Updates: the release, in its own words.
  const settings = page.getByRole('dialog', { name: /Settings/ });
  const card = settings.getByRole('region', { name: 'Conch 0.2 is ready' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('You have 0.1.0');
  await card.getByRole('button', { name: 'What’s new' }).click();
  await expect(settings.getByRole('button', { name: /^Conch 0\.2/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const fresh = settings.getByRole('list', { name: 'New' }).first();
  await expect(fresh).toContainText('Edit pages by hand, with a live preview');
  await expect(fresh).toContainText('Connect Teams, Matrix and WeChat');
  const channel = settings.getByRole('radiogroup', { name: 'Which releases Conch gets' });
  await expect(channel.getByRole('radio', { name: /Stable/ })).toBeChecked();

  // A forged release appears upstream: signed, but not by Conch's makers.
  const { maker, conch } = where();
  const stranger = makeKey(world, 'stranger-key');
  const signers = readFileSync(join(maker, 'release/allowed_signers'), 'utf8');
  commit(maker, pretendConch('0.2.1', signers), 'release: v0.2.1');
  tag(maker, 'v0.2.1', notes('0.2.1', ['Something nobody made']), stranger);
  git(maker, 'push', '--quiet', 'origin', 'main', 'v0.2.1');
  await settings.getByRole('button', { name: 'Check now' }).click();
  await expect(
    settings.getByText(
      /Conch 0\.2\.1 isn’t signed by a key this Conch trusts, so Conch won’t install it\./,
    ),
  ).toBeVisible();
  await expect(settings.getByText('Something nobody made')).toHaveCount(0);
  expect((await status(request)).conch.latest?.version).toBe('0.2.0');

  // Beta brings the beta, newest first; back to stable, and it's gone again.
  // The choice is saved first (beta asks that it's you), then shown.
  await channel.getByRole('radio', { name: /Beta/ }).click();
  await expect(channel.getByRole('radio', { name: /Beta/ })).toBeChecked();
  await expect(settings.getByRole('button', { name: /^Conch 0\.3\.0-beta\.1/ })).toBeVisible();
  await expect(settings.getByText('Talk to your assistant, hands free')).toBeVisible();
  await channel.getByRole('radio', { name: /Stable/ }).click();
  await expect(channel.getByRole('radio', { name: /Stable/ })).toBeChecked();
  await expect(settings.getByText('Talk to your assistant, hands free')).toHaveCount(0);

  // Put away, it stays away for this version.
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await page
    .getByRole('region', { name: 'Conch 0.2 is ready' })
    .getByRole('button', { name: 'Not now' })
    .click();
  await expect(page.getByRole('region', { name: 'Conch 0.2 is ready' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Conch 0.2 is ready' })).toHaveCount(0);

  // Update: made ready beside the running version, swapped in, a restart, and back.
  const head = git(conch, 'rev-parse', 'HEAD');
  const before = await bootId(request);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.getByRole('combobox').fill('update conch');
  await page.getByRole('option', { name: /Update Conch to 0\.2/ }).click();
  await expect(page.getByText('Updating Conch…').first()).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => bootId(request), { timeout: 90_000 })
    .not.toMatch(new RegExp(`^(${before})?$`));
  await expect
    .poll(async () => (await status(request)).conch.version, { timeout: 30_000 })
    .toBe('0.2.0');

  const after = (await status(request)).conch;
  expect(after).toMatchObject({ version: '0.2.0', previous: '0.1.0' });
  // The running copy was never touched; the new one is its own folder, installed there.
  expect(git(conch, 'rev-parse', 'HEAD')).toBe(head);
  const home = readFileSync(join(world, 'pnpm.log'), 'utf8');
  expect(home).toMatch(/install .*versions[\\/]0\.2\.0/);
  expect(home).toMatch(/build .*versions[\\/]0\.2\.0/);
  expect(git(conch, 'status', '--porcelain', '--untracked-files=no')).toBe('');

  // The page came back by itself, on the new version, with what it brought.
  const updated = page
    .getByRole('dialog', { name: /Settings/ })
    .getByRole('region', { name: 'Conch is up to date' });
  await expect(updated).toBeVisible({ timeout: 60_000 });
  await expect(updated).toContainText(/0\.2\.0 · Updated/);
  await expect(page.getByRole('button', { name: 'Go back to 0.1.0' })).toBeVisible();
});

test('a release that doesn’t start: Conch goes back by itself, says so once, and doesn’t offer it again', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  // The first journey left Conch on 0.2.0.
  expect((await status(request)).conch.version).toBe('0.2.0');
  const { maker, key } = where();
  const signers = readFileSync(join(maker, 'release/allowed_signers'), 'utf8');
  commit(maker, brokenConch('0.3.0', signers), 'release: v0.3.0');
  tag(maker, 'v0.3.0', notes('0.3.0', ['Something that breaks']), key);
  git(maker, 'push', '--quiet', 'origin', 'main', 'v0.3.0');
  await look(request);
  expect((await status(request)).conch.latest?.version).toBe('0.3.0');

  await page.goto('/');
  const before = await bootId(request);
  await page
    .getByRole('region', { name: 'Conch 0.3 is ready' })
    .getByRole('button', { name: 'Update' })
    .click();
  await expect
    .poll(() => bootId(request), { timeout: 150_000 })
    .not.toMatch(new RegExp(`^(${before})?$`));
  await expect
    .poll(async () => (await status(request)).conch.version, { timeout: 30_000 })
    .toBe('0.2.0');

  await page.goto('/?open=updates');
  const settings = page.getByRole('dialog', { name: /Settings/ });
  await expect(
    settings.getByText(
      'Conch 0.3.0 didn’t start properly, so Conch went back to 0.2.0 by itself.',
      { exact: false },
    ),
  ).toBeVisible({ timeout: 30_000 });
  const after = (await status(request)).conch as { latest?: unknown; failed?: string[] };
  expect(after.latest).toBeUndefined();
  expect(after.failed).toContain('0.3.0');
  await expect(page.getByRole('region', { name: 'Conch 0.3 is ready' })).toHaveCount(0);
});
