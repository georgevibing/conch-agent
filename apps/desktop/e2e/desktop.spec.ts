import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Socket } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  _electron as electron,
  expect,
  request,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const payload = join(here, 'payload', `${process.platform}-${process.arch}`);
const electronPath = createRequire(join(here, 'package.json'))('electron') as unknown as string;

test.skip(
  !existsSync(join(here, 'dist', 'main.cjs')) || !existsSync(join(payload, 'conch')),
  'Build the app first: pnpm desktop:start (or node scripts/bundle.mjs && node scripts/payload.mjs).',
);

let port = 4700 + Math.floor(Math.random() * 200);
let home: string;
let app: ElectronApplication | undefined;
const others: ChildProcess[] = [];

test.beforeEach(() => {
  port += 1;
  home = mkdtempSync(join(tmpdir(), 'conch-desktop-'));
});

test.afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  for (const child of others.splice(0)) child.kill();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const address = () => `http://127.0.0.1:${port}`;

async function health(url = address()) {
  const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2_000) }).catch(
    () => undefined,
  );
  return response?.ok ? ((await response.json()) as { bootId: string }) : undefined;
}

/** A Conch answering here that isn't the one with `bootId`: started again, or another one. */
async function another(bootId: string | undefined) {
  await expect
    .poll(
      async () => {
        const now = await health();
        return now && now.bootId !== bootId ? 'another' : 'waiting';
      },
      { timeout: 60_000 },
    )
    .toBe('another');
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith('CONCH_'),
    ),
  );
  app = await electron.launch({
    executablePath: electronPath,
    args: [here],
    env: { ...env, CONCH_HOME: home, CONCH_PORT: String(port), CONCH_ENGINE: 'mock' },
  });
  // Links and sign-ins go to the person's browser: here, to a list.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { opened?: string[] }).opened = opened;
    shell.openExternal = async (url: string) => void opened.push(url);
  });
  const page = await app.firstWindow();
  return { app, page };
}

const opened = (electronApp: ElectronApplication) =>
  electronApp.evaluate(() => (globalThis as { opened?: string[] }).opened ?? []);

const visible = (electronApp: ElectronApplication) =>
  electronApp.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length,
  );

/** Past the welcome, as a person who has used Conch before. */
async function onboard(page: Page) {
  await expect.poll(() => page.url(), { timeout: 60_000 }).toContain(address());
  const api = await request.newContext({ baseURL: address() });
  await api.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
  await api.dispose();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toBeVisible();
}

test('opens Conch in its window, on the gateway it carries, and talks', async () => {
  const { page } = await launch();
  await onboard(page);
  expect(await page.title()).toMatch(/Conch/);
  const composer = page.getByRole('textbox', { name: 'Message Conch' });
  await composer.fill('hello');
  await composer.press('Enter');
  await expect(page.getByText(/Ask me to/).last()).toBeVisible();
  // The gateway runs on the app's own Node, and says the app started it.
  const record = JSON.parse(readFileSync(join(home, 'gateway.json'), 'utf8')) as { port: number };
  expect(record.port).toBe(port);
  const api = await request.newContext({ baseURL: address() });
  const background = (await (await api.get('/api/background')).json()) as { running: string };
  expect(background.running).toBe('app');
  await api.dispose();
});

test('closing the window keeps Conch running; opening the app shows it again', async () => {
  const { app: electronApp, page } = await launch();
  await onboard(page);
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect.poll(() => visible(electronApp)).toBe(0);
  expect(await health()).toBeTruthy();
  // Opening the app again (a second copy hands over to this one).
  await electronApp.evaluate(({ app: self }) => self.emit('second-instance', {}, [], ''));
  await expect.poll(() => visible(electronApp)).toBe(1);
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toBeVisible();
});

