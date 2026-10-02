import { expect, type Page, test } from '@playwright/test';

/**
 * Gmail, Google Calendar and Google Drive as ordinary apps (ADR 0048). Gmail
 * signs in with an app password against the pretend mail service (real IMAP
 * on this machine, with Gmail's extensions); nothing reaches Google.
 */
let MAIL = '';

test.beforeEach(async ({ request }) => {
  const mocks = (await (await request.get('/api/channels/mock')).json()) as Record<string, string>;
  MAIL = mocks.email ?? '';
  await request.post(`${MAIL}/__control/reset`);
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  for (const i of (await (await request.get('/api/integrations')).json()).integrations)
    await request.delete(`/api/integrations/${i.id}`);
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });
async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await page.keyboard.press('Enter');
}

test('connect Gmail with an app password, use it in a chat, turn a tool off, fix a revoked password', async ({
  page,
  request,
}) => {
  await request.post(`${MAIL}/__control/deliver`, {
    data: { from: 'sam@example.org', subject: 'Lunch on Friday', text: 'Pizza at noon?' },
  });
  await page.goto('/apps');
  // No Google box at the top any more: Gmail is a tile like the others.
  await expect(page.getByText('What would you like to do with Google?')).toHaveCount(0);
  await page
    .getByRole('region', { name: /Connect your first app|Add another app/ })
    .getByRole('button', { name: 'Gmail', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Connect Gmail' });
  await dialog.getByLabel('Gmail address').fill('ada@gmail.com');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('link', { name: /Google’s app passwords page/ })).toHaveAttribute(
    'href',
    'https://myaccount.google.com/apppasswords',
  );
  await expect(dialog.getByText(/2-Step Verification/)).toBeVisible();

  // A wrong password says so before anything is kept.
  await dialog.getByRole('textbox', { name: 'App password' }).fill('zzzz zzzz zzzz zzzz');
  await expect(dialog.getByText(/didn’t take that app password/)).toBeVisible();
  await dialog.getByRole('textbox', { name: 'App password' }).fill('abcd efgh ijkl mnop');
  await expect(page.getByRole('heading', { name: 'Gmail is connected' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Gmail is connected' })
    .getByRole('button', { name: 'Done' })
    .click();

  // An ordinary card in Connected; its tile is gone from the gallery.
  const connected = page.getByRole('region', { name: 'Connected' });
  await expect(connected.getByRole('button', { name: 'Gmail', exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Add another app' }).getByRole('button', {
      name: 'Gmail',
      exact: true,
    }),
  ).toHaveCount(0);

  // Every model gets the same Gmail tools: the mock searches and reads.
  await page.goto('/');
  await ask(page, 'search my gmail for lunch');
  await expect(
    page.getByText('I found 1 email about lunch. The newest is “Lunch on Friday”.'),
  ).toBeVisible();

  // Off is off on every engine: the tool isn't offered at all.
  await page.goto('/apps/gmail');
  const draft = page.getByRole('radiogroup', { name: 'Save a draft' });
  await expect(draft.getByRole('radio', { name: 'Allow' })).toHaveCount(0);
  await page
    .getByRole('radiogroup', { name: 'Search your mail' })
    .getByRole('radio', { name: 'Off' })
    .click();
  await expect(
    page
      .getByRole('radiogroup', { name: 'Search your mail' })
      .getByRole('radio', { checked: true }),
  ).toHaveText('Off');
  await page.goto('/');
  await ask(page, 'search my gmail for lunch');
  await expect(page.getByText('Searching Gmail is turned off for me')).toBeVisible();

  // The app password is revoked at Google: one fix, right on its page.
  await request.post(`${MAIL}/__control/revoke`);
  await page.goto('/apps/gmail');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible();
  await request.post(`${MAIL}/__control/reset`);
  await page.getByRole('textbox', { name: 'App password' }).fill('abcd efgh ijkl mnop');
  await expect(page.getByRole('button', { name: 'Sign in again' })).toHaveCount(0);
  await expect(page.getByText('App password · Working')).toBeVisible();

  // Disconnecting forgets it and puts the tile back.
  await page.getByRole('button', { name: 'Disconnect Gmail' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('heading', { name: 'Apps', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gmail', exact: true })).toBeVisible();
  expect((await (await request.get('/api/google')).json()).accounts).toEqual([]);
});

test('Calendar says plainly it needs your own Google Cloud app', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'Google Calendar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Google Calendar' });
  await expect(dialog.getByText('This needs a Google Cloud app of your own')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'App password' })).toHaveCount(0);
  // Said once: no second heading about Google under the dialog's own.
  await expect(
    dialog.getByRole('button', { name: 'I already have a credential file' }),
  ).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Google, connected to Conch' })).toHaveCount(0);
});
