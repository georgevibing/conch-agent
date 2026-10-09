import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { commit, git, makeKey, tag, type Key } from '../apps/server/src/release/testing';
import { SERVER_BUILD, SERVER_LABEL } from '../apps/server/src/version';
import { brokenConch, notes, pretendConch } from './releases-world';

/**
 * Releases (ADR 0051), end to end, against a pretend upstream: a bare git
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
// Rollback deliberately builds on the installed version from the first journey.
// If that journey fails, report its cause once and don't run on a broken fixture.
test.describe.configure({ mode: 'serial' });
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
      build?: typeof SERVER_BUILD;
      source: string;
      latest?: { version: string };
      refused?: string;
      previous?: string;
      failed?: string[];
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
  test.setTimeout(270_000);
  await look(request);
  expect((await status(request)).conch).toMatchObject({
    version: '0.1.0',
    build: SERVER_BUILD,
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

  // The banner opens the dedicated update dialog, with notes ready to read.
  const preview = page.getByRole('dialog', { name: 'Conch 0.2 is ready' });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('list', { name: 'New' })).toContainText(
    'Edit pages by hand, with a live preview',
  );
  await preview.getByRole('button', { name: 'Later', exact: true }).click();

  // Settings → Health still owns channel selection and the complete update history.
  await page.getByRole('button', { name: /^Settings(?:,|$)/ }).click({ timeout: 10_000 });
  const settings = page.getByRole('dialog', { name: /Settings/ });
  await settings.getByRole('tab', { name: 'Health' }).click();
  const card = settings.getByRole('region', { name: 'Conch 0.2 is ready' });
  await expect(card).toBeVisible();
  // The fixture swaps pretend checkouts but runs this workspace's gateway. Its
  // installed-build label must stay truthful, independently of the release offered.
  await expect(card).toContainText(`You have ${SERVER_LABEL}`);
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

  // A chat is working when the update is asked for: the dialog asks first, naming it.
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('Think about the weekend, take your time');
  await composer.press('Enter');
  await expect(page.getByText(/Let me think this through properly\./)).toBeVisible();
  const chat = page.url();

  // Update: made ready beside the running version, swapped in, a restart, and back.
  const head = git(conch, 'rev-parse', 'HEAD');
  const before = await bootId(request);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.getByRole('combobox').fill('update conch');
  await page.getByRole('option', { name: /Update Conch to 0\.2/ }).click();
  const ready = page.getByRole('dialog', { name: 'Conch 0.2 is ready' });
  await ready.getByRole('button', { name: 'Update now' }).click();
  // A press always answers: the question in the same dialog, never a press that does nothing.
  await expect(
    ready.getByText(
      /is working\. Update anyway\? It will pause, and carry on after Conch restarts\./,
    ),
  ).toBeVisible();
  await ready.getByRole('button', { name: 'Update anyway' }).click();
  await expect(page.getByRole('heading', { name: 'Updating Conch', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(() => bootId(request), { timeout: 90_000 })
    .not.toMatch(new RegExp(`^(${before})?$`));
  await expect
    .poll(async () => (await status(request)).conch.version, { timeout: 30_000 })
    .toBe('0.2.0');

  // It says which version came before once the new one has proved itself, a moment later.
  await expect
    .poll(async () => (await status(request)).conch, { timeout: 30_000 })
    .toMatchObject({ version: '0.2.0', build: SERVER_BUILD, previous: '0.1.0' });
  // The running copy was never touched; the new one is its own folder, installed there.
  expect(git(conch, 'rev-parse', 'HEAD')).toBe(head);
  const home = readFileSync(join(world, 'pnpm.log'), 'utf8');
  expect(home).toMatch(/install .*versions[\\/]0\.2\.0/);
  expect(home).toMatch(/build .*versions[\\/]0\.2\.0/);
  expect(git(conch, 'status', '--porcelain', '--untracked-files=no')).toBe('');

  // The page came back by itself, with the new release's notes and the real build identity.
  const updated = page.getByRole('dialog', { name: 'You’re on the new Conch' });
  await expect(updated).toBeVisible({ timeout: 60_000 });
  await expect(updated).toContainText(`Updated to ${SERVER_LABEL}`);
  await updated.getByRole('button', { name: 'Done', exact: true }).click();

  // The chat that was working paused at a safe point, and carried on by itself after.
  expect(page.url()).toBe(chat);
  // Conch carries the chat on once it's back and has looked at the computer: on a
  // slow runner that takes a few looks. Wait on its own record, and say what it was if not.
  const chatId = chat.split('/c/')[1] ?? '';
  const pickedUp = async () => {
    const detail = (await (await request.get(`/api/conversations/${chatId}`)).json()) as {
      conversation?: { status?: string };
      events?: { type: string; restarted?: unknown; outcome?: string }[];
    };
    return { detail, marked: (detail.events ?? []).some((e) => e.restarted) };
  };
  await expect
    .poll(async () => (await pickedUp()).marked, { timeout: 90_000, intervals: [1_000] })
    .toBe(true)
    .catch(async (error: unknown) => {
      const { detail } = await pickedUp();
      const health = await (await request.get('/api/health')).json();
      console.log(
        'releases: not picked up',
        JSON.stringify({
          status: detail.conversation?.status,
          tail: (detail.events ?? [])
            .filter((e) => !e.type.endsWith('delta'))
            .slice(-8)
            .map((e) => [e.type, e.outcome, e.restarted]),
          health,
        }),
      );
      throw error;
    });
  await expect(page.getByText('Conch updated and picked up where it left off')).toBeVisible({
    timeout: 30_000,
  });
  // It's still thinking: stop it, so the next journey's update finds nothing working.
  const stop = page.getByRole('button', { name: /^Stop/ });
  if (await stop.isVisible()) await stop.click();
  await page.getByRole('button', { name: /^Settings(?:,|$)/ }).click({ timeout: 10_000 });
  await settings.getByRole('tab', { name: 'Health' }).click();
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
  await expect(page.getByRole('heading', { name: 'Updating Conch', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(() => bootId(request), { timeout: 150_000 })
    .not.toMatch(new RegExp(`^(${before})?$`));
  await expect
    .poll(async () => (await status(request)).conch.version, { timeout: 30_000 })
    .toBe('0.2.0');

  // The gateway can be ready before RestartWatch reloads the browser. Let it
  // finish and open the outcome dialog itself; navigating here races that reload and
  // would also hide a broken automatic recovery from this journey.
  const settings = page.getByRole('dialog', { name: 'The update didn’t finish' });
  await expect(settings).toBeVisible({ timeout: 60_000 });
  await expect(
    settings.getByText(
      'Conch 0.3.0 didn’t start properly, so Conch went back to 0.2.0 by itself.',
      { exact: false },
    ),
  ).toBeVisible({ timeout: 30_000 });
  const after = (await status(request)).conch;
  expect(after).toMatchObject({ version: '0.2.0', build: SERVER_BUILD });
  expect(after.failed).toContain('0.3.0');
  // A Dev gateway can still offer its first real release; the failed release
  // must never be offered again, whatever build this workspace is running. The
  // gateway that just came back looks for releases again by itself, so what it
  // offers settles a moment after the dialog — wait for that, don't race it.
  await expect
    .poll(async () => (await status(request)).conch.latest?.version ?? null, { timeout: 30_000 })
    .toBe(SERVER_BUILD.kind === 'dev' ? '0.2.0' : null);
  await expect(page.getByRole('region', { name: 'Conch 0.3 is ready' })).toHaveCount(0);
});
