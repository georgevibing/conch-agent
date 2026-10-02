import { expect, test } from '@playwright/test';

/**
 * With the mock engine, integrations talk to a pretend vendor on this
 * machine: real OAuth (discovery, registration, PKCE), real MCP, a consent
 * page with Allow / Deny. Everything a person sees is the real thing.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  for (const i of (await (await request.get('/api/integrations')).json()).integrations) {
    await request.delete(`/api/integrations/${i.id}`);
  }
});

test('connect Notion in a popup, use it in a chat, fix it when it breaks', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Gmail, Notion, GitHub and more' }).click();
  await expect(page.getByRole('heading', { name: 'Apps', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Notion', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Notion' });
  const popupOpened = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Continue with Notion' }).click();
  const popup = await popupOpened;
  await expect(page.getByRole('heading', { name: 'Signing in to Notion…' })).toBeVisible();

  // The vendor's own consent page.
  await popup.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByRole('heading', { name: 'Notion is connected' })).toBeVisible();
  await popup.waitForEvent('close', { timeout: 5000 }).catch(() => undefined);

  // "Try asking" opens a new chat with the words ready to send.
  await page
    .getByRole('button', { name: 'Find my notes from last week’s planning meeting' })
    .click();
  await expect(page.getByRole('textbox').first()).toHaveValue(
    'Find my notes from last week’s planning meeting',
  );
  await page.getByRole('textbox').first().fill('search notion for the roadmap');
  await page.keyboard.press('Enter');
  // Reading needs no permission; the tool row shows the app.
  await expect(page.getByText('I found 3 results').first()).toBeVisible();
  await expect(page.getByText('Notion', { exact: true }).first()).toBeVisible();

  // Changing something asks first, in plain words.
  await page.getByRole('textbox').first().fill('create a page in notion');
  await page.keyboard.press('Enter');
  await expect(page.getByText('would like to create a page in Notion')).toBeVisible();
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.getByText('I created Notes from Conch')).toBeVisible();

  // The sign-in stops working: the chat says so, with the fix right there.
  const list = await (await request.get('/api/integrations')).json();
  const notion = list.integrations[0];
  await request.post(`${new URL(notion.transport.url).origin}/__control/revoke`);
  await request.post(`/api/integrations/${notion.id}/check`, { data: {} });
  await page.getByRole('textbox').first().fill('search notion again');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('note').filter({ hasText: 'Notion needs you to sign in again' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Apps.*1 needs you/ })).toBeVisible();

  // One click from the chat signs in again; the card settles.
  const again = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await (await again).getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText('Notion is working again')).toBeVisible();
});

test('a token integration explains a wrong token, and tools can be turned off', async ({
  page,
}) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'GitHub', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect GitHub' });
  const token = dialog.getByLabel(/Access token/);
  await token.fill('github_pat_wrong_0123456789abcdefghij');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByText(/wasn’t accepted/)).toBeVisible();
  await token.fill('github_pat_mock_0123456789abcdefghij');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'GitHub is connected' })).toBeVisible();

  await page.getByRole('dialog').getByRole('button', { name: 'Choose what it can do' }).click();
  await expect(page.getByRole('heading', { name: 'GitHub', level: 1 })).toBeVisible();
  // Plain switches first: what it does, in two words each.
  const does = page.getByRole('list', { name: 'What GitHub does' });
  await expect(does.getByRole('switch', { name: 'Look things up' })).toBeChecked();
  await expect(does.getByRole('switch', { name: /Make changes/ })).toBeChecked();
  const remove = page.getByRole('radiogroup', { name: 'Delete a page' });
  await remove.getByRole('radio', { name: 'Off' }).click();
  await expect(remove.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(
    page.getByRole('radiogroup', { name: 'Delete a page' }).getByRole('radio', { name: 'Off' }),
  ).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('button', { name: 'Disconnect GitHub' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(page.getByRole('region', { name: 'Connected' })).toHaveCount(0);
});

test('saying no on the sign-in page leaves nothing half-connected', async ({ page }) => {
  // The page's old address still leads there.
  await page.goto('/integrations');
  await expect(page).toHaveURL(/\/apps$/);
  await page.getByRole('button', { name: 'Linear', exact: true }).click();
  const popupOpened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Linear' }).click();
  const popup = await popupOpened;
  await popup.getByRole('button', { name: 'Deny' }).click();
  await expect(popup.getByText('You didn’t allow access')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByText('You didn’t allow access, so it isn’t connected.'),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Connected' })).toHaveCount(0);
});
