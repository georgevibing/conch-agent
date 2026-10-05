import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationEventInput, PermissionMode } from '@conch/protocol';
import { chromium, type BrowserContext } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AskRequest, ToolContext } from '../conversations/manager';
import type { Engine, HostTool, PermissionDecision } from '../engines/types';
import { hostToolText } from '../engines/types';
import { addressHost, checkAddress, chromeAddress } from './backends';
import { findBrowsers } from './locate';
import { BrowserService } from './service';

/**
 * Where the browser runs (ADR 0080), for real: a browser started here with
 * remote debugging stands in for your own Chrome, a cloud browser (through a
 * pretend Browserbase) and a browser at an address. Conch touches only its
 * own tabs there, contains them, marks them, never closes the browser, and
 * falls back to its own browser when the chosen one can't be reached.
 */

const executable = existsSync(chromium.executablePath())
  ? chromium.executablePath()
  : findBrowsers()[0]?.path;

let site: Server;
let origin = '';
let home = '';
let profile = '';
let yours: BrowserContext | undefined;
let devtools = '';
let browser: BrowserService;
let bb: { status: number; body: unknown; calls: { url: string; init?: RequestInit }[] };

const pages: Record<string, string> = {
  '/': `<title>Shop</title><h1>Shop</h1><button onclick="document.title='Added'">Add to cart</button>`,
};

