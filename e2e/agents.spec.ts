import { expect, test, type Page } from '@playwright/test';

/**
 * Agents, as a person meets them (ADR 0101): the welcome names the first one
 * and gives it a face; then make another in one screen (a name, a face, how it
 * sounds), start a chat with it and see its name over the reply, hand the chat
 * to the first one mid-way, rename it, and delete it with a moment to change
 * your mind. The tests share one gateway and run in order.
 */

async function agentNames(page: Page) {
  const list = (await (await page.request.get('/api/agents')).json()) as {
    agents: { name: string; avatar: { kind: string; id?: string } }[];
  };
  return list.agents;
}

async function waitForReply(page: Page, reply: string | RegExp) {
  await expect(page.getByText(reply).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^Stop(?! holding)/ })).toHaveCount(0, {
    timeout: 20_000,
  });
}

test('the welcome names the first agent and gives it a face', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Let’s begin' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ada');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Skip', exact: true }).click();

  // Who it is: a name to keep or change, a face, how it sounds — heard as it's chosen.
  await expect(page.getByRole('heading', { name: 'And who am I?' })).toBeVisible();
  const name = page.getByRole('textbox', { name: 'My name' });
  await expect(name).toHaveValue('Conch');
  await name.fill('Juniper');
  await page.getByRole('radio', { name: 'Fox' }).click();
  await page.getByRole('radio', { name: 'Playful' }).click();
  await expect(page.getByText(/Oh, hello, Ada! I’m Juniper\./)).toBeVisible();
  await page.getByRole('button', { name: 'Sounds good' }).click();

  await expect(page.getByRole('heading', { name: 'Bring the apps you live in.' })).toBeVisible({
    timeout: 8000,
  });
  await expect
    .poll(async () => (await agentNames(page)).map((a) => [a.name, a.avatar.id]))
    .toEqual([['Juniper', 'fox']]);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Open Conch' }).click();

  // The chat is with it, by its name.
  await expect(page.getByRole('textbox', { name: 'Message Juniper' })).toBeVisible();
});

test('make an agent, talk to it, hand the chat over, rename it, delete it with Undo', async ({
  page,
}) => {
  await page.goto('/settings/agents');
  const wall = page.getByRole('list', { name: 'Your agents' });
  await expect(wall.getByRole('button', { name: 'Juniper, default' })).toBeVisible();

  // One screen: a name (one to start from, typed over), a face, a tone — and it says hello.
  await wall.getByRole('button', { name: 'New agent' }).click();
  const maker = page.getByRole('dialog', { name: 'New agent' });
  const name = maker.getByRole('textbox', { name: 'Name' });
  await expect(name).toHaveValue('Atlas');
  await name.fill('Sage');
  await maker.getByRole('radio', { name: 'Owl' }).click();
  await maker.getByRole('radio', { name: 'Teal' }).click();
  await maker.getByRole('radio', { name: 'Calm' }).click();
  await expect(maker.getByText(/Hi Ada, I’m Sage\. No rush/)).toBeVisible();
  await maker.getByRole('button', { name: 'Create Sage' }).click();

  // Made: it says so, and offers a chat with it.
  const ready = page.getByRole('dialog', { name: 'Sage is ready' });
  await expect(ready).toBeVisible();
  await ready.getByRole('button', { name: 'Chat with Sage' }).click();

  // The new chat is with Sage, and Sage answers, by name.
  await expect(
    page.getByRole('button', { name: 'Talking to Sage. Choose another agent' }),
  ).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message Sage' });
  await composer.fill('What is a monad?');
  await composer.press('Enter');
  await expect(page).toHaveURL(/\/c\//);
  await waitForReply(page, "Here's a thought on");
  await expect(page.getByRole('heading', { name: 'Sage said:' })).toBeVisible();

  // Mid-chat, the header hands it to another agent; the chat shows where.
  await page.getByRole('button', { name: 'Sage answers this chat. Choose another agent' }).click();
  await page.getByRole('menuitemradio', { name: /Juniper/ }).click();
  await expect(page.getByText('Juniper answers from your next message')).toBeVisible();
  await expect(page.getByText('Juniper took over from Sage')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Juniper answers this chat. Choose another agent' }),
  ).toBeVisible();
  const next = page.getByRole('textbox', { name: 'Message Juniper' });
  await next.fill('And a functor?');
  await next.press('Enter');
  await expect(page.getByText("Here's a thought on")).toHaveCount(2, { timeout: 20_000 });
  await waitForReply(page, "Here's a thought on");
  await expect(page.getByRole('heading', { name: 'Juniper said:' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sage said:' })).toBeVisible();

  // Rename: its page saves as you type, and says so where you typed.
  await page.goto('/settings/agents');
  await page
    .getByRole('list', { name: 'Your agents' })
    .getByRole('button', { name: 'Sage', exact: true })
    .click();
  const rename = page.getByRole('textbox', { name: 'Name' });
  await rename.fill('Sage Owl');
  await expect(page.getByText('Saved')).toBeVisible();
  await expect.poll(async () => (await agentNames(page)).map((a) => a.name)).toContain('Sage Owl');
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Agents').click();
  const agents = page.getByRole('list', { name: 'Your agents' });
  await expect(agents.getByRole('button', { name: 'Sage Owl', exact: true })).toBeVisible();

  // Delete, then Undo: it comes back as it was.
  await agents.getByRole('button', { name: 'More for Sage Owl' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(agents.getByRole('button', { name: 'Sage Owl', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(agents.getByRole('button', { name: 'Sage Owl', exact: true })).toBeVisible();

  // Delete for good: once Undo has gone, it's gone from the gateway too.
  await agents.getByRole('button', { name: 'More for Sage Owl' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect
    .poll(async () => (await agentNames(page)).map((a) => a.name), { timeout: 15_000 })
    .toEqual(['Juniper']);
  await page.reload();
  await expect(
    page.getByRole('list', { name: 'Your agents' }).getByRole('button', { name: 'Sage Owl' }),
  ).toHaveCount(0);
});
