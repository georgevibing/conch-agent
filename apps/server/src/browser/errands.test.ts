import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERRANDS_FILE, errandLimit, loginsFor } from './errands';
import { findBrowsers } from './locate';
import type { StorageState } from './runtime';
import { BrowserService } from './service';

/** A browser per errand (ADR 0141). The parts that need one run a real headless browser, when there is one. */
const hasBrowser =
  findBrowsers({ downloaded: () => chromium.executablePath() }).length > 0 ||
  existsSync(chromium.executablePath());

const cookie = (name: string, domain: string) => ({
  name,
  value: `${name}-value`,
  domain,
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: false,
  sameSite: 'Lax' as const,
});

describe('lending sign-ins', () => {
  const state: StorageState = {
    cookies: [
      cookie('shop', '.shop.example'),
      cookie('shopWww', 'www.shop.example'),
      cookie('bank', '.bank.example'),
      // A look-alike that only ends the same way is another site.
      cookie('evil', '.evilshop.example'),
      cookie('pages', 'alice.github.io'),
    ],
    origins: [
      { origin: 'https://www.shop.example', localStorage: [{ name: 'cart', value: '1' }] },
      { origin: 'https://bank.example', localStorage: [{ name: 'token', value: 'secret' }] },
    ],
  };

  it('copies only the permitted sites, never the whole jar', () => {
    const lent = loginsFor(state, ['shop.example']);
    expect(lent.cookies.map((c) => c.name).sort()).toEqual(['shop', 'shopWww']);
    expect(lent.origins.map((o) => o.origin)).toEqual(['https://www.shop.example']);
  });

  it('copies nothing when nothing is permitted', () => {
    expect(loginsFor(state, [])).toEqual({ cookies: [], origins: [] });
  });

  it('keeps sites under a private suffix apart', () => {
    expect(loginsFor(state, ['github.io']).cookies).toEqual([]);
    expect(loginsFor(state, ['alice.github.io']).cookies.map((c) => c.name)).toEqual(['pages']);
  });

  it('keeps as many open as the memory allows, between 2 and 6', () => {
    const GiB = 1024 ** 3;
    expect(errandLimit(2 * GiB)).toBe(2);
    expect(errandLimit(8 * GiB)).toBe(4);
    expect(errandLimit(64 * GiB)).toBe(6);
  });
});

let site: Server;
let origin = '';
const homes: string[] = [];

beforeAll(async () => {
  site = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const who = url.searchParams.get('who');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      ...(who && { 'set-cookie': `who=${encodeURIComponent(who)}; Path=/; HttpOnly` }),
    });
    res.end(`<!doctype html><title>${url.pathname.slice(1) || 'home'}</title><h1>Hello</h1>`);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  site.closeAllConnections();
  await new Promise((resolve) => site.close(resolve));
  for (const home of homes)
    await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
});

async function service(options: { home?: string; errands?: number } = {}) {
  const home = options.home ?? (await mkdtemp(join(tmpdir(), 'conch-errands-')));
  if (!options.home) homes.push(home);
  const healed: string[] = [];
  const browser = new BrowserService({
    home,
    gatewayPort: 4999,
    workspace: () => Promise.resolve(home),
    emit: () => undefined,
    heal: (_area, message) => healed.push(message),
    ...(options.errands && { errands: options.errands }),
  });
  // The test site lives on this computer, which the browser avoids unless told.
  await browser.updateSettings({ allowLocal: true });
  return { browser, home, healed };
}

/** A task's turn marks its conversation; its tab opens in its own context. */
async function taskTab(browser: BrowserService, id: string, path = '/') {
  await browser.errands.mark(id, 'task');
  const tab = await browser.tabFor(id);
  await tab.page.goto(`${origin}${path}`);
  return tab;
}

const names = async (tab: {
  page: { context(): { cookies(): Promise<{ name: string; value: string }[]> } };
}) => (await tab.page.context().cookies()).map((c) => `${c.name}=${c.value}`).sort();

