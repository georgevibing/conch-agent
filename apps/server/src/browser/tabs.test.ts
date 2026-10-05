import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserLiveEvent } from '@conch/protocol';
import { chromium } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { findBrowsers } from './locate';
import { SavedTabs } from './saved';
import { BrowserService } from './service';
import { fitViewport, type Watcher } from './tab';

/** Runs against a real headless browser, when this machine has one. */
const hasBrowser =
  findBrowsers({ downloaded: () => chromium.executablePath() }).length > 0 ||
  existsSync(chromium.executablePath());

// A 1×1 PNG: the test site's icon.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let site: Server;
let origin = '';
const homes: string[] = [];
const services: BrowserService[] = [];

beforeAll(async () => {
  site = createServer((req, res) => {
    if (req.url?.split('?')[0] === '/favicon.ico') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>Page ${req.url}</title><h1>${req.url}</h1>`);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const service of services.splice(0)) await service.stop().catch(() => undefined);
});

afterAll(async () => {
  site.closeAllConnections();
  await new Promise((resolve) => site.close(resolve));
  for (const home of homes)
    await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
});

async function newHome() {
  const home = await mkdtemp(join(tmpdir(), 'conch-tabs-'));
  homes.push(home);
  return home;
}

async function serviceAt(home: string) {
  const service = new BrowserService({
    home,
    gatewayPort: 1,
    workspace: () => Promise.resolve(home),
    emit: () => undefined,
  });
  services.push(service);
  // The test site lives on this computer, which the browser avoids unless told.
  await service.updateSettings({ allowLocal: true });
  return service;
}

function watcher(visible = true) {
  const events: BrowserLiveEvent[] = [];
  const w: Watcher = { visible, send: (e) => events.push(e), frame: () => undefined };
  return { w, events };
}

describe('saved tabs', () => {
  it('keeps each chat’s tabs across a restart, and forgets them on request', async () => {
    const home = await newHome();
    const saved = new SavedTabs(home);
    await saved.set('conv_a', { urls: ['https://a.example/'], active: 0, at: 1 });
    await saved.set('conv_b', { urls: ['https://b.example/'], active: 0, at: 2 });
    await saved.set('conv_b', undefined);
    await saved.flush();
    const again = new SavedTabs(home);
    expect(await again.get('conv_a')).toEqual({ urls: ['https://a.example/'], active: 0, at: 1 });
    expect(await again.get('conv_b')).toBeUndefined();
    expect(JSON.parse(await readFile(join(home, 'browser', 'tabs.json'), 'utf8'))).toMatchObject({
      version: 1,
    });
  });

  it('starts again from a damaged file, and says so', async () => {
    const home = await newHome();
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(home, 'browser'), { recursive: true });
    await writeFile(join(home, 'browser', 'tabs.json'), '{ nope');
    const healed: string[] = [];
    const saved = new SavedTabs(home, (_area, message) => healed.push(message));
    expect(await saved.get('conv_a')).toBeUndefined();
    expect(healed).toHaveLength(1);
  });
});

describe('the panel’s shape', () => {
  it('is the page’s width × height', () => {
    // A tall panel: a desktop-wide page, as tall as the panel's shape.
    expect(fitViewport({ width: 600, height: 1000 })).toEqual({ width: 960, height: 1600 });
    expect(fitViewport({ width: 900, height: 600 })).toEqual({ width: 1440, height: 960 });
  });
});

describe.skipIf(!hasBrowser)('tabs, for real', () => {
  it(
    'opens the first page in the panel’s shape, measured before there was a tab',
    { timeout: 60_000 },
    async () => {
      const service = await serviceAt(await newHome());
      const { w } = watcher();
      service.watch('conv_fit', w);
      await service.command('conv_fit', w, { type: 'fit', width: 600, height: 1000 });
      const tab = await service.tabFor('conv_fit');
      expect(tab.viewport).toEqual(fitViewport({ width: 600, height: 1000 }));
      expect(tab.page.viewportSize()).toEqual(tab.viewport);
    },
  );

  it(
    'knows back from forward, shows loading, and brings the site’s icon',
    { timeout: 60_000 },
    async () => {
      const service = await serviceAt(await newHome());
      const tab = await service.tabFor('conv_nav');
      await tab.page.goto(`${origin}/one`);
      expect((await tab.state()).canGoBack).toBe(false);
      await tab.page.goto(`${origin}/two`);
      let state = await tab.state();
      expect(state).toMatchObject({ canGoBack: true, canGoForward: false, loading: false });
      await tab.page.goBack();
      state = await tab.state();
      expect(state).toMatchObject({ canGoBack: false, canGoForward: true });
      await expect
        .poll(async () => (await tab.list())[0]?.icon, { timeout: 10_000 })
        .toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    },
  );

  it('reopens the tab closed last, and closes all but one', { timeout: 60_000 }, async () => {
    const service = await serviceAt(await newHome());
    const { w, events } = watcher();
    const tab = await service.tabFor('conv_close');
    await tab.page.goto(`${origin}/first`);
    await service.command('conv_close', w, { type: 'tab', action: 'new' });
    await tab.page.goto(`${origin}/second`);
    const second = tab.activeId ?? '';
    await service.command('conv_close', w, { type: 'tab', action: 'close', id: second });
    await expect.poll(() => tab.tabs.length).toBe(1);
    await service.command('conv_close', w, { type: 'tab', action: 'reopen' });
    await expect.poll(() => tab.page.url()).toBe(`${origin}/second`);
    expect(tab.tabs).toHaveLength(2);
    // Nothing left to reopen: nothing happens.
    await service.command('conv_close', w, { type: 'tab', action: 'reopen' });
    expect(tab.tabs).toHaveLength(2);
    await service.command('conv_close', w, {
      type: 'tab',
      action: 'others',
      id: tab.tabs[0]?.id ?? '',
    });
    await expect.poll(() => tab.tabs.length).toBe(1);
    expect(tab.page.url()).toBe(`${origin}/first`);
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
  });

  it(
    'opens a chat’s tabs again after the browser stops, and after Conch restarts',
    { timeout: 90_000 },
    async () => {
      const home = await newHome();
      const service = await serviceAt(home);
      const tab = await service.tabFor('conv_back');
      await tab.page.goto(`${origin}/a`);
      const { w } = watcher();
      await service.command('conv_back', w, { type: 'tab', action: 'new' });
      await tab.page.goto(`${origin}/b`);
      await service.command('conv_back', w, { type: 'tab', action: 'new' });
      await tab.page.goto(`${origin}/c`);
      // The middle one is in view.
      await service.command('conv_back', w, { type: 'tab', action: 'switch', id: 't2' });
      await expect
        .poll(async () => service.saved.get('conv_back'))
        .toMatchObject({ urls: [`${origin}/a`, `${origin}/b`, `${origin}/c`], active: 1 });

      // Idle: the browser closes, every page with it. The tabs are still kept…
      await service.runtime.stop();
      await new Promise((r) => setTimeout(r, 600));
      expect((await service.saved.get('conv_back'))?.urls).toHaveLength(3);
      // …and someone looking at the chat opens them again, the same one in view.
      const looking = watcher();
      service.watch('conv_back', looking.w);
      // Starting a real browser under suite load can outlast the default one-second poll.
      await expect
        .poll(() => service.tabIfOpen('conv_back')?.tabs.length, { timeout: 10_000 })
        .toBe(3);
      const again = service.tabIfOpen('conv_back');
      await expect.poll(() => again?.page.url(), { timeout: 10_000 }).toBe(`${origin}/b`);
      expect(looking.events.some((e) => e.type === 'tab' && e.tab === null && e.restoring)).toBe(
        true,
      );

      // Conch restarts: a new gateway, the same home.
      await service.stop();
      const next = await serviceAt(home);
      const restored = await next.tabFor('conv_back');
      expect(restored.tabs).toHaveLength(3);
      expect(restored.page.url()).toBe(`${origin}/b`);
      await expect
        .poll(async () => (await restored.list()).map((t) => t.url))
        .toEqual([`${origin}/a`, `${origin}/b`, `${origin}/c`]);
    },
  );

  it(
    'never reopens an address the guard refuses (a backup, local pages turned off since)',
    { timeout: 60_000 },
    async () => {
      const home = await newHome();
      const saved = new SavedTabs(home);
      await saved.set('conv_guard', {
        urls: [`${origin}/fine`, 'http://127.0.0.1:1/favicon.ico', 'http://169.254.169.254/'],
        active: 1,
        at: 1,
      });
      await saved.flush();
      // The gateway's own port (1 here) is never reachable, and neither is the cloud's metadata.
      const service = await serviceAt(home);
      const tab = await service.tabFor('conv_guard');
      expect(tab.tabs).toHaveLength(1);
      expect(tab.page.url()).toBe(`${origin}/fine`);
    },
  );

  it('forgets a deleted chat’s tabs', { timeout: 60_000 }, async () => {
    const service = await serviceAt(await newHome());
    const tab = await service.tabFor('conv_gone');
    await tab.page.goto(`${origin}/x`);
    await expect.poll(async () => service.saved.get('conv_gone')).toBeDefined();
    await service.forget('conv_gone');
    expect(await service.saved.get('conv_gone')).toBeUndefined();
  });
});
