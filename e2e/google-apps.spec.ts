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
  // What it should help with: Gmail, read & write, so it can draft and send when asked.
  await dialog
    .getByRole('radiogroup', { name: 'Gmail' })
    .getByRole('radio', { name: 'Read & write' })
    .click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  // How: an app password is simplest for Gmail on its own, and says what it can't do.
  const how = dialog.getByRole('radiogroup', { name: 'How to connect' });
  await expect(how.getByRole('radio', { name: /App password.*Simplest/ })).toBeChecked();
  await expect(how.getByText(/Gmail only/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
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

  // Read & write with an app password sends (over SMTP), showing the exact email first.
  const sentBefore = (await (await request.post(`${MAIL}/__control/sent`)).json()).length as number;
  await page.goto('/');
  await ask(page, 'email sam@example.org saying Noon works for lunch');
  const review = page.getByRole('region', { name: 'Email to review' });
  await expect(review.getByText('ada@gmail.com', { exact: true })).toBeVisible();
  await expect(review.getByText('sam@example.org', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Sent it to sam@example.org.')).toBeVisible();
  const sent = (await (await request.post(`${MAIL}/__control/sent`)).json()) as {
    from: string;
    to: string[];
    text: string;
  }[];
  expect(sent).toHaveLength(sentBefore + 1);
  expect(sent.at(-1)).toMatchObject({ from: 'ada@gmail.com', to: ['sam@example.org'] });

  // Each tool says what its choice means; sending is Ask by default and can be Allow.
  await page.goto('/apps/gmail');
  await expect(page.getByText(/nothing is ever sent/)).toHaveCount(0);
  const sending = page.getByRole('radiogroup', { name: 'Send an email' });
  await expect(sending.getByRole('radio', { checked: true })).toHaveText('Ask');
  await expect(sending).toHaveAccessibleDescription('Asks you each time.');
  await sending.getByRole('radio', { name: 'Allow' }).click();
  await expect(page.getByText('Conch will send an email without showing you first.')).toBeVisible();
  await expect(sending).toHaveAccessibleDescription(
    'Doesn’t ask. Still asks if the chat read something from outside.',
  );
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(sending.getByRole('radio', { checked: true })).toHaveText('Ask');

  // Off is off on every engine: the tool isn't offered at all.
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

  // Its account is on the page, with what it may do in each Google app.
  await page.goto('/apps/gmail');
  const card = page.getByRole('article', { name: 'ada@gmail.com' });
  await expect(
    card.getByText('App password · Gmail: read and send. Calendar and Drive need Google sign-in.'),
  ).toBeVisible();
  await expect(card.getByRole('button', { name: 'Switch to Google sign-in' })).toBeVisible();
  await expect(card.getByText('Working', { exact: true })).toBeVisible();
  const mailLevel = card.getByRole('radiogroup', { name: 'Gmail' });
  await expect(mailLevel.getByRole('radio', { checked: true })).toHaveText('Read & write');
  // An app password reaches Gmail only, and says the way to the others.
  await expect(card.getByRole('button', { name: 'Use Google sign-in' })).toHaveCount(2);
  // Taking write access away is one tap, and sending stops being offered.
  await mailLevel.getByRole('radio', { name: 'Read', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Send an email' })).toHaveCount(0);
  await mailLevel.getByRole('radio', { name: 'Read & write' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Send an email' })).toBeVisible();

  // The app password is revoked at Google: one fix, right on the account.
  await request.post(`${MAIL}/__control/revoke`);
  await card.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible();
  await request.post(`${MAIL}/__control/reset`);
  await card.getByRole('textbox', { name: 'App password' }).fill('abcd efgh ijkl mnop');
  await expect(page.getByRole('button', { name: 'Sign in again' })).toHaveCount(0);
  await expect(card.getByText('Working', { exact: true })).toBeVisible();

  // Disconnecting forgets it and puts the tile back.
  await page.getByRole('button', { name: 'Disconnect Gmail' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('heading', { name: 'Apps', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gmail', exact: true })).toBeVisible();
  expect((await (await request.get('/api/google')).json()).accounts).toEqual([]);
});

test('Calendar says plainly it needs Google sign-in, and offers no app password', async ({
  page,
}) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'Google Calendar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Google Calendar' });
  await expect(
    dialog.getByRole('radiogroup', { name: 'Google Calendar' }).getByRole('radio', {
      checked: true,
    }),
  ).toHaveText('Read');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('radiogroup', { name: 'How to connect' })).toHaveCount(0);
  await expect(dialog.getByText(/only open to Google’s own sign-in/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(
    dialog.getByRole('button', { name: 'I already have a credential file' }),
  ).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'App password' })).toHaveCount(0);
});
