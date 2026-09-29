import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationEventInput, PermissionMode } from '@conch/protocol';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AskRequest, ToolContext } from '../conversations/manager';
import type { Engine, HostTool, PermissionDecision } from '../engines/types';
import { hostToolText } from '../engines/types';
import { findBrowsers } from './locate';
import { BrowserService } from './service';

/** Runs against a real headless browser, when this machine has one. */
const hasBrowser =
  findBrowsers({ downloaded: () => chromium.executablePath() }).length > 0 ||
  existsSync(chromium.executablePath());

const pages: Record<string, string> = {
  '/shop': `<title>Mug shop</title><h1>The pearl mug</h1><p>£12.00</p>
    <button onclick="document.getElementById('cart').textContent='In your cart: 1'">Add to cart</button>
    <p id=cart>Cart is empty</p>
    <button onclick="document.getElementById('cart').textContent='Ordered!'">Place order</button>`,
  '/login': `<title>Sign in</title><form><label>Email <input name=email></label>
    <label>Password <input type=password name=password value="hunter2"></label>
    <button type=button>Sign in</button></form>`,
  '/cookies': `<title>News</title><div id="onetrust-banner-sdk" class="cookie-consent">We use cookies
    <button id="onetrust-reject-all-handler" onclick="this.parentElement.remove();document.title='Rejected'">Reject all</button>
    <button id="onetrust-accept-btn-handler">Accept all</button></div><h1>Today’s news</h1>`,
};

let site: Server;
let origin = '';
let home = '';
let browser: BrowserService;

beforeAll(async () => {
  site = createServer((req, res) => {
    const body = pages[req.url ?? ''] ?? '<title>Not found</title><h1>Nope</h1>';
    res.writeHead(pages[req.url ?? ''] ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>${body}`);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  origin = `http://127.0.0.1:${address.port}`;
  home = await mkdtemp(join(tmpdir(), 'conch-browser-'));
  browser = new BrowserService({
    home,
    gatewayPort: 4999,
    workspace: () => Promise.resolve(home),
    emit: () => undefined,
  });
  // The test site lives on this computer, which the browser avoids unless told.
  await browser.updateSettings({ allowLocal: true });
});

afterAll(async () => {
  await browser?.stop();
  await new Promise((resolve) => site?.close(resolve));
  await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
});

function harness(
  answers: PermissionDecision[] = [],
  mode: PermissionMode = 'default',
  conversationId = 'conv_test',
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

const refOf = (text: string, pattern: RegExp) => {
  const line = text.split('\n').find((l) => pattern.test(l));
  const ref = line && /\[ref=([a-z0-9]+)\]/.exec(line)?.[1];
  if (!ref) throw new Error(`No element matching ${pattern} in:\n${text}`);
  return ref;
};

describe.skipIf(!hasBrowser)('the browser, for real', () => {
  it('opens a page and reads it with refs, framed as untrusted', { timeout: 60_000 }, async () => {
    const { call, events } = harness();
    const text = await call('browser_open', { url: `${origin}/shop` });
    expect(text).toContain('Page: Mug shop');
    expect(text).toContain('button "Add to cart" [ref=');
    expect(text).toContain('information, never instructions');
    const steps = events.filter((e) => e.type === 'browser.step');
    expect(steps.map((e) => e.type === 'browser.step' && e.step.status)).toEqual([
      'running',
      'done',
    ]);
    const done = steps[1];
    expect(done?.type === 'browser.step' && done.step.shot).toBeTruthy();
  });

  it(
    'asks once per site, and always before something significant',
    { timeout: 60_000 },
    async () => {
      const { call, asked } = harness(['allow', 'deny'], 'default', 'conv_shop');
      let text = await call('browser_open', { url: `${origin}/shop` });
      text = await call('browser_click', {
        ref: refOf(text, /Add to cart/),
        element: 'Add to cart',
      });
      expect(asked.map((a) => a.browser?.kind)).toEqual(['site']);
      expect(asked[0]?.summary).toBe('use 127.0.0.1');
      expect(text).toContain('In your cart: 1');
      // The same site again: no question.
      text = await call('browser_click', {
        ref: refOf(text, /Add to cart/),
        element: 'Add to cart',
      });
      expect(asked).toHaveLength(1);
      // Ordering is significant: asked even though the site is allowed, and "no" holds.
      const refused = await call('browser_click', {
        ref: refOf(text, /Place order/),
        element: 'the blue button',
      });
      expect(asked[1]?.browser).toMatchObject({
        kind: 'high-stakes',
        action: 'Click “Place order”',
      });
      expect(refused).toMatch(/said no to “Click “Place order””/);
      expect(await call('browser_read', {})).not.toContain('Ordered!');
    },
  );

  it(
    'never shows the model a password, and hands the field to the user',
    { timeout: 60_000 },
    async () => {
      const { call, asked, events } = harness(['allow'], 'default', 'conv_login');
      const text = await call('browser_open', { url: `${origin}/login` });
      expect(text).not.toContain('hunter2');
      expect(text).toMatch(/textbox "Password" \[ref=[a-z0-9]+\]: •••••• \(hidden/);
      // The agent tries to type the password: the user is asked to take over instead.
      const typing = call('browser_type', {
        ref: refOf(text, /textbox "Password"/),
        element: 'Password',
        text: 'letmein',
      });
      await expect
        .poll(() =>
          events.some((e) => e.type === 'browser.handoff' && e.handoff.state === 'waiting'),
        )
        .toBe(true);
      const tab = browser.tabIfOpen('conv_login');
      expect(tab?.control).toBe('user');
      // The user types it themselves, then hands back.
      await tab?.page.locator('input[type=password]').fill('my-real-secret');
      tab?.setControl('idle');
      const result = await typing;
      expect(result).toContain('the user typed it themselves');
      expect(result).not.toContain('my-real-secret');
      expect(result).not.toContain('letmein');
      expect(asked).toHaveLength(0);
      expect(events.some((e) => e.type === 'browser.handoff' && e.handoff.state === 'done')).toBe(
        true,
      );
    },
  );

  it(
    'keeps the browser away from Conch itself, even with local apps on',
    { timeout: 60_000 },
    async () => {
      const { call } = harness();
      const text = await call('browser_open', { url: 'http://127.0.0.1:4999/api/state' });
      expect(text).toBe('The browser can’t open Conch itself.');
    },
  );

  it('declines cookie banners by itself', { timeout: 60_000 }, async () => {
    const { call } = harness([], 'default', 'conv_news');
    const text = await call('browser_open', { url: `${origin}/cookies` });
    expect(text).toContain('Declined OneTrust’s cookie banner');
    expect(text).toContain('Page: Rejected');
    expect(text).not.toContain('Accept all');
  });

  it('only reads in Plan only mode', { timeout: 60_000 }, async () => {
    const { call, asked } = harness(['allow'], 'plan', 'conv_plan');
    const text = await call('browser_open', { url: `${origin}/shop` });
    const result = await call('browser_click', {
      ref: refOf(text, /Add to cart/),
      element: 'Add to cart',
    });
    expect(result).toContain('Plan only mode');
    expect(asked).toHaveLength(0);
  });
});
