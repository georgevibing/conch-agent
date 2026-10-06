import { expect, test, type Page } from '@playwright/test';

import { openConch, say } from './app';

/**
 * The chat list, organised (ADR 0089), in a real browser: pin a chat, make a
 * folder and drag a chat into it, choose two and archive them together, and
 * find it all as it was after a reload. Then a chat started inside a folder,
 * and — on a phone — a chat held until it lifts and dragged into one.
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

const list = (page: Page) => page.getByRole('navigation', { name: 'Conversations' });

interface Listed {
  id: string;
  title: string;
  folderId?: string;
  titling?: boolean;
}

async function chats(page: Page): Promise<Listed[]> {
  const res = await page.request.get('/api/conversations');
  return (await res.json()) as Listed[];
}

async function titles(page: Page): Promise<string[]> {
  return (await chats(page)).map((c) => c.title);
}

/** A chat's own row, by its id: the mock titles two chats alike. */
const rowOf = (page: Page, id: string) => list(page).locator(`a[href="/c/${id}"]`);

/** The chat this does that wasn't there before, however the mock titled it. */
async function newChat(page: Page, before: ReadonlySet<string>, run: () => Promise<void>) {
  await run();
  await expect.poll(async () => (await chats(page)).some((c) => !before.has(c.id))).toBe(true);
  const made = (await chats(page)).find((c) => !before.has(c.id));
  if (!made) throw new Error('the new chat');
  return made;
}

/** Make a folder from the list's own menu, and say which it is. */
async function makeFolder(page: Page, name: string, mark: string) {
  await list(page).getByRole('button', { name: 'Show and sort chats' }).click();
  await page.getByRole('menuitem', { name: 'New folder…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialog.getByRole('radio', { name: mark }).click();
  await dialog.getByRole('button', { name: 'Create folder' }).click();
  await expect(list(page).getByRole('region', { name })).toBeVisible();
  const folders = (await (await page.request.get('/api/folders')).json()) as {
    id: string;
    name: string;
  }[];
  const made = folders.find((f) => f.name === name);
  if (!made) throw new Error(`the folder ${name}`);
  return made.id;
}

test('pin, file, drag, select and archive, and it all stays after a reload', async ({ page }) => {
  await openConch(page);
  const messages = ['Plan a week in Lisbon', 'Groceries for Sunday', 'Birthday ideas for Maya'];
  for (const [index, text] of messages.entries()) {
    if (index > 0) {
      await page.getByRole('button', { name: 'New chat' }).click();
      // Wait for the new view and its focus effect before typing. The previous
      // chat's composer can still be present while navigation is settling.
      await expect(page).toHaveURL('/');
      await expect(page.getByRole('textbox', { name: 'Message Conch' })).toBeFocused();
    }
    await say(page, text, /Ask me to/);
  }
  // Each is titled by now; work with whatever names they were given.
  await expect.poll(async () => (await titles(page)).length).toBe(3);
  const [newest, middle, oldest] = await titles(page);
  if (!newest || !middle || !oldest) throw new Error('three chats');
  const nav = list(page);

  // Pin from the menu.
  await nav.getByRole('button', { name: `Options for ${oldest}` }).click();
  await page.getByRole('menuitem', { name: 'Pin' }).click();
  const pinned = nav.getByRole('region', { name: 'Pinned' });
  await expect(pinned.getByRole('link', { name: oldest })).toBeVisible();

  // A folder, from the list's own menu.
  await makeFolder(page, 'Home', 'House');
  const folder = nav.getByRole('region', { name: 'Home' });

  // Dragged onto the folder.
  await nav.getByRole('link', { name: middle }).dragTo(folder);
  await expect(folder.getByRole('link', { name: middle })).toBeVisible();

  // ⌘-click two, then archive them together.
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await nav.getByRole('link', { name: newest }).click({ modifiers: [mod] });
  await nav.getByRole('checkbox', { name: middle }).check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Archived 2 chats' })).toBeVisible();
  await expect(nav.getByRole('link', { name: newest })).toHaveCount(0);

  await page.reload();
  await expect(list(page).getByRole('region', { name: 'Pinned' })).toContainText(oldest);
  await expect(list(page).getByRole('region', { name: 'Home' })).toBeVisible();
  await expect(list(page).getByRole('link', { name: 'Archived 2 chats' })).toBeVisible();
});

test('a chat started from a folder is in it from its first message', async ({ page }) => {
  await openConch(page);
  // The list's own menu (where New folder… is) appears with the first chat.
  const first = new Set((await chats(page)).map((c) => c.id));
  await newChat(page, first, () => say(page, 'Where to go in June', /Ask me to/));
  const nav = list(page);
  const trips = await makeFolder(page, 'Trips', 'Plane');
  const folder = nav.getByRole('region', { name: 'Trips' });

  // ✎ beside the folder's name: the new chat page says where it's going, and
  // the folder keeps a place for the chat until it exists.
  const before = new Set((await chats(page)).map((c) => c.id));
  await folder.getByRole('button', { name: 'New chat in Trips' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('New chat in Trips')).toBeVisible();
  await expect(folder.getByRole('link', { name: 'New chat' })).toBeVisible();

  // Filed by the gateway as it created it, so it never showed anywhere else.
  const inside = await newChat(page, before, () => say(page, 'Book a hotel in Porto', /Ask me to/));
  expect(inside.folderId).toBe(trips);
  await expect(folder.locator(`a[href="/c/${inside.id}"]`)).toBeVisible();

  // Plain New chat after it starts a chat outside every folder again.
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByText('New chat in Trips')).toHaveCount(0);
  const loose = await newChat(page, new Set([...before, inside.id]), () =>
    say(page, 'What to read next', /Ask me to/),
  );
  expect(loose.folderId).toBeUndefined();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a chat held until it lifts can be dragged into a folder', async ({ page, context }) => {
    await openConch(page);
    const before = new Set((await chats(page)).map((c) => c.id));
    const only = await newChat(page, before, () =>
      say(page, 'Swimming spots near Berlin', /Ask me to/),
    );

    // The sidebar is a sheet on a phone.
    await page.getByRole('button', { name: 'Open conversations' }).click();
    const nav = list(page);
    const holidays = await makeFolder(page, 'Holidays', 'Plane');
    const folder = nav.getByRole('region', { name: 'Holidays' });
    const from = await rowOf(page, only.id).boundingBox();
    const onto = await folder.getByRole('button', { name: /^Holidays/ }).boundingBox();
    if (!from || !onto) throw new Error('the row and the folder');

    // Playwright can only tap; a real finger that holds and then drags is these.
    const cdp = await context.newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
      });
    const x = from.x + from.width / 2;
    await touch('touchStart', x, from.y + from.height / 2);
    // Held still: the row lifts.
    await expect(page.locator('[data-held="lifted"]')).toHaveCount(1);
    // Then it comes along, and the folder says what letting go will do.
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const y = from.y + from.height / 2 + ((onto.y + onto.height / 2 - from.y) * i) / steps;
      await touch('touchMove', x, y);
      await page.waitForTimeout(40);
    }
    await expect(folder).toHaveAttribute('data-drop-over', 'true');
    await expect(folder.getByText('Drop to move to Holidays')).toBeVisible();
    await touch('touchEnd');

    await expect(folder.locator(`a[href="/c/${only.id}"]`)).toBeVisible();
    await expect
      .poll(async () => (await chats(page)).find((c) => c.id === only.id)?.folderId)
      .toBe(holidays);
    // Nothing is left following the finger.
    await expect(page.locator('[data-held]')).toHaveCount(0);
  });
});
