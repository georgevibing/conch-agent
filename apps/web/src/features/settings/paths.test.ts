import { describe, expect, it } from 'vitest';

import { behindName, behindOf, behindPath, settingsAt, settingsPath } from './paths';

describe('Settings addresses', () => {
  it('names every place, and a page inside one', () => {
    expect(settingsPath()).toBe('/settings');
    expect(settingsPath('providers')).toBe('/settings/providers');
    expect(settingsPath('providers', 'server:my box')).toBe(
      '/settings/providers/server%3Amy%20box',
    );
  });

  it('reads back what it wrote, and nothing outside Settings', () => {
    expect(settingsAt('/settings')).toEqual({});
    expect(settingsAt('/settings/')).toEqual({});
    expect(settingsAt('/settings/security')).toEqual({ tab: 'security' });
    expect(settingsAt('/settings/providers/server%3Amy%20box')).toEqual({
      tab: 'providers',
      item: 'server:my box',
    });
    expect(settingsAt('/')).toBeNull();
    expect(settingsAt('/c/c1')).toBeNull();
    expect(settingsAt('/settingsx')).toBeNull();
  });

  it('opens Settings itself for a place it doesn’t have', () => {
    expect(settingsAt('/settings/nonsense')).toEqual({});
    expect(settingsAt('/settings/providers/%E0%A4%A')).toEqual({ tab: 'providers' });
  });

  it('only ever goes back to a page of this app', () => {
    expect(behindPath('/c/c1?x=1#m')).toBe('/c/c1?x=1#m');
    expect(behindPath('//elsewhere.example/c')).toBeUndefined();
    expect(behindPath('https://elsewhere.example/')).toBeUndefined();
    expect(behindPath('/settings/health')).toBeUndefined();
    expect(behindPath(42)).toBeUndefined();
    expect(behindOf({ state: { behind: '/apps' } })).toBe('/apps');
    expect(behindOf({ state: null })).toBeUndefined();
  });
});

describe('Leaving Settings', () => {
  it('names the page it goes back to', () => {
    expect(behindName(undefined)).toBe('Chats');
    expect(behindName('/')).toBe('Chats');
    expect(behindName('/c/c1?x=1')).toBe('Chats');
    expect(behindName('/routines/r_1')).toBe('Routines');
    expect(behindName('/apps')).toBe('Apps');
    expect(behindName('/channels/ch_1')).toBe('Apps');
    expect(behindName('/archived')).toBe('Archived chats');
    // Something pinned has a name only its page knows.
    expect(behindName('/apps/a_123')).toBe('Back');
    expect(behindName('/somewhere-new')).toBe('Back');
  });
});
