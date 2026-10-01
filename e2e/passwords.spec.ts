import { generateKeyPairSync } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * Passwords (ADR 0024), the way a person uses them: add one with a generated
 * password, find it, see and copy it, import from a browser, delete and bring
 * back, and reach it all from ⌘K.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

const snap = (page: Page, name: string) =>
  process.env.SNAP
    ? page.screenshot({ path: `.artifacts/snaps/app-passwords-${name}.png` })
    : Promise.resolve();

test('add, find, see and change a password', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/passwords');
  await expect(page.getByRole('heading', { name: 'Keep your passwords here' })).toBeVisible();
  await snap(page, 'empty');

  await page.getByRole('button', { name: 'Add a password' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Netflix');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('ada@example.com');
  // The generator fills the password in.
  await page.getByRole('button', { name: 'Make a strong password' }).click();
  await page.getByRole('button', { name: 'Use this password' }).click();
  const generated = await page.getByRole('textbox', { name: 'Password', exact: true }).inputValue();
  expect(generated).toHaveLength(20);
  await page.getByRole('textbox', { name: 'Website 1' }).fill('netflix.com');
  await snap(page, 'editor');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Netflix' })).toBeVisible();
  const password = page.getByRole('group', { name: 'Password' });
  await expect(password.getByText('Very strong')).toBeVisible();
  await expect(password.getByText(generated)).toHaveCount(0);
  await password.getByRole('button', { name: 'Show password' }).click();
  await expect(password.getByText(generated)).toBeVisible();
  await password.getByRole('button', { name: 'Copy password' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(generated);
  await snap(page, 'detail');

  // Edit: the password stays unless changed.
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Netflix (family)');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Netflix (family)' })).toBeVisible();
  await page
    .getByRole('group', { name: 'Password' })
    .getByRole('button', { name: 'Show password' })
    .click();
  await expect(page.getByText(generated)).toBeVisible();

  // Search by site.
  await page.getByRole('textbox', { name: 'Search passwords' }).fill('netflix');
  await expect(
    page.getByRole('button', { name: /^Netflix \(family\), ada@example.com/ }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Search passwords' }).fill('nothing-like-it');
  await expect(page.getByText('Nothing matches “nothing-like-it”')).toBeVisible();
});

test('import from Chrome, with duplicates left out, and the Security check', async ({ page }) => {
  await page.goto('/passwords');
  const csv = [
    'name,url,username,password,note',
    'GitHub,https://github.com,ada,password123,',
    'Old forum,https://forum.example,ada,password123,',
    'Bank,https://bank.example,ada,k7mbqe-x3tnzr-wd8pha-Q9!,',
    'Netflix,https://netflix.com,someone-else,another-Strong-pass-77!,',
  ].join('\n');
  // The first journey already saved one, so this goes through the menu.
  await page.getByRole('button', { name: 'More' }).first().click();
  await page.getByRole('menuitem', { name: 'Import passwords…' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a file…' }).click();
  await (
    await chooser
  ).setFiles({ name: 'Chrome Passwords.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(/4\s+items from\s+Chrome/)).toBeVisible();
  await snap(page, 'import');
  await page.getByRole('button', { name: 'Import 4 items' }).click();
  await expect(page.getByText(/Imported 4 items from Chrome/)).toBeVisible();

  // Reused and weak, said plainly, each a filter.
  await expect(
    page.getByRole('region', { name: 'Security check' }).getByText('Reused'),
  ).toBeVisible();
  await snap(page, 'list');
  await page
    .getByRole('region', { name: 'Security check' })
    .getByRole('button', { name: /Reused/ })
    .click();
  await expect(page.getByRole('button', { name: /^GitHub,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Bank,/ })).toHaveCount(0);

  // Importing the same file again finds nothing new.
  await page.getByRole('button', { name: 'More' }).first().click();
  await page.getByRole('menuitem', { name: 'Import passwords…' }).click();
  const again = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a file…' }).click();
  await (
    await again
  ).setFiles({ name: 'Chrome Passwords.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('button', { name: 'Nothing new to import' })).toBeDisabled();
});

test('delete to Recently deleted, undo, and ⌘K finds items by name', async ({ page, request }) => {
  await request.post('/api/vault/items', {
    data: {
      type: 'card',
      title: 'Everyday Visa',
      fields: [{ label: 'Number', kind: 'secret', role: 'cardNumber', value: '4111111111111111' }],
    },
  });
  await page.goto('/passwords');
  await page.getByRole('button', { name: /^Everyday Visa/ }).click();
  await expect(page.getByRole('heading', { name: 'Everyday Visa', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'More' }).last().click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('“Everyday Visa” moved to Recently deleted')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /^Everyday Visa/ })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('visa');
  await expect(page.getByRole('option', { name: /Everyday Visa/ })).toBeVisible();
  await page.getByRole('combobox').fill('new password');
  await page.getByRole('option', { name: /New password/ }).click();
  await expect(page.getByRole('form', { name: 'New login' })).toBeVisible();
});

test('the assistant asks for a login in the chat, and never sees it', async ({ page, request }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('Please ask me for my github.com login');
  await composer.press('Enter');
  const card = page.getByRole('form', { name: /asks for github\.com/ });
  await expect(card.getByText(/needs your sign-in for github\.com/)).toBeVisible();
  await expect(card.getByText('“To sign in to github.com for you”')).toBeVisible();
  await snap(page, 'chat-request');
  await card.getByLabel('Username').fill('ada-lovelace');
  await card.getByLabel('Password', { exact: true }).fill('gh-typed-secret-value-42');
  await card.getByRole('button', { name: 'Save to Passwords' }).click();
  await expect(page.getByText('Saved “github.com” to Passwords')).toBeVisible();
  await expect(page.getByText(/it’s in your Passwords now\. I never saw it/)).toBeVisible();
  // Nowhere in the chat, its log, or the page.
  expect(await page.content()).not.toContain('gh-typed-secret-value-42');
  const id = /\/c\/(c_[A-Za-z0-9_-]+)/.exec(page.url())?.[1];
  const log = await (await request.get(`/api/conversations/${id}`)).text();
  expect(log).not.toContain('gh-typed-secret-value-42');
  // It's in Passwords, for github.com.
  const vault = await (await request.get('/api/vault')).json();
  expect(vault.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: 'github.com', domains: ['github.com'] }),
    ]),
  );
});

test('reading a PIN asks first, and the PIN never shows in the chat', async ({ page, request }) => {
  await request.post('/api/vault/items', {
    data: {
      type: 'card',
      title: 'Travel Visa',
      fields: [{ label: 'PIN', kind: 'pin', role: 'cardPin', value: '4821' }],
    },
  });
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('Please read the PIN of Travel Visa');
  await composer.press('Enter');
  const ask = page.getByRole('group', { name: /read the PIN of “Travel Visa”/ });
  await expect(ask.getByText('“You asked me to use it”')).toBeVisible();
  await expect(ask.getByText(/will see it to do this/)).toBeVisible();
  await snap(page, 'chat-read');
  await ask.getByRole('button', { name: 'Allow once' }).click();
  await expect(page.getByText(/I have the pin now/)).toBeVisible();
  await expect(page.getByText(/read the PIN of “Travel Visa”/)).toBeVisible();
  expect(await page.content()).not.toContain('4821');
});

test('a locked Passwords opens with its password, here and from the chat', async ({
  page,
  request,
}) => {
  const lock = await request.patch('/api/vault/lock', {
    data: { enabled: true, password: 'tide pool seven' },
  });
  expect(lock.ok()).toBe(true);
  await request.post('/api/vault/lock', { data: {} });
  await page.goto('/passwords');
  await expect(page.getByRole('heading', { name: 'Passwords is locked' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Password for Passwords' }).fill('not it at all');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText(/isn’t the password/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Password for Passwords' }).fill('tide pool seven');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Passwords is locked' })).toHaveCount(0);

  // Locked again, the assistant asks for it to be unlocked, then carries on.
  await request.post('/api/vault/lock', { data: {} });
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('Please read the PIN of Travel Visa');
  await composer.press('Enter');
  const unlock = page.getByRole('form', { name: 'Unlock Passwords' });
  await expect(unlock.getByText('Passwords is locked')).toBeVisible();
  await snap(page, 'chat-unlock');
  await unlock.getByLabel('Password for Passwords').fill('tide pool seven');
  await unlock.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Passwords unlocked')).toBeVisible();
  await expect(page.getByRole('group', { name: /read the PIN of “Travel Visa”/ })).toBeVisible();
  await request.patch('/api/vault/lock', { data: { enabled: false } });
});

test('a passkey comes in with a Bitwarden export, shows on its login, and can be removed', async ({
  page,
  request,
}) => {
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'der' })
    .toString('base64url');
  const imported = await request.post('/api/vault/import', {
    data: {
      format: 'bitwarden-json',
      commit: true,
      text: JSON.stringify({
        encrypted: false,
        items: [
          {
            type: 1,
            name: 'Codeberg',
            login: {
              username: 'ada',
              password: 'a-long-codeberg-password-1',
              uris: [{ uri: 'https://codeberg.org' }],
              fido2Credentials: [
                {
                  credentialId: '0c1d2e3f-4a5b-6c7d-8e9f-a0b1c2d3e4f5',
                  keyAlgorithm: 'ECDSA',
                  keyCurve: 'P-256',
                  keyValue: key,
                  rpId: 'codeberg.org',
                  userName: 'ada',
                  counter: '0',
                },
              ],
            },
          },
        ],
      }),
    },
  });
  expect(imported.ok()).toBe(true);
  await page.goto('/passwords');
  await page.getByRole('button', { name: /^Codeberg, .*has a passkey/ }).click();
  const passkeys = page.getByRole('region', { name: 'Passkeys' });
  await expect(passkeys.getByText('Passkey for codeberg.org')).toBeVisible();
  await expect(passkeys.getByText(/ada · Not used yet/)).toBeVisible();
  // The key itself is nowhere on the page.
  expect(await page.content()).not.toContain(key.slice(0, 40));
  await snap(page, 'passkey');
  await passkeys.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Removed the passkey for codeberg.org')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Passkeys' })).toHaveCount(0);

  // Every manager Conch can read or copy from is offered.
  await page.getByRole('button', { name: 'More' }).first().click();
  await page.getByRole('menuitem', { name: 'Password managers…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Password managers' });
  for (const name of ['1Password', 'Bitwarden', 'KeePassXC', 'Proton Pass', 'Dashlane', 'Keeper'])
    await expect(dialog.getByText(name, { exact: true })).toBeVisible();
});

test('Esc or a click on empty space puts an item away, back to the start screen', async ({
  page,
  request,
}) => {
  await request.post('/api/vault/items', {
    data: {
      type: 'login',
      title: 'Mastodon',
      fields: [{ label: 'Username', kind: 'text', role: 'username', value: 'ada' }],
      urls: ['https://mastodon.social'],
    },
  });
  await page.goto('/passwords');
  // Nothing is opened for you: the start screen, with what you can do.
  const start = page.getByRole('heading', { name: 'Your passwords' });
  await expect(start).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect another password manager' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Mastodon,/ }).click();
  await expect(page.getByRole('heading', { name: 'Mastodon', level: 2 })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(start).toBeVisible();
  await expect(page).toHaveURL(/\/passwords$/);
  await page.getByRole('button', { name: /^Mastodon,/ }).click();
  await expect(start).toHaveCount(0);
  // The list's own background (between and below the rows), not a row.
  await page
    .getByRole('list')
    .filter({ has: page.getByRole('button', { name: /^Mastodon,/ }) })
    .evaluate((el: HTMLElement) => el.click());
  await expect(start).toBeVisible();
});
