import { execFile } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  icoFromPng,
  iconIn,
  linuxDesktopEntry,
  macInfoPlist,
  openScript,
  Shortcut,
  windowsOpenScript,
  type ShortcutSpec,
} from './shortcut';

const run = promisify(execFile);
const checkout = resolve(import.meta.dirname, '../../../..');

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conch-shortcut-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const spec = (url = 'http://localhost:4317'): ShortcutSpec => ({
  checkout,
  home: join(root, 'home'),
  node: process.execPath,
  log: join(root, 'home', 'logs', 'conch.log'),
  env: {},
  path: '/usr/bin:/bin',
  url,
  icon: iconIn(checkout),
});

const places = () => ({
  macApp: join(root, 'Applications', 'Conch.app'),
  startMenu: join(root, 'Start Menu', 'Conch.lnk'),
  desktopEntry: join(root, 'applications', 'conch.desktop'),
});

describe('the files', () => {
  it('ships the icon the app uses', () => {
    expect(existsSync(iconIn(checkout))).toBe(true);
    expect(existsSync(iconIn(checkout).replace('1024', '256'))).toBe(true);
  });

  it('makes an .ico Windows reads: one 256 px PNG', () => {
    const png = readFileSync(iconIn(checkout).replace('1024', '256'));
    const ico = Buffer.from(icoFromPng(png));
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    expect(ico.readUInt32LE(14)).toBe(png.byteLength);
    expect(ico.subarray(22, 30)).toEqual(png.subarray(0, 8));
  });

  it('names the Mac app Conch, with no Dock icon while it opens Conch', () => {
    const plist = macInfoPlist('0.2.0');
    expect(plist).toContain('<string>Conch</string>');
    expect(plist).toMatch(/<key>LSUIElement<\/key>\s*<true\/>/);
    expect(macInfoPlist('1.0"<x>')).toContain('<string>1.0x</string>');
  });

  it('quotes the desktop entry and the Windows script', () => {
    expect(linuxDesktopEntry('/home/a "b"/$x/open', '/i.png')).toContain(
      'Exec=/bin/sh "/home/a \\"b\\"/\\$x/open"',
    );
    const vbs = windowsOpenScript(spec('http://localhost:4317'), 'C:\\a "b"\\start.cmd');
    expect(vbs).toContain('shell.Run """C:\\a ""b""\\start.cmd""", 0, False');
    // wscript reads ANSI: nothing a code page could mangle.
    expect([...vbs].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });
});

describe.skipIf(process.platform !== 'darwin')('the Mac app', () => {
  it('is a real app bundle, with Conch’s icon', async () => {
    const shortcut = new Shortcut({ version: '0.2.0', platform: 'darwin', places: places() });
    expect(shortcut.installed()).toBe(false);
    expect(await shortcut.install(spec(), join(root, 'dir'))).toBe(true);
    expect(shortcut.installed()).toBe(true);
    const app = places().macApp;
    await expect(
      run('plutil', ['-lint', join(app, 'Contents', 'Info.plist')]),
    ).resolves.toBeTruthy();
    expect(statSync(join(app, 'Contents', 'MacOS', 'Conch')).mode & 0o111).toBeTruthy();
    expect(existsSync(join(app, 'Contents', 'Resources', 'Conch.icns'))).toBe(true);
    expect(readFileSync(join(app, 'Contents', 'Resources', 'start'), 'utf8')).toContain(
      'src/start.ts',
    );
    // Nothing changed: it says so.
    expect(await shortcut.install(spec(), join(root, 'dir'))).toBe(false);
    expect(await shortcut.install(spec('http://localhost:4400'), join(root, 'dir'))).toBe(true);
    await shortcut.remove(join(root, 'dir'));
    expect(existsSync(app)).toBe(false);
  });
});

/** The open script, run for real with a pretend browser opener. */
describe.skipIf(process.platform === 'win32')('opening the app', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  const health = () =>
    new Promise<number>((done) => {
      server = createServer((req, res) => {
        res.writeHead(req.url === '/api/health' ? 200 : 404).end('{}');
      }).listen(0, '127.0.0.1', () => {
        const address = server?.address();
        done(typeof address === 'object' && address ? address.port : 0);
      });
    });

  const setup = (url: string) => {
    const dir = join(root, 'app');
    const bin = join(root, 'bin');
    mkdirSync(dir, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const opened = join(root, 'opened');
    writeFileSync(join(bin, 'xdg-open'), `#!/bin/sh\necho "$1" >> ${JSON.stringify(opened)}\n`);
    chmodSync(join(bin, 'xdg-open'), 0o755);
    writeFileSync(join(dir, 'open'), openScript(spec(url), 'linux'));
    return { dir, bin, opened };
  };

  it('opens Conch straight away when it’s running', async () => {
    const port = await health();
    const url = `http://127.0.0.1:${port}`;
    const { dir, bin, opened } = setup(url);
    await run('/bin/sh', [join(dir, 'open')], {
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root },
    });
    expect(readFileSync(opened, 'utf8').trim()).toBe(url);
  });

  it('starts Conch when it isn’t running, then opens it once it answers', async () => {
    // A port nobody listens on yet; "start" brings a server up there.
    const port = await health();
    await new Promise((r) => server?.close(r));
    const url = `http://127.0.0.1:${port}`;
    const { dir, bin, opened } = setup(url);
    writeFileSync(
      join(dir, 'start'),
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} -e "require('http').createServer((q,s)=>s.end('{}')).listen(${port},'127.0.0.1');setTimeout(()=>process.exit(0),8000)"\n`,
    );
    await run('/bin/sh', [join(dir, 'open')], {
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root },
      timeout: 20_000,
    });
    expect(readFileSync(opened, 'utf8').trim()).toBe(url);
  }, 25_000);
});
