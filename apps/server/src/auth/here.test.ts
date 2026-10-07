import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HERE_CODE_TTL_MS,
  ThisComputer,
  hereKeyFile,
  linuxBrowserHome,
  safePage,
  trampolineHtml,
} from './here';

const posix = process.platform !== 'win32';

async function home() {
  return mkdtemp(join(tmpdir(), 'conch-here-'));
}

function computer(dir: string, extra: Partial<ConstructorParameters<typeof ThisComputer>[1]> = {}) {
  const healed: string[] = [];
  let now = 1_800_000_000_000;
  const here = new ThisComputer(dir, {
    heal: (message) => healed.push(message),
    now: () => now,
    browserHome: async () => undefined,
    ...extra,
  });
  return { here, healed, tick: (ms: number) => (now += ms) };
}

describe('the key', () => {
  it('is made once, private to this account, and kept', async () => {
    const dir = await home();
    const { here } = computer(dir);
    const key = here.key();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(hereKeyFile(dir), 'utf8').trim()).toBe(key);
    if (posix) {
      expect(statSync(hereKeyFile(dir)).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, 'here')).mode & 0o777).toBe(0o700);
    }
    expect(computer(dir).here.key()).toBe(key);
  });

  it.skipIf(!posix)('puts a key that others could read back to 0600, and says so', async () => {
    const dir = await home();
    const key = computer(dir).here.key();
    chmodSync(hereKeyFile(dir), 0o644);
    const { here, healed } = computer(dir);
    expect(here.key()).toBe(key);
    expect(statSync(hereKeyFile(dir)).mode & 0o777).toBe(0o600);
    expect(healed.join(' ')).toMatch(/private again/);
  });

  it('replaces a damaged key, and says that browsers need opening from Conch again', async () => {
    const dir = await home();
    mkdirSync(join(dir, 'here'), { recursive: true });
    writeFileSync(hereKeyFile(dir), 'not a key\n');
    const { here, healed } = computer(dir);
    expect(here.key()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(healed.join(' ')).toMatch(/Open Conch from your apps/);
  });

  it('notices a new key written by another process (pnpm conch reset)', async () => {
    const dir = await home();
    const running = computer(dir);
    const cookie = running.here.cookie();
    expect(running.here.checkCookie(cookie)).toBe(true);
    computer(dir).here.rotate();
    running.tick(1_500);
    expect(running.here.checkCookie(cookie)).toBe(false);
  });

  it('is never a cookie itself: only what it signs is', async () => {
    const { here } = computer(await home());
    expect(here.checkCookie(here.key())).toBe(false);
    expect(here.checkCookie(`v1.0.${'A'.repeat(22)}.${here.key()}`)).toBe(false);
  });
});

describe('the cookie', () => {
  it('checks, and refuses anything changed or made with another key', async () => {
    const { here } = computer(await home());
    const cookie = here.cookie();
    expect(cookie).toMatch(/^v1\.[0-9a-z]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(here.checkCookie(cookie)).toBe(true);
    const [v, issued, nonce, mac] = cookie.split('.') as [string, string, string, string];
    const other = (s: string) => `${s.slice(0, -1)}${s.endsWith('A') ? 'B' : 'A'}`;
    expect(here.checkCookie([v, issued, other(nonce), mac].join('.'))).toBe(false);
    expect(here.checkCookie([v, issued, nonce, other(mac)].join('.'))).toBe(false);
    const later = (Number.parseInt(issued, 36) + 1).toString(36);
    expect(here.checkCookie([v, later, nonce, mac].join('.'))).toBe(false);
    expect(here.checkCookie(['v2', issued, nonce, mac].join('.'))).toBe(false);
    expect(here.checkCookie(`${cookie}x`)).toBe(false);
    expect(here.checkCookie('v1...')).toBe(false);
    expect(here.checkCookie('')).toBe(false);
    expect(computer(await home()).here.checkCookie(cookie)).toBe(false);
  });

  it('stops working after 400 days, the most a browser keeps it', async () => {
    const { here, tick } = computer(await home());
    const cookie = here.cookie();
    tick(399 * 24 * 60 * 60 * 1000);
    expect(here.checkCookie(cookie)).toBe(true);
    tick(2 * 24 * 60 * 60 * 1000);
    expect(here.checkCookie(cookie)).toBe(false);
  });

  it('stops working when the key is made again', async () => {
    const { here } = computer(await home());
    const cookie = here.cookie();
    here.rotate();
    expect(here.checkCookie(cookie)).toBe(false);
  });
});

describe('one-time codes', () => {
  it('work once', async () => {
    const { here } = computer(await home());
    const { code, url } = await here.link({ port: 4317, page: '/?open=devices' });
    expect(url).toBe(`http://localhost:4317/?open=devices#here=${code}`);
    expect(here.redeem(code)).toBe(true);
    expect(here.redeem(code)).toBe(false);
  });

  it('expire after two minutes', async () => {
    const { here, tick } = computer(await home());
    const { code } = await here.link({ port: 4317 });
    tick(HERE_CODE_TTL_MS + 1);
    expect(here.redeem(code)).toBe(false);
  });

  it('refuse made-up and empty codes', async () => {
    const { here } = computer(await home());
    await here.link({ port: 4317 });
    expect(here.redeem('')).toBe(false);
    expect(here.redeem('x'.repeat(43))).toBe(false);
  });

  it('keep at most 32 waiting, dropping the oldest', async () => {
    const { here } = computer(await home());
    const first = await here.link({ port: 4317 });
    for (let i = 0; i < 32; i++) await here.link({ port: 4317 });
    expect(here.redeem(first.code)).toBe(false);
  });

  it('only ever lead to a page of this Conch', () => {
    expect(safePage(undefined)).toBe('/');
    expect(safePage('/?open=devices')).toBe('/?open=devices');
    expect(safePage('/settings/security')).toBe('/settings/security');
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'x',
      '/a b',
      '/#here=x',
      '/\nx',
    ])
      expect(safePage(bad)).toBeUndefined();
  });
});

