import { type APIRequestContext, expect, type Page } from '@playwright/test';

/**
 * Open Conch and wait until it's listening. Its shortcuts are attached in the
 * same pass that puts the cursor in the composer; a key pressed before that
 * goes nowhere, and a slow runner turns that into a ⌘K that never opens.
 */
export async function openConch(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toBeFocused();
}

/**
 * Say something and wait for the whole reply. `reply` is something only this
 * answer says: once it shows, the turn has really begun, and Stop stays until
 * it ends. Stop being gone isn't enough by itself: it blinks off between the
 * message landing and the reply starting, which on a slow runner is long
 * enough to look finished, and the next step then lands in the middle of the
 * reply.
 */
export async function say(page: Page, text: string, reply: string | RegExp) {
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill(text);
  await composer.press('Enter');
  await expect(page.getByText(reply).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^Stop(?! holding)/ })).toHaveCount(0, {
    timeout: 20_000,
  });
}

/**
 * Past the welcome's hello to "a mind to think with" (ADR 0068), without a
 * name, as someone who only wants to connect a provider would.
 */
export async function toProviders(page: Page) {
  await page.getByRole('button', { name: 'Let’s begin' }).click();
  await expect(page.getByRole('heading', { name: 'Now, a mind to think with.' })).toBeVisible();
}

/**
 * Start new chats in Ask first, for journeys about the approval question itself:
 * since ADR 0119 they start in Auto, which goes ahead with routine steps (running
 * the tests, an app's change, an email) without asking. The same as the unit
 * tests' `askFirst` (apps/server/src/test/modes.ts). The gateway is shared by
 * the journeys after it: `autoAgain` in an `afterEach` puts the default back.
 */
export async function askFirst(request: APIRequestContext) {
  await defaultMode(request, 'default');
}

/** New chats in Auto again, as a fresh Conch starts them (ADR 0119). */
export async function autoAgain(request: APIRequestContext) {
  await defaultMode(request, 'auto');
}

async function defaultMode(request: APIRequestContext, permissionMode: 'default' | 'auto') {
  const saved = await request.patch('/api/settings', { data: { preferences: { permissionMode } } });
  expect(saved.ok()).toBe(true);
}