describe.skipIf(!hasBrowser)('a browser per errand, for real', () => {
  it(
    'gives parallel tasks their own cookies, apart from each other and the main browser',
    { timeout: 90_000 },
    async () => {
      const { browser } = await service();
      try {
        const [a, b] = await Promise.all([
          taskTab(browser, 'task_a', '/cart?who=alice'),
          taskTab(browser, 'task_b', '/cart?who=bob'),
        ]);
        const chat = await browser.tabFor('chat_main');
        await chat.page.goto(`${origin}/home`);
        expect(a.page.context()).not.toBe(b.page.context());
        expect(a.page.context()).not.toBe(chat.page.context());
        expect(await names(a)).toEqual(['who=alice']);
        expect(await names(b)).toEqual(['who=bob']);
        expect(await names(chat)).toEqual([]);
        // A new tab in a task opens in that task's browser too.
        const opened = await browser.openTab(a);
        expect(a.entry(opened ?? '')?.page.context()).toBe(a.page.context());
        expect(browser.errands.open).toBe(2);
      } finally {
        await browser.stop();
      }
    },
  );

  it(
    'lends only the sites the person allows, and takes them back when they stop',
    { timeout: 90_000 },
    async () => {
      const { browser } = await service();
      try {
        const main = await browser.runtime.context();
        await main.addCookies([
          cookie('shop', '.shop.example'),
          cookie('bank', '.bank.example'),
          cookie('mail', '.mail.example'),
        ]);
        await browser.grantSite('shop.example');
        const tab = await taskTab(browser, 'task_seed');
        expect(await names(tab)).toEqual(['shop=shop-value']);
        expect((await browser.errands.info('task_seed'))?.signedIn).toEqual(['shop.example']);
        // The person allowed bank.example in this task: its sign-in is lent, and nothing else.
        expect(browser.lendsSignIn('task_seed')).toBe(true);
        await browser.lendSignIn('task_seed', 'bank.example');
        expect(await names(tab)).toEqual(['bank=bank-value', 'shop=shop-value']);
        // Nothing comes back from the errand to the main browser.
        await tab.page.goto(`${origin}/?who=errand`);
        expect((await main.cookies()).map((c) => c.name).sort()).toEqual(['bank', 'mail', 'shop']);
        // No longer always allowed: the errand gives that sign-in back.
        await browser.revokeSite('shop.example');
        expect(await names(tab)).toEqual(['bank=bank-value', 'who=errand']);
        // A chat on the main browser never lends: it already has the person's sign-ins.
        await browser.tabFor('chat_main');
        expect(browser.lendsSignIn('chat_main')).toBe(false);
      } finally {
        await browser.stop();
      }
    },
  );

  it(
    'resumes an interrupted task in the same session, even after Conch restarts',
    { timeout: 120_000 },
    async () => {
      const first = await service();
      const tab = await taskTab(first.browser, 'task_resume', '/basket?who=carol');
      await first.browser.taskChanged({ status: 'interrupted', conversationId: 'task_resume' });
      expect(first.browser.errands.live('task_resume')).toBe(false);
      expect(tab.closed || !first.browser.tabIfOpen('task_resume')).toBe(true);
      await first.browser.stop();
      // Kept for Resume, in the errands' own (sealed, in Conch) file.
      const kept = await readFile(join(first.home, ERRANDS_FILE), 'utf8');
      expect(kept).toContain('task_resume');

      const again = await service({ home: first.home });
      try {
        const back = await again.browser.tabFor('task_resume');
        expect(again.browser.errands.live('task_resume')).toBe(true);
        expect(await names(back)).toEqual(['who=carol']);
        expect(back.page.url()).toBe(`${origin}/basket?who=carol`);
        // Done: the session goes with it.
        await again.browser.taskChanged({ status: 'done', conversationId: 'task_resume' });
        expect(again.browser.errands.live('task_resume')).toBe(false);
        expect(await again.browser.errands.reason('task_resume')).toBeUndefined();
      } finally {
        await again.browser.stop();
      }
    },
  );

  it(
    'keeps no more open than the cap: an idle one is set aside, a busy one never',
    { timeout: 120_000 },
    async () => {
      const { browser } = await service({ errands: 2 });
      try {
        await taskTab(browser, 'task_1', '/?who=one');
        await new Promise((resolve) => setTimeout(resolve, 20));
        const b = await taskTab(browser, 'task_2', '/?who=two');
        // A third: the one used longest ago, and by nobody now, is set aside to make room.
        const c = await taskTab(browser, 'task_3', '/?who=three');
        expect(browser.errands.open).toBe(2);
        expect(browser.errands.live('task_1')).toBe(false);
        expect(browser.errands.live('task_3')).toBe(true);
        // Both open ones busy: the next waits, in words a model can act on.
        b.setControl('agent');
        c.setControl('agent');
        await expect(browser.tabFor('task_1')).rejects.toThrow(/as many as this computer keeps/);
        expect(browser.errands.live('task_2')).toBe(true);
        b.setControl('idle');
        // Room again: the one set aside comes back as it was.
        const back = await browser.tabFor('task_1');
        expect(await names(back)).toEqual(['who=one']);
        expect(browser.errands.live('task_2')).toBe(false);
      } finally {
        await browser.stop();
      }
    },
  );

  it(
    'heals a crashed errand browser: it relaunches and reopens the task as it was',
    { timeout: 120_000 },
    async () => {
      const { browser, healed } = await service();
      try {
        const tab = await taskTab(browser, 'task_crash', '/checkout?who=dana');
        // What it holds is kept as it goes (a few seconds after a page loads).
        await new Promise((resolve) => setTimeout(resolve, 3_800));
        const context = tab.page.context();
        // The whole browser tasks use goes away, as in a crash.
        await context.browser()?.close();
        await expect.poll(() => browser.errands.live('task_crash')).toBe(false);
        expect(browser.tabIfOpen('task_crash')).toBeUndefined();
        const back = await browser.tabFor('task_crash');
        expect(back.page.context()).not.toBe(context);
        expect(await names(back)).toEqual(['who=dana']);
        expect(back.page.url()).toBe(`${origin}/checkout?who=dana`);
        expect(healed).toContain('Reopened a task’s browser as it was');
      } finally {
        await browser.stop();
      }
    },
  );

  it(
    'keeps a chat on the main browser unless the person gives it its own',
    { timeout: 90_000 },
    async () => {
      const { browser } = await service();
      try {
        const chat = await browser.tabFor('chat_own');
        await chat.page.goto(`${origin}/?who=main`);
        await chat.page.goto(`${origin}/home`);
        const main = chat.page.context();
        await browser.setOwn('chat_own', true);
        const own = browser.tabIfOpen('chat_own') ?? (await browser.tabFor('chat_own'));
        expect(own.page.context()).not.toBe(main);
        // Its tabs open again there, without the main browser's cookies.
        await expect.poll(() => own.page.url()).toBe(`${origin}/home`);
        expect(await names(own)).toEqual([]);
        expect((await browser.errands.info('chat_own'))?.reason).toBe('asked');
        // Back to the main one: its own is closed and forgotten.
        await browser.setOwn('chat_own', false);
        const mainAgain = browser.tabIfOpen('chat_own') ?? (await browser.tabFor('chat_own'));
        expect(mainAgain.page.context()).toBe(main);
        expect(browser.errands.open).toBe(0);
        // A task can't be moved onto the main browser.
        await browser.errands.mark('task_fixed', 'task');
        await expect(browser.setOwn('task_fixed', false)).rejects.toThrow(/always has a browser/);
      } finally {
        await browser.stop();
      }
    },
  );
});