test('links and sign-ins open in the person’s browser, never in the app', async () => {
  const { app: electronApp, page } = await launch();
  await onboard(page);
  expect(await page.evaluate(() => window.open('https://example.com/docs', '_blank'))).toBeNull();
  await expect.poll(() => opened(electronApp)).toContain('https://example.com/docs');
  // Something that isn't a web link is never handed over.
  await page.evaluate(() => window.open('file:///C:/Windows/System32/calc.exe', '_blank'));
  // A sign-in: Conch's own window opens, then heads for the provider.
  const made = await page.evaluate(() => {
    const popup = window.open('/integrations/done?opening=1', 'conch-sign-in', 'popup=yes');
    setTimeout(() => {
      if (popup) popup.location.href = 'https://accounts.example.com/o/oauth2/auth?state=x';
    }, 800);
    return Boolean(popup);
  });
  expect(made).toBe(true);
  await expect
    .poll(() => opened(electronApp))
    .toContain('https://accounts.example.com/o/oauth2/auth?state=x');
  await expect
    .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(1);
  expect(await opened(electronApp)).toEqual([
    'https://example.com/docs',
    'https://accounts.example.com/o/oauth2/auth?state=x',
  ]);
  // The window itself never leaves Conch.
  await page.evaluate(() => {
    window.location.href = 'https://example.org/elsewhere';
  });
  await expect.poll(() => opened(electronApp)).toContain('https://example.org/elsewhere');
  expect(page.url()).toContain(address());
});

test('a gateway that crashes is started again, and the page comes back', async () => {
  const { page } = await launch();
  await onboard(page);
  const before = await health();
  const { pid } = JSON.parse(readFileSync(join(home, 'gateway.json'), 'utf8')) as { pid: number };
  process.kill(pid, 'SIGKILL');
  await another(before?.bootId);
  await expect(page.getByRole('textbox', { name: 'Message Conch' })).toBeVisible({
    timeout: 30_000,
  });
});

test('Quit stops the app and its gateway', async () => {
  const { app: electronApp, page } = await launch();
  await onboard(page);
  const closed = new Promise<void>((resolve) => electronApp.once('close', () => resolve()));
  await electronApp.evaluate(({ app: self }) => self.quit());
  await closed;
  app = undefined;
  await expect.poll(() => health(), { timeout: 15_000 }).toBeUndefined();
});

test('shows a Conch that’s already running, and starts its own when that one goes', async () => {
  // A Conch from a checkout, already answering on this port with this home.
  const conch = spawn(
    join(payload, 'node', process.platform === 'win32' ? 'node.exe' : join('bin', 'node')),
    ['--import', 'tsx', 'src/main.ts'],
    {
      cwd: join(payload, 'conch', 'apps', 'server'),
      env: { ...process.env, CONCH_HOME: home, CONCH_PORT: String(port), CONCH_ENGINE: 'mock' },
      stdio: 'ignore',
    },
  );
  others.push(conch);
  await expect.poll(() => health(), { timeout: 60_000 }).toBeTruthy();
  const theirs = (await health())?.bootId;
  const { page } = await launch();
  await expect.poll(() => page.url(), { timeout: 60_000 }).toContain(address());
  expect((await health())?.bootId).toBe(theirs);
  // It stops: the app starts its own in its place.
  conch.kill();
  await another(theirs);
});

test('when Conch can’t start, the window says why, and Try again starts it', async () => {
  // Another program holds the port Conch was told to use.
  const { createServer } = await import('node:net');
  const sockets = new Set<Socket>();
  const holder = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => holder.listen(port, '127.0.0.1', resolve));
  const { page } = await launch();
  await expect(page.getByRole('heading', { name: 'Conch stopped' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(new RegExp(`Port ${port} is in use`))).toBeVisible();
  // Conch looked to see whether a Conch answers there: those connections go too.
  const closed = new Promise((resolve) => holder.close(resolve));
  for (const socket of sockets) socket.destroy();
  await closed;
  await page.getByRole('link', { name: 'Try again' }).click();
  await expect.poll(() => page.url(), { timeout: 60_000 }).toContain(address());
  expect(await health()).toBeTruthy();
});
