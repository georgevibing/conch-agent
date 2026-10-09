import type { Services } from '../services';

/**
 * Start new chats in Ask first, for tests about the approval question itself:
 * since ADR 0119 they start in Auto, which goes ahead with routine steps
 * (running the tests, changing a file) without asking.
 */
export async function askFirst(services: Services): Promise<void> {
  await services.settings.update({ preferences: { permissionMode: 'default' } });
}
