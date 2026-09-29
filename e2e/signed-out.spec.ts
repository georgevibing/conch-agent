import { expect, test } from '@playwright/test';

test('signs in to Claude from the browser', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();

  await page.getByRole('button', { name: 'Sign in with Claude' }).click();
  // The mock opens a (fake) browser sign-in and completes after a moment.
  await expect(page.getByRole('link', { name: /sign-in page/i })).toHaveAttribute(
    'href',
    /claude\.ai\/oauth/,
  );
  await expect(page.getByText(/Signed in · Claude Max/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Give me a personality' })).toBeVisible({
    timeout: 8000,
  });

  const engine = await (await request.get('/api/engine')).json();
  expect(engine.state).toBe('ready');
});
