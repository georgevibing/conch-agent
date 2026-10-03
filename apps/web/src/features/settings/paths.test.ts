import { describe, expect, it } from 'vitest';

import { behindOf, behindPath, settingsAt, settingsPath } from './paths';

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
