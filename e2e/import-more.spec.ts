import { expect, test, type Page } from '@playwright/test';

import { MockSlack } from '../apps/server/src/channels/mock/slack';
import { openConch } from './app';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Come home, the rest of it (ADR 0042), from a pretend OpenClaw and Hermes:
 * Hermes's model matched to what's connected and put back by Undo; a Slack
 * bot Hermes had one key for, finished on the Slack setup with a link to
 * its app's own page; and OpenClaw's other agents, each under its name,
 * its personality coming over as a skill that starts off.
 */
test.describe.configure({ mode: 'serial' });

async function comeHome(page: Page, from: 'OpenClaw' | 'Hermes') {
  await openConch(page);
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('hermes');
  await page.getByRole('option', { name: /Bring your things from OpenClaw or Hermes/ }).click();
  // ⌘K opens the first one found (OpenClaw); the other is beside it in Settings.
  const first = page.getByRole('dialog', { name: 'Bring your things from OpenClaw' });
  await expect(first).toBeVisible();
  if (from === 'OpenClaw') return first;
  await first.getByRole('button', { name: 'Cancel' }).click();
  await page
    .getByRole('dialog', { name: /Settings/ })
    .getByRole('region', { name: `Bring your things from ${from}` })
    .getByRole('button', { name: /Take a look|Look again/ })
    .click();
  return page.getByRole('dialog', { name: `Bring your things from ${from}` });
}

test('Hermes’s model and its half Slack bot come over, and Undo takes both back', async ({
  page,
  request,
}) => {
  await request.patch('/api/settings', { data: { onboarded: true } });
  const dialog = await comeHome(page, 'Hermes');
  const model = dialog.getByRole('region', { name: 'Model' });
  await expect(
    model.getByRole('checkbox', { name: /Use Claude Sonnet, as in Hermes/ }),
  ).toBeChecked();
  await expect(model).toContainText('the nearest here to Claude Sonnet 4.5');
  const slack = dialog.getByRole('checkbox', { name: /Your Slack bot/ });
  await expect(slack).not.toBeChecked();
  await expect(dialog).toContainText('Slack needs one more key');
  // No key reaches the page, not even one in config.yaml.
  await expect(dialog).not.toContainText('not-real');
  await expect(dialog).not.toContainText('xoxb-');
  await slack.click();

  await dialog.getByRole('button', { name: /^Bring \d+ things over$/ }).click();
  const summary = page
    .getByRole('dialog', { name: 'Welcome home' })
    .getByRole('region', { name: 'Your things from Hermes are here' });
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText('1 model choice');
  await expect(summary).toContainText('New chats start with Sonnet 5.5');
  const state = await (await request.get('/api/state')).json();
  expect(state.preferences.model).toBe('sonnet');

  await summary.getByRole('link', { name: 'Finish connecting Slack' }).click();
  await expect(page).toHaveURL(/\/channels\/new\/slack\?from=hermes/);
  await expect(page.getByText('Made, in Hermes')).toBeVisible();
  await expect(page.getByText(/From Hermes: /)).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Open your app’s Socket Mode page/ }),
  ).toHaveAttribute('href', 'https://api.slack.com/apps/A0MOCKAPP/socket-mode');
  await page.getByLabel('App-level token').fill(MockSlack.APP_TOKEN);
  await expect(page.getByRole('listitem').filter({ hasText: 'Say hello' })).toHaveAttribute(
    'aria-current',
    'step',
    { timeout: 15_000 },
  );
  const channels = await (await request.get('/api/channels')).json();
  expect(channels.channels.map((c: { kind: string }) => c.kind)).toEqual(['slack']);

  // Undo, from Settings: the bot finished on the Slack page goes too, and the model is as it was.
  const undone = await request.post('/api/import/undo', { data: {} });
  expect(undone.ok()).toBe(true);
  expect((await (await request.get('/api/channels')).json()).channels).toEqual([]);
  expect((await (await request.get('/api/state')).json()).preferences.model).toBeUndefined();
});

test('OpenClaw’s other agents come over each under its name, as a skill that starts off', async ({
  page,
  request,
}) => {
  const dialog = await comeHome(page, 'OpenClaw');
  const atlas = dialog.getByRole('region', { name: 'Atlas' });
  await expect(atlas).toContainText('Another of your agents');
  await expect(atlas.getByRole('checkbox', { name: /Talk as Atlas/ })).toBeChecked();
  // A long section folds; its routine is behind Show all.
  await atlas.getByRole('button', { name: /^Show all \d+$/ }).click();
  await expect(atlas.getByRole('checkbox', { name: /Friday numbers/ })).toBeChecked();
  // Its memories aren't mixed with the main agent's, and one they share comes once.
  await expect(dialog.getByRole('region', { name: 'Memories' })).not.toContainText('Charles');
  await expect(atlas).not.toContainText('The build runs on Fridays');
  await expect(dialog.getByRole('region', { name: 'Family' })).toBeVisible();
  // One tick for all of an agent.
  await dialog.getByRole('checkbox', { name: 'All of Family' }).click();
  await expect(dialog.getByRole('region', { name: 'Family' })).toContainText('0 of 2');

  await dialog.getByRole('button', { name: /^Bring \d+ things over$/ }).click();
  const summary = page
    .getByRole('dialog', { name: 'Welcome home' })
    .getByRole('region', { name: 'Your things from OpenClaw are here' });
  await expect(summary).toBeVisible({ timeout: 15_000 });

  const skills = (await (await request.get('/api/skills')).json()) as {
    skills: { name: string; mode: string }[];
  };
  expect(skills.skills.find((s) => s.name === 'atlas')).toMatchObject({ mode: 'off' });
  expect(skills.skills.some((s) => s.name === 'family')).toBe(false);
  const routines = JSON.stringify(await (await request.get('/api/routines')).json());
  expect(routines).toContain('Friday numbers');
  const memories = JSON.stringify(await (await request.get('/api/memories')).json());
  expect(memories).toContain('Charles reviews every pull request.');
  expect(memories).not.toContain('Grace’s birthday');
});