beforeAll(async () => {
  if (!executable) return;
  site = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>${pages[req.url ?? '/'] ?? pages['/']}`);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  origin = `http://127.0.0.1:${address.port}`;
  home = await mkdtemp(join(tmpdir(), 'conch-backends-'));
  profile = await mkdtemp(join(tmpdir(), 'conch-yours-'));
  // "Your Chrome": open with remote debugging, and a tab of your own in it.
  // Playwright supplies its tested launch flags, waits for readiness and drains
  // shutdown. A raw Chrome spawn plus a short port-file loop depended on the
  // runner's installed Chrome and sometimes never reached a usable browser.
  yours = await chromium.launchPersistentContext(profile, {
    executablePath: executable,
    headless: true,
    args: ['--remote-debugging-port=0'],
    timeout: 30_000,
  });
  const ownTab = yours.pages()[0] ?? (await yours.newPage());
  await ownTab.goto('data:text/html,<title>My bank</title><h1>Mine</h1>');
  const file = join(profile, 'DevToolsActivePort');
  const [port, path] = (await readFile(file, 'utf8')).split(/\r?\n/);
  devtools = `ws://127.0.0.1:${port}${path}`;
  // The port file appears before Chrome has finished creating its initial page.
  // Wait for the fixture itself, so CDP does not attach midway through startup.
  await vi.waitFor(async () => expect(await yourTabs()).toContain('My bank'), {
    timeout: 10_000,
  });
  bb = { status: 200, body: { id: 's1', connectUrl: devtools }, calls: [] };
  browser = new BrowserService({
    home,
    gatewayPort: 4999,
    workspace: () => Promise.resolve(home),
    emit: () => undefined,
    chromeDirs: () => [profile],
    fetch: (url, init) => {
      bb.calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify(bb.body), {
          status: bb.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  await browser.updateSettings({ allowLocal: true });
}, 60_000);

afterAll(async () => {
  await browser?.stop();
  await yours?.close();
  site?.closeAllConnections();
  if (site) await new Promise((resolve) => site.close(resolve));
  await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
}, 60_000);

function harness(
  conversationId: string,
  answers: PermissionDecision[] = [],
  mode: PermissionMode = 'default',
) {
  const asked: AskRequest[] = [];
  const events: ConversationEventInput[] = [];
  const ctx: ToolContext = {
    conversationId,
    append: (event) => events.push(event),
    engine: { hostTools: true } as unknown as Engine,
    permissionMode: mode,
    ask: (request) => {
      asked.push(request);
      return Promise.resolve(answers.shift() ?? 'deny');
    },
    signal: new AbortController().signal,
  };
  const tools = new Map(browser.tools(ctx).map((t) => [t.name, t]));
  const call = async (name: string, args: Record<string, unknown>) =>
    hostToolText(await (tools.get(name) as HostTool).run(args as never));
  return { call, asked, events };
}

/** The tabs open in "your Chrome", by its own account. */
async function yourTabs(): Promise<string[]> {
  const port = /:(\d+)\//.exec(devtools)?.[1];
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = (await res.json()) as { type: string; title: string }[];
  return list.filter((t) => t.type === 'page').map((t) => t.title);
}

describe('browser addresses', () => {
  it('only takes DevTools addresses, and shows only their host', () => {
    expect(checkAddress('wss://cloud.example/devtools?token=abc')).toBe(
      'wss://cloud.example/devtools?token=abc',
    );
    expect(() => checkAddress('file:///etc/passwd')).toThrow(/isn’t a browser address/);
    expect(() => checkAddress('not a url')).toThrow(/isn’t a browser address/);
    expect(addressHost('wss://user:pw@cloud.example:9222/x?token=abc')).toBe('cloud.example:9222');
  });

  it('finds no Chrome where nothing listens', async () => {
    expect(await chromeAddress([join(tmpdir(), 'no-such-profile')])).toBeUndefined();
  });
});

describe.skipIf(!executable)('your own Chrome, for real', () => {
  it(
    'touches only its own tabs, marks them, asks every site, and leaves Chrome running',
    { timeout: 120_000 },
    async () => {
      await browser.setBackend({ kind: 'chrome' });
      const status = await browser.status();
      expect(status.backend).toMatchObject({ chosen: 'chrome', chrome: 'ready' });
      // Full trust, and "Always": your own Chrome still asks once per site per chat.
      const { call, asked } = harness('conv_chrome', ['allow-always'], 'bypassPermissions');
      let text = await call('browser_open', { url: `${origin}/` });
      expect(text).toContain('Page: Shop');
      expect((await browser.status()).backend).toMatchObject({ using: 'chrome' });
      text = await call('browser_click', {
        ref: /\[ref=([a-z0-9]+)\]/.exec(
          text.split('\n').find((l) => l.includes('Add to cart')) ?? '',
        )?.[1],
        element: 'Add to cart',
      });
      expect(asked.map((a) => a.browser?.kind)).toEqual(['site']);
      expect((await browser.status()).sites).toEqual([]);

      const tab = browser.tabIfOpen('conv_chrome');
      // The badge says which tab is Conch's, and the agent never reads it.
      expect(
        await tab?.page.evaluate('document.getElementById("__conch_badge")?.textContent'),
      ).toBe('Conch is using this tab');
      expect(text).not.toContain('Conch is using this tab');
      // Your tab is there, untouched, and never offered to the agent.
      expect(await yourTabs()).toContain('My bank');
      expect(tab?.tabs).toHaveLength(1);
      // Conch's own address stays out of reach from its tabs.
      expect(await call('browser_open', { url: 'http://127.0.0.1:4999/api/state' })).toBe(
        'The browser can’t open Conch itself.',
      );

      // Letting go closes Conch's tabs only; your Chrome and your tab stay.
      await browser.stop();
      await expect.poll(yourTabs).toEqual(['My bank']);
    },
  );

  it(
    'falls back to its own browser while your Chrome can’t be reached, and says why',
    { timeout: 120_000 },
    async () => {
      const real = profile;
      profile = join(tmpdir(), 'conch-no-chrome-here');
      try {
        await browser.setBackend({ kind: 'chrome' });
        const { call } = harness('conv_fallback');
        const text = await call('browser_open', { url: `${origin}/` });
        expect(text).toContain('Page: Shop');
        const status = await browser.status();
        expect(status.backend).toMatchObject({
          chosen: 'chrome',
          using: 'local',
          chrome: 'closed',
        });
        expect(status.backend?.fellBack).toMatch(/chrome:\/\/inspect\/#remote-debugging/);
        expect(status.healed[0]?.message).toMatch(/Your Chrome couldn’t be reached/);
        expect(await browser.promptSection({ hostTools: true } as unknown as Engine)).toContain(
          'Conch’s own browser',
        );
      } finally {
        profile = real;
        await browser.stop();
      }
    },
  );
});

describe.skipIf(!executable)('a browser in the cloud, for real', () => {
  it(
    'starts a Browserbase session with the key, and never shows the key back',
    { timeout: 120_000 },
    async () => {
      await browser.setBackend({
        kind: 'browserbase',
        key: 'bb_live_' + 'testkey123',
        project: 'p1',
      });
      const { call } = harness('conv_bb');
      const text = await call('browser_open', { url: `${origin}/` });
      expect(text).toContain('Page: Shop');
      expect(bb.calls[0]?.url).toBe('https://api.browserbase.com/v1/sessions');
      expect(new Headers(bb.calls[0]?.init?.headers).get('x-bb-api-key')).toBe(
        'bb_live_testkey123',
      );
      expect(JSON.parse(String(bb.calls[0]?.init?.body))).toEqual({ projectId: 'p1' });
      const status = await browser.status();
      expect(status.backend).toMatchObject({ chosen: 'browserbase', using: 'browserbase' });
      expect(JSON.stringify(status)).not.toContain('testkey123');
      // The key file is Conch's: sealed in a real Conch, and never the agent's to read.
      expect((await browser.secrets.read()).browserbase?.key).toBe('bb_live_testkey123');
      await browser.stop();
      // The browser it used is let go of, never closed.
      expect(await yourTabs()).toContain('My bank');
    },
  );

  it('falls back when the key is refused, and says so plainly', { timeout: 120_000 }, async () => {
    bb.status = 401;
    bb.body = { error: 'unauthorized' };
    try {
      await browser.setBackend({ kind: 'browserbase' });
      const { call } = harness('conv_bb_bad');
      expect(await call('browser_open', { url: `${origin}/` })).toContain('Page: Shop');
      expect((await browser.status()).backend?.fellBack).toMatch(
        /Browserbase didn’t accept the API key/,
      );
    } finally {
      bb.status = 200;
      bb.body = { id: 's1', connectUrl: devtools };
      await browser.stop();
    }
  });

  it(
    'connects to a browser at an address, contained like its own',
    { timeout: 120_000 },
    async () => {
      await browser.setBackend({ kind: 'cdp', address: devtools });
      const { call } = harness('conv_cdp');
      expect(await call('browser_open', { url: `${origin}/` })).toContain('Page: Shop');
      expect((await browser.status()).backend).toMatchObject({
        using: 'cdp',
        saved: { cdp: addressHost(devtools) },
      });
      expect(await call('browser_open', { url: 'http://127.0.0.1:4999/' })).toBe(
        'The browser can’t open Conch itself.',
      );
      await browser.setBackend({ kind: 'local' });
      expect((await browser.status()).backend?.chosen).toBe('local');
    },
  );

  it('won’t pick a cloud browser without its key', async () => {
    await browser.forgetBackend('steel');
    await expect(browser.setBackend({ kind: 'steel' })).rejects.toThrow(/Steel API key/);
  });
});
