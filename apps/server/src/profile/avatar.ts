/**
 * Your photo: one small picture, shown in About you and the sidebar instead
 * of your initial. The browser frames and shrinks it before it comes here;
 * Conch keeps it as `~/.conch/avatar`, only ever as PNG, JPEG or WebP (never
 * SVG, which can carry script), checked by its first bytes, not its name.
 */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { AvatarType } from '@conch/protocol';

import { writeFileAtomic } from '../lib/fs';
import type { SettingsStore } from '../settings/store';

export const AVATAR_FILE = 'avatar';
/** Plenty for a framed 512-pixel square; a photo straight off a camera is refused. */
export const MAX_AVATAR_BYTES = 700_000;

export class AvatarError extends Error {}

/** What kind of picture it really is, from its first bytes. */
export function sniffImage(bytes: Uint8Array): AvatarType | undefined {
  const at = (i: number, ...values: number[]) => values.every((v, n) => bytes[i + n] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return undefined;
}

export class AvatarStore {
  constructor(
    private readonly home: string,
    private readonly settings: SettingsStore,
  ) {}

  get #path() {
    return join(this.home, AVATAR_FILE);
  }

  /** Keep a new photo (base64), replacing any before it. */
  async save(base64: string): Promise<void> {
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length) throw new AvatarError('That picture was empty. Choose another.');
    if (bytes.length > MAX_AVATAR_BYTES)
      throw new AvatarError('That picture is too big. Choose a smaller one.');
    const type = sniffImage(bytes);
    if (!type) throw new AvatarError('Choose a PNG, JPEG or WebP picture.');
    await writeFileAtomic(this.#path, bytes, 0o600);
    await this.settings.setAvatar({ type, updatedAt: Date.now() });
  }

  /** The photo and its kind, when there is one. */
  async read(): Promise<{ bytes: Buffer; type: AvatarType } | undefined> {
    const avatar = (await this.settings.get()).profile.avatar;
    if (!avatar) return undefined;
    const bytes = await readFile(this.#path).catch(() => undefined);
    // Read back, it must still be what it said it was.
    return bytes && sniffImage(bytes) === avatar.type ? { bytes, type: avatar.type } : undefined;
  }

  /** Back to your initial. */
  async remove(): Promise<void> {
    await this.settings.setAvatar(undefined);
    await rm(this.#path, { force: true });
  }
}
