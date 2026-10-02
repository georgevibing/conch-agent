import { expect, test } from '@playwright/test';

// No Google account or network. The real UI uses scripted Google service replies;
// server tests separately exercise PKCE, code exchange, cookie binding and storage.
for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'touch', width: 390, height: 844 },
]) {
  test('Google guided import and remote return on ' + viewport.name, async ({ page, request }) => {
    await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.open = () => null;
    });
    let configured = false,
      ready = false;
    const credentials = JSON.stringify({
      installed: {
        client_id: 'personal.apps.googleusercontent.com',
        client_secret: 'fake-test-secret',
        project_id: 'personal-conch',
      },
    });
    const account = {
      id: 'personal',
      name: 'Ada',
      email: 'ada@example.com',
      capabilities: ['calendar-read'],
      state: 'ready',
    };
    const status = () => ({
      configured,
      clientType: 'desktop',
      projectId: 'personal-conch',
      accounts: ready ? [account] : [],
    });
    await page.route('**/api/google**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/google/import') {
        expect(route.request().postDataJSON()).toEqual({ credentials });
        configured = true;
        return route.fulfill({ json: status() });
      }
      if (path === '/api/google/connect')
        return route.fulfill({
          json: {
            url: 'https://accounts.google.com/o/oauth2/v2/auth?state=flow',
            flowId: 'flow',
            mode: 'manual',
          },
        });
      if (path === '/api/google/flows/flow/complete') {
        expect(route.request().postDataJSON()).toEqual({
          redirectUrl: 'http://127.0.0.1:1/?state=flow&code=private-test-code',
        });
        ready = true;
        return route.fulfill({ json: { state: 'ready', accountId: account.id } });
      }
      if (path === '/api/google/flows/flow')
        return route.fulfill({
          json: ready
            ? { state: 'ready', accountId: account.id }
            : { state: 'pending', mode: 'manual' },
        });
      return route.fulfill({ json: status() });
    });
    await page.goto('/integrations');
    // Calendar's own tile opens its connect dialog, which only asks for the calendar.
    const openCalendar = () =>
      page.getByRole('button', { name: 'Google Calendar', exact: true }).click();
    await openCalendar();
    const google = page.getByRole('dialog', { name: 'Connect Google Calendar' });
    await google.getByLabel('Project ID (optional)').fill('personal-conch');
    await google.getByRole('button', { name: 'My project is selected' }).click();
    await expect(google.getByRole('link', { name: 'Open Google Calendar API' })).toHaveAttribute(
      'href',
      /project=personal-conch/,
    );
    await expect(google.getByRole('link', { name: 'Open Gmail API' })).toHaveCount(0);
    await google.getByRole('button', { name: 'I enabled these APIs' }).click();
    await expect(google.getByText(/seven days/).first()).toBeVisible();
    await google.getByRole('button', { name: 'My account is allowed' }).click();
    const file = google.getByLabel('Google credential JSON');
    await file.setInputFiles({
      name: 'service-account.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"type":"service_account","private_key":"fake"}'),
    });
    await expect(google.getByText(/This is a service-account key/)).toBeVisible();
    await expect(google.getByRole('button', { name: 'Save and connect Google' })).toBeDisabled();
    await file.setInputFiles({
      name: 'conch-client.json',
      mimeType: 'application/json',
      buffer: Buffer.from(credentials),
    });
    await expect(google.getByText(/Desktop app · personal-conch/)).toBeVisible();
    await google.getByRole('button', { name: 'Save and connect Google' }).click();
    await expect(google.getByRole('link', { name: 'Open Google sign-in' })).toBeVisible();
    // Reload recovery retains only the flow ID, not the credential file or return URL.
    await page.reload();
    await openCalendar();
    await google
      .getByLabel('Return address from Google')
      .fill('http://127.0.0.1:1/?state=flow&code=private-test-code');
    await google.getByRole('button', { name: 'Finish connecting' }).click();
    await expect(page.getByRole('heading', { name: 'Google Calendar is connected' })).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toMatch(
      /fake-test-secret|private-test-code/,
    );
  });
}
