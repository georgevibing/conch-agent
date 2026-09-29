import { expect, test } from '@playwright/test';

test('guides installation and notices when Claude Code appears', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();

  await expect(page.getByText(/isn’t installed yet|isn't installed yet/)).toBeVisible();
  await expect(page.getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeVisible();
  await expect(page.getByRole('link', { name: /Setup guide/ })).toHaveAttribute(
    'href',
    /code\.claude\.com/,
  );

  // The mock "installs" Claude Code after a couple of automatic re-checks.
  await expect(page.getByRole('button', { name: 'Sign in with Claude' })).toBeVisible({
    timeout: 15_000,
  });
});
