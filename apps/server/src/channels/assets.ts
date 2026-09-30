import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Conch's pearl, 640×640 JPEG: the picture a new bot gets when it has none,
 * so it looks like your assistant in the chat list without a trip to BotFather.
 */
export function botAvatar(): Promise<Buffer> {
  return readFile(join(import.meta.dirname, 'assets', 'avatar.jpg'));
}
