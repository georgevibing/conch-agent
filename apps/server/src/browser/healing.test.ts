import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { BrowserGuard } from './guard';
import { findBrowsers } from './locate';
import { blockedPage } from './pages';
import { BrowserRuntime } from './runtime';
import { BrowserService } from './service';
import { BrowserStore } from './store';

/**
 * Working agreement 11: every self-repair gets a test. These run a real
 * browser, when this machine has one.
 */
const found = findBrowsers({ downloaded: () => chromium.executablePath() });
// Placeholder when nothing is installed: the tests below skip then.
const real = found[0] ?? { id: 'chrome' as const, name: 'none', path: '' };

let site: Server;
let origin = '';
const homes: string[] = [];

beforeAll(async () => {
  site = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Page ${req.url}</title><h1>${req.url}</h1>`);
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

async function newHome() {
  const home = await mkdtemp(join(tmpdir(), 'conch-heal-'));
  homes.push(home);
  return home;
}

function runtimeFor(store: BrowserStore, locate: () => typeof found) {
  return new BrowserRuntime({
    store,
    guard: new BrowserGuard(() => ({ allowLocal: true, gatewayPort: 1 })),
    onChange: () => undefined,
    onClosed: () => undefined,
    blockedPage,
    locate,
  });
}

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

describe.skipIf(found.length === 0)('the browser heals itself', () => {
  it('falls back to the next browser when one won’t start', { timeout: 90_000 }, async () => {
    const store = new BrowserStore(await newHome());
    const broken = {
      id: 'chrome' as const,
      name: 'Broken Chrome',
      path: join(tmpdir(), 'no-such-browser.exe'),
    };
    const runtime = runtimeFor(store, () => [broken, { ...real, id: 'edge' as const }]);
    stop = () => runtime.stop();
    const context = await runtime.context();
    expect(context.pages().length).toBeGreaterThanOrEqual(0);
    expect(runtime.phase).toBe('running');
    expect(runtime.running?.name).toBe(real.name);
    expect(runtime.healed[0]?.message).toBe(
      `Broken Chrome wouldn’t start, so Conch is using ${real.name}.`,
    );
  });

  it('clears a profile a leftover browser is still holding', { timeout: 90_000 }, async () => {
    const store = new BrowserStore(await newHome());
    // A browser from "an earlier session" that never quit, still on Conch's profile.
    const leftover = await chromium.launchPersistentContext(store.profileDir, {
      executablePath: real.path,
      headless: true,
    });
    const runtime = runtimeFor(store, () => [real]);
    stop = async () => {
      await runtime.stop();
      await leftover.close().catch(() => undefined);
    };
    await runtime.context();
    expect(runtime.phase).toBe('running');
    expect(runtime.healed[0]?.message).toBe(
      'A browser left over from an earlier session was holding things up; Conch closed it.',
    );
  });

  it('comes back after a crash and reopens the chat’s page', { timeout: 90_000 }, async () => {
    const home = await newHome();
    const service = new BrowserService({
      home,
      gatewayPort: 1,
      workspace: () => Promise.resolve(home),
      emit: () => undefined,
    });
    await service.updateSettings({ allowLocal: true });
    stop = () => service.stop();
    const tab = await service.tabFor('conv_crash');
    await tab.page.goto(`${origin}/where-i-was`);
    // The browser dies under us.
    await tab.page.context().close();
    await expect.poll(() => service.runtime.alive).toBe(false);
    expect(service.runtime.healed[0]?.message).toMatch(/closed unexpectedly/);
    // The next use starts it again, on the same page.
    const back = await service.tabFor('conv_crash');
    expect(back.page.url()).toBe(`${origin}/where-i-was`);
    expect(service.runtime.phase).toBe('running');
  });
});
