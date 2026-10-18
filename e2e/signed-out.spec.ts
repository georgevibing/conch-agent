import { expect, test } from '@playwright/test';

import { toProviders } from './app';

test('signs in to the provider from the browser', async ({ page, request }) => {
  // The sign-in window opens by itself; here it's a stand-in, so the journey never
  // loads the real provider's page, and the test can see where it was sent.
  await page.addInitScript(() => {
    const fake = { closed: false, opener: {}, location: { href: '' }, focus() {}, close() {} };
    Object.assign(window, { __signInWindow: fake });
    window.open = (() => fake) as typeof window.open;
  });
  await page.goto('/');
  await toProviders(page);

  await page
    .getByRole('article', { name: 'Claude Code' })
    .getByRole('button', { name: 'Sign in' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Sign in to/ }).click();

  // The mock opens a (fake) browser sign-in and completes after a moment.
  await expect(dialog.getByRole('link', { name: /sign-in page/i })).toHaveAttribute(
    'href',
    /claude\.ai\/oauth/,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __signInWindow: { location: { href: string } } }).__signInWindow
            .location.href,
      ),
    )
    .toMatch(/claude\.ai\/oauth/);
  // The dialog says it worked, then gets out of the way and the flow moves on.
  await expect(dialog.getByText(/Claude Max/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /You’re all set/ })).toBeVisible({
    timeout: 10_000,
  });

  const engine = await (await request.get('/api/engine')).json();
  expect(engine.state).toBe('ready');
});
