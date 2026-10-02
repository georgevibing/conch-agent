import { expect, test } from '@playwright/test';

test('guides installation and notices when the provider appears', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // The card says what's missing; the dialog says what to type.
  const card = page.getByRole('article', { name: 'Claude Code' });
  await expect(card.getByText(/isn’t installed|isn't installed/)).toBeVisible();
  await card.getByRole('button', { name: 'How to install' }).click();

  const dialog = page.getByRole('dialog');
  // The installer for the computer Conch runs on.
  const installer =
    process.platform === 'win32'
      ? 'irm https://claude.ai/install.ps1 | iex'
      : 'curl -fsSL https://claude.ai/install.sh | bash';
  await expect(dialog.getByText(installer)).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Setup guide/ })).toHaveAttribute(
    'href',
    /code\.claude\.com/,
  );

  // The mock "installs" itself after a couple of automatic re-checks, and the
  // dialog moves on by itself.
  await expect(dialog.getByRole('button', { name: /^Sign in to/ })).toBeVisible({
    timeout: 20_000,
  });
});
