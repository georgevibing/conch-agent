import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SettingsStore } from '../settings/store';
import { AvatarError, AvatarStore, MAX_AVATAR_BYTES, sniffImage } from './avatar';

/** The smallest real PNG: one transparent pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-avatar-'));
  const settings = new SettingsStore(home);
  return { home, settings, avatars: new AvatarStore(home, settings) };
}

describe('your photo', () => {
  it('knows a picture by its first bytes, never by what it says it is', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg onload="alert(1)"></svg>'))).toBeUndefined();
  });

  it('keeps a photo, gives it back as it is, and takes it away', async () => {
    const { settings, avatars } = await setup();
    await avatars.save(PNG.toString('base64'));
    const avatar = (await settings.get()).profile.avatar;
    expect(avatar).toMatchObject({ type: 'image/png' });
    expect((await avatars.read())?.bytes.equals(PNG)).toBe(true);
    // A change of name or About you keeps the photo.
    await settings.update({ profile: { name: 'George' } });
    expect((await settings.get()).profile.avatar).toEqual(avatar);
    await avatars.remove();
    expect((await settings.get()).profile.avatar).toBeUndefined();
    expect(await avatars.read()).toBeUndefined();
  });

  it('refuses what isn’t a small PNG, JPEG or WebP', async () => {
    const { avatars, settings } = await setup();
    await expect(avatars.save(Buffer.from('<svg/>').toString('base64'))).rejects.toThrow(
      AvatarError,
    );
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_AVATAR_BYTES)]);
    await expect(avatars.save(big.toString('base64'))).rejects.toThrow(/too big/);
    expect((await settings.get()).profile.avatar).toBeUndefined();
  });
});
