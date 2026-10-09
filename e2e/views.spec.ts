import { expect, test, type Page } from '@playwright/test';

/**
 * What a tool found, drawn as it is (ADR 0060): the mock's pretend calendar,
 * mail, Drive and Slack each come back as a view under their tool row, the
 * model's text stays behind the row's disclosure, Reply only fills the
 * composer, and a chart's card shows the chart right in the chat.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });
async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press('Enter');
}

test('a calendar comes back as days, with today first', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'What’s on my calendar today and tomorrow?');
  const agenda = page.getByRole('region', { name: 'Calendar, 4 events' });
  await expect(agenda).toBeVisible();
  await expect(agenda.getByRole('region', { name: /^Today,/ })).toContainText('Standup');
  await expect(agenda.getByRole('region', { name: /^Tomorrow,/ })).toContainText('Team offsite');
  await expect(agenda.getByRole('link', { name: /Standup/ })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await expect(page.getByText('Today you have standup at 9:30')).toBeVisible();
  // What the model read is still there, behind the story and its step (ADR 0103).
  await expect(page.getByText('"summary":"Standup"')).toHaveCount(0);
  // Open the step only once the turn has finished: a click while the reply is
  // still settling can land on a row that is about to be drawn again.
  await expect(page.getByRole('button', { name: /Stop/ })).toHaveCount(0);
  const story = page.locator('[data-story]').first();
  await expect(story).toHaveAttribute('data-status', 'done');
  await story
    .getByRole('button', { name: /Looked at your calendar/ })
    .first()
    .click();
  await story
    .getByRole('list', { name: 'Steps' })
    .getByRole('listitem')
    .first()
    .getByRole('button')
    .first()
    .click();
  await expect(story.getByRole('region', { name: 'Output' })).toContainText('Standup');
});

test('emails come back as a list, and Reply only fills the composer', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'Find the budget email');
  const mail = page.getByRole('region', { name: 'Emails, 2 emails' });
  await expect(mail).toBeVisible();
  await expect(mail.getByRole('link', { name: /Ada Lovelace/ })).toHaveAttribute(
    'href',
    'https://mail.example.org/m/1',
  );
  await mail.getByRole('link', { name: /Ada Lovelace/ }).hover();
  await mail.getByRole('button', { name: 'Reply to Ada Lovelace' }).click();
  await expect(composer(page)).toHaveValue(
    'Draft a reply to Ada Lovelace about “Q4 budget, final numbers”',
  );
  // Nothing was sent: the chat still ends with the assistant's answer.
  await expect(page.getByLabel('Conversation', { exact: true }).first()).not.toContainText(
    'Draft a reply',
  );
});

test('files and messages come back as they are', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'Find the launch deck in Drive');
  const files = page.getByRole('region', { name: 'Files, 2 files' });
  await expect(files.getByRole('link', { name: /Q4 launch deck/ })).toBeVisible();
  await expect(files.getByRole('img', { name: 'Slides' })).toBeVisible();

  await ask(page, 'What did #design say about onboarding?');
  const said = page.getByRole('region', { name: 'Messages in #design, 3 messages' });
  await expect(said).toBeVisible();
  await expect(said).toContainText('Save and continue');
});

test('a chart’s card shows the chart in the chat', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'make me a chart of my visitors this week');
  const card = page.getByRole('button', { name: /Visitors this week.*Chart · made for you/ });
  await expect(card).toBeVisible();
  // The small picture is only to look at: it's in the card, hidden from the tab order.
  await expect(card.locator('[inert] svg')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await card.click();
  await expect(page.getByRole('region', { name: 'Visitors this week' })).toBeVisible();
});