describe('the file that opens the browser', () => {
  it('is private, sends the browser on, and goes once used', async () => {
    const dir = await home();
    const { here } = computer(dir);
    const { code, file } = await here.link({ port: 4317, page: '/?open=updates', file: true });
    expect(file).toBeDefined();
    const path = file ?? '';
    expect(path.startsWith(join(dir, 'here', 'open'))).toBe(true);
    if (posix) expect(statSync(path).mode & 0o777).toBe(0o600);
    const html = readFileSync(path, 'utf8');
    expect(html).toContain(`url=http://localhost:4317/?open=updates#here=${code}`);
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(here.redeem(code)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('is cleared when its code expires, and every start clears what a crash left', async () => {
    const dir = await home();
    const { here, tick } = computer(dir);
    const { file } = await here.link({ port: 4317, file: true });
    tick(HERE_CODE_TTL_MS + 1);
    await here.sweep();
    expect(existsSync(file ?? '')).toBe(false);
    const left = await here.link({ port: 4317, file: true });
    await computer(dir).here.start();
    expect(existsSync(left.file ?? '')).toBe(false);
  });

  it('goes where a snap or Flatpak browser can read it', async () => {
    const dir = await home();
    const snap = join(dir, 'snap', 'firefox', 'common');
    const { here } = computer(dir, { browserHome: async () => snap });
    const { file } = await here.link({ port: 4317, file: true });
    expect(file?.startsWith(snap)).toBe(true);
    expect(await readdir(snap)).toHaveLength(1);
  });

  it('escapes what it writes into the page', () => {
    const html = trampolineHtml('http://localhost:4317/?a=1&b="2"<x>#here=abc');
    expect(html).not.toContain('"2"');
    expect(html).not.toContain('<x>');
    expect(html).toContain('&amp;b=&quot;2&quot;&lt;x&gt;');
  });
});

/** Paths as Linux writes them, whichever system runs the test. */
const slashes = (path: string) => path.split(sep).join('/');

describe('which folder the default browser can read (Linux)', () => {
  const at = (browser: string | undefined, present: string[]) =>
    linuxBrowserHome({
      home: '/home/ada',
      exec: async () => browser,
      exists: (path) => present.includes(slashes(path)),
    });

  it('uses a snap’s own folder for a snap browser', async () => {
    const dir = await at('firefox_firefox.desktop', ['/snap/firefox', '/home/ada/snap/firefox']);
    expect(slashes(dir ?? '')).toBe('/home/ada/snap/firefox/common');
  });

  it('uses a Flatpak’s own folder for a Flatpak browser', async () => {
    const dir = await at('org.mozilla.firefox.desktop', [
      '/var/lib/flatpak/exports/share/applications/org.mozilla.firefox.desktop',
      '/home/ada/.var/app/org.mozilla.firefox',
    ]);
    expect(slashes(dir ?? '')).toBe('/home/ada/.var/app/org.mozilla.firefox/cache');
  });

  it('keeps Conch’s own folder for everything else', async () => {
    expect(await at('firefox.desktop', [])).toBeUndefined();
    expect(await at('google-chrome.desktop', ['/snap/google-chrome'])).toBeUndefined();
    expect(await at(undefined, [])).toBeUndefined();
    expect(await at('../../etc/passwd', ['/snap/..'])).toBeUndefined();
  });
});
