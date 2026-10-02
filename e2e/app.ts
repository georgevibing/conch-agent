import { expect, type Page } from '@playwright/test';

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
