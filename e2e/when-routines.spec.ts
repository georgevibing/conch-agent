import { expect, type Page, test } from '@playwright/test';

/**
 * Routines that start when something happens (ADR 0056): connect Gmail (an
 * app password against the pretend mail service), have Conch draft “tell me
 * when Anna replies” from a chat, turn it on, and let Anna write. The pulse
 * notices without a model, the run starts, and it says what happened.
 */
let MAIL = '';

test.beforeEach(async ({ request }) => {
  const mocks = (await (await request.get('/api/channels/mock')).json()) as Record<string, string>;
  MAIL = mocks.email ?? '';
  await request.post(`${MAIL}/__control/reset`);
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  for (const r of await (await request.get('/api/routines')).json())
    await request.delete(`/api/routines/${r.id}`);
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Conch' });

test('tell me when Anna replies: drafted in a chat, turned on, and it tells you', async ({
  page,
  request,
}) => {
  // Gmail, connected from Apps: the routine that fits is offered once, and makes nothing by itself.
  await page.goto('/apps');
  await page
    .getByRole('region', { name: /Connect your first app|Add another app/ })
    .getByRole('button', { name: 'Gmail', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Connect Gmail' });
  // What it should help with, then how (ADR 0099): Gmail at Read and an app
  // password are what it starts on, so connecting is two presses and the address.
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByLabel('Gmail address').fill('ada@gmail.com');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('textbox', { name: 'App password' }).fill('abcd efgh ijkl mnop');
  const connected = page.getByRole('dialog', { name: 'Gmail is connected' });
  await expect(connected.getByText('Want one of these?')).toBeVisible();
  await expect(connected.getByRole('button', { name: 'Choose who' })).toBeVisible();
  expect(await (await request.get('/api/routines')).json()).toEqual([]);
  await connected.getByRole('button', { name: 'Done' }).click();

  // In a chat: a draft that says, in Conch's words, what starts it and that it's free until then.
  await page.goto('/');
  await composer(page).fill('Tell me when Anna Smith replies');
  await composer(page).press('Enter');
  const card = page.getByRole('article', { name: 'When Anna Smith replies' });
  await expect(card.getByText(/When Anna Smith emails you/)).toBeVisible();
  await expect(card.getByText(/Free until something happens/)).toBeVisible();
  const [draft] = await (await request.get('/api/routines')).json();
  expect(draft).toMatchObject({ status: 'draft', trust: 'ask', createdBy: 'agent' });
  await card.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText(/Routine on/i)).toBeVisible();

  // Someone else's mail doesn't start it; Anna's does, once.
  await request.post(`${MAIL}/__control/deliver`, {
    data: { from: 'sam@example.org', fromName: 'Sam', subject: 'Lunch', text: 'Pizza?' },
  });
  await request.post(`${MAIL}/__control/deliver`, {
    data: {
      from: 'anna@example.org',
      fromName: 'Anna Smith',
      subject: 'The invoice',
      text: 'Here it is, due Friday.',
    },
  });
  // Repair everything looks at every source now, instead of in a couple of minutes.
  await request.post('/api/doctor/repair');
  await page.goto(`/routines/${draft.id}`);
  await expect(page.getByText(/After Anna Smith’s email “The invoice”/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Told you about Anna Smith’s email/).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Watching' })).toContainText('1 run started');
  const runs = (await (await request.get(`/api/routines/${draft.id}`)).json()).runs;
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ trigger: 'event', status: 'succeeded' });
});
