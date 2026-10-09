import { expect, test } from '@playwright/test';

/**
 * What you were writing and hadn't sent comes back (ADR 0124): the words and
 * the files, after a reload, from Conch's own copy as well as this tab's, and
 * Enter sends it as it was.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

/** 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('type and attach in a chat, reload, and Enter sends it as it was', async ({
  page,
  request,
}) => {
  // A chat to come back to.
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('Hello');
  await composer.press('Enter');
  await page.waitForURL(/\/c\//);
  // Its reply is over.
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  const id = new URL(page.url()).pathname.split('/').at(-1) ?? '';

  // Written, attached, not sent.
  await composer.fill('What’s in this picture?');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files' }).click();
  const kept = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/conversations/${id}/draft`) &&
      r.request().method() === 'PUT' &&
      (r.request().postData() ?? '').includes('att_'),
  );
  await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('button', { name: /^dot\.png, PNG/ })).toBeVisible();
  await kept;

  // Conch has it, not only this tab.
  const draft = (await (await request.get(`/api/conversations/${id}/draft`)).json()) as {
    draft: { text: string; attachments: { name: string }[] } | null;
  };
  expect(draft.draft).toMatchObject({
    text: 'What’s in this picture?',
    attachments: [{ name: 'dot.png' }],
  });

  await page.reload();
  await expect(composer).toHaveValue('What’s in this picture?');
  await expect(page.getByRole('button', { name: /^dot\.png, PNG/ })).toBeVisible();

  // Another device: nothing kept in this browser, and it's still there, from Conch.
  await page.evaluate(() => localStorage.removeItem('conch.drafts'));
  await page.reload();
  await expect(composer).toHaveValue('What’s in this picture?');
  await expect(page.getByRole('button', { name: /^dot\.png, PNG/ })).toBeVisible();

  await composer.focus();
  await composer.press('Enter');
  await expect(page.getByText(/You attached one thing: dot\.png \(image\/png\)/)).toBeVisible();
  await expect(composer).toHaveValue('');
  await expect(page.getByRole('list', { name: 'Attachments' })).toHaveCount(0);
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/conversations/${id}/draft`)).json()) as { draft: unknown })
          .draft,
    )
    .toBeNull();
});
