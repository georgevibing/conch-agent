import { describe, expect, it } from 'vitest';

import { fitPicture, keptAway, parseKeys, refusedKeys, toPicture, toScreen } from './policy';

const app = (id: string, name: string) => ({ id, name });

describe('the apps it never touches', () => {
  it.each([
    ['com.1password.1password', '1Password'],
    ['com.bitwarden.desktop', 'Bitwarden'],
    ['com.apple.keychainaccess', 'Keychain Access'],
    ['com.apple.systempreferences', 'System Settings'],
    ['com.apple.SecurityAgent', 'SecurityAgent'],
    ['com.apple.Terminal', 'Terminal'],
    ['com.googlecode.iterm2', 'iTerm2'],
    ['com.conchagent.app', 'Conch'],
    ['com.example.mybank', 'My Bank'],
    ['com.coinbase.Coinbase', 'Coinbase'],
    ['com.apple.Spotlight', 'Spotlight'],
  ])('keeps %s away', (id, name) => {
    expect(keptAway(app(id, name))).toBeDefined();
  });

  it('knows a renamed copy by its bundle id', () => {
    expect(keptAway(app('com.1password.1password', 'Passwörter'))?.label).toBe('Password managers');
  });

  it.each([
    ['com.apple.Notes', 'Notes'],
    ['com.apple.iWork.Keynote', 'Keynote'],
    ['com.apple.finder', 'Finder'],
    ['com.figma.Desktop', 'Figma'],
    ['com.apple.Safari', 'Safari'],
  ])('lets %s be asked about', (id, name) => {
    expect(keptAway(app(id, name))).toBeUndefined();
  });

  it('keeps Conch in a browser tab away, by its title', () => {
    const chrome = app('com.google.Chrome', 'Google Chrome');
    expect(keptAway(chrome, 'Conch')?.label).toBe('Conch itself');
    expect(keptAway(chrome, 'Plan a trip · Conch')?.label).toBe('Conch itself');
    expect(keptAway(chrome, 'Conch shells on the beach - Google Search')).toBeUndefined();
    expect(keptAway(chrome, 'GitHub')).toBeUndefined();
  });
});

describe('keys', () => {
  it('reads the names models write', () => {
    expect(parseKeys('Return')).toMatchObject({ code: 36, modifiers: [], label: 'return' });
    expect(parseKeys('cmd+s')).toMatchObject({ code: 1, modifiers: ['cmd'] });
    expect(parseKeys('super+shift+T')).toMatchObject({ code: 17, modifiers: ['shift', 'cmd'] });
    expect(parseKeys('ctrl + Page_Down')).toMatchObject({ code: 121, modifiers: ['ctrl'] });
    expect(parseKeys('BackSpace')).toMatchObject({ code: 51 });
    expect(parseKeys('alt+Left')).toMatchObject({ code: 123, modifiers: ['alt'] });
    expect(parseKeys('F5')).toMatchObject({ code: 96 });
    expect(parseKeys('8')).toMatchObject({ code: 28 });
    expect(parseKeys('-')).toMatchObject({ code: 27 });
  });

  it('says what’s wrong in words', () => {
    expect(parseKeys('')).toMatch(/which key/);
    expect(parseKeys('hyper+x')).toMatch(/isn’t a key to hold/);
    expect(parseKeys('cmd+banana')).toMatch(/isn’t a key Conch knows/);
  });

  it.each([
    'cmd+Escape',
    'ctrl+cmd+q',
    'shift+cmd+q',
    'alt+cmd+Escape',
    'shift+cmd+BackSpace',
    'cmd+space',
  ])('never presses %s', (keys) => {
    const combo = parseKeys(keys);
    if (typeof combo === 'string') throw new Error(combo);
    expect(refusedKeys(combo)).toBeTruthy();
  });

  it.each(['cmd+c', 'cmd+v', 'Return', 'Escape', 'cmd+shift+t', 'BackSpace'])(
    'presses %s',
    (keys) => {
      const combo = parseKeys(keys);
      if (typeof combo === 'string') throw new Error(combo);
      expect(refusedKeys(combo)).toBeUndefined();
    },
  );
});

describe('the picture and the screen', () => {
  it('fits a Retina laptop’s screen into about a megapixel', () => {
    expect(fitPicture(1512, 982)).toEqual({ width: 1232, height: 800, scale: 800 / 982 });
    expect(fitPicture(1280, 800).scale).toBe(1);
    expect(fitPicture(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
  });

  it('maps a point back, and refuses one off the picture', () => {
    const picture = fitPicture(2560, 1600);
    expect(picture.scale).toBe(0.5);
    expect(toScreen(100, 200, picture)).toEqual({ x: 200, y: 400 });
    expect(toScreen(-1, 3, picture)).toBeUndefined();
    expect(toScreen(1281, 3, picture)).toBeUndefined();
    expect(toScreen(Number.NaN, 3, picture)).toBeUndefined();
  });

  it('covers a window in the picture’s pixels, clipped', () => {
    const picture = fitPicture(2560, 1600);
    expect(toPicture({ x: 100, y: 100, width: 400, height: 200 }, picture)).toEqual({
      x: 50,
      y: 50,
      width: 200,
      height: 100,
    });
    expect(toPicture({ x: 2400, y: 0, width: 800, height: 100 }, picture)).toEqual({
      x: 1200,
      y: 0,
      width: 80,
      height: 50,
    });
    expect(toPicture({ x: 3000, y: 0, width: 10, height: 10 }, picture)).toBeUndefined();
  });
});
