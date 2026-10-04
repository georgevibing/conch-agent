import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { MAX_TABS } from './tab';

/**
 * Everything a person does with a browser, done by the agent for real:
 * tabs, hovering, dragging, double and right clicks, shortcuts, scrolling
 * inside a list, clicking by position, uploading files, and a sign-in that
 * carries on by itself. Runs against a real headless browser when there is one.
 */
const hasBrowser =
  findBrowsers({ downloaded: () => chromium.executablePath() }).length > 0 ||
  existsSync(chromium.executablePath());

const pages: Record<string, string> = {
  '/links': `<title>Links</title><h1>Links</h1>
    <a href="/shop" target="_blank">Open the shop</a>
    <button onclick="window.open('/login','signin','width=400,height=500')">Sign in with a popup</button>`,
  '/shop': `<title>Mug shop</title><h1>The pearl mug</h1><button onclick="document.title='Ordered'">Place order</button>`,
  '/login': `<title>Sign in</title><form action="/welcome" method="post">
    <label>Email <input name="email"></label>
    <label>Password <input type="password" name="password"></label>
    <button>Sign in</button></form>`,
  '/welcome': `<title>Welcome</title><h1>Welcome back</h1>`,
  '/hands': `<title>Hands</title>
    <nav><span id="m" role="button" tabindex="0" onmouseenter="document.getElementById('sub').hidden=false">Products</span>
    <div id="sub" hidden><a href="/shop">Mugs</a></div></nav>
    <p ondblclick="this.textContent='Double!'">Twice</p>
    <div role="button" tabindex="0" oncontextmenu="event.preventDefault();this.textContent='Right!'">Right here</div>
    <div id="card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','card')">Card</div>
    <div id="bin" role="region" aria-label="Bin" style="width:120px;height:60px;border:1px solid"
      ondragover="event.preventDefault()" ondrop="event.preventDefault();this.textContent='Dropped!'">Bin</div>
    <input aria-label="Notes" onkeydown="if(event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==='k'){this.value='chord!';event.preventDefault()}">
    <div role="list" aria-label="Results" style="height:120px;overflow:auto">
      <div role="listitem">First item</div><div style="height:1200px"></div><div role="listitem">Last item</div>
    </div>`,
  '/canvas': `<title>Canvas</title><style>body{margin:0}</style>
    <canvas width="400" height="300" style="display:block;background:#eee"
      onclick="document.title='Canvas '+event.offsetX+','+event.offsetY"></canvas>
    <button style="position:absolute;left:500px;top:20px;width:140px;height:40px" onclick="document.title='Ordered'">Place order</button>
    <input type="password" aria-label="Password" style="position:absolute;left:500px;top:120px;width:160px;height:30px">
    <input aria-label="Name" style="position:absolute;left:500px;top:200px;width:160px;height:30px" value="old">`,
  '/upload': `<title>Upload</title>
    <label>CV <input type="file" id="cv" onchange="document.title='Picked '+[...this.files].map(f=>f.name).join(',')"></label>
    <button onclick="document.getElementById('hidden').click()">Upload a photo</button>
    <input type="file" id="hidden" style="display:none" onchange="document.title='Photo '+this.files[0].name+' '+this.files[0].size">`,
};

let site: Server;
let origin = '';
let home = '';
let work = '';
let browser: BrowserService;

beforeAll(async () => {
  site = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    const body = pages[path] ?? '<title>Not found</title><h1>Nope</h1>';
    res.writeHead(pages[path] ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>${body}`);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  origin = `http://127.0.0.1:${address.port}`;
  home = await mkdtemp(join(tmpdir(), 'conch-actions-'));
  work = join(home, 'workspace');
  await mkdir(work, { recursive: true });
  await writeFile(join(work, 'cv.pdf'), '%PDF-1.4 my cv');
  await writeFile(join(work, '.env'), 'KEY=nope');
  await writeFile(join(home, 'secrets.json'), '{"key":"sealed"}');
  browser = new BrowserService({
    home,
    gatewayPort: 4999,
    workspace: () => Promise.resolve(work),
    emit: () => undefined,
    uploads: {
      home,
      forbidden: [join(home, 'secrets.json')],
      attachments: () =>
        Promise.resolve([
          {
            id: 'att_1',
            name: 'holiday.jpg',
            mimeType: 'image/jpeg',
            read: () => Promise.resolve(Buffer.from('a holiday photo')),
          },
        ]),
      made: () => Promise.resolve([]),
    },
  });
  await browser.updateSettings({ allowLocal: true });
});

afterAll(async () => {
  await browser?.stop();
  site?.closeAllConnections();
  await new Promise((resolve) => site?.close(resolve));
  await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
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
    workspace: () => Promise.resolve(work),
  };
  const tools = new Map(browser.tools(ctx).map((t) => [t.name, t]));
  const call = async (name: string, args: Record<string, unknown>) =>
    hostToolText(await (tools.get(name) as HostTool).run(args as never));
  const tab = () => browser.tabIfOpen(conversationId);
  return { call, asked, events, tab };
}

const refOf = (text: string, pattern: RegExp) => {
  const line = text.split('\n').find((l) => pattern.test(l));
  const ref = line && /\[ref=([a-z0-9]+)\]/.exec(line)?.[1];
  if (!ref) throw new Error(`No element matching ${pattern} in:\n${text}`);
  return ref;
};

describe.skipIf(!hasBrowser)('tabs, for real', () => {
  it(
    'a link to a new tab becomes a tab the agent hears about, and it can switch and close',
    { timeout: 90_000 },
    async () => {
      const { call, tab } = harness('conv_tabs', ['allow']);
      let text = await call('browser_open', { url: `${origin}/links` });
      text = await call('browser_click', {
        ref: refOf(text, /Open the shop/),
        element: 'Open the shop',
      });
      expect(text).toContain('That opened a new tab, t2, which is in view now');
      expect(text).toContain('Tabs: t1: Links · t2 (in view): Mug shop');
      expect(text).toContain('Page: Mug shop');
      expect(tab()?.tabs.map((t) => t.id)).toEqual(['t1', 't2']);

      text = await call('browser_tabs', { action: 'switch', tab: 't1' });
      expect(text).toContain('Page: Links');
      expect((await tab()?.state())?.tabs).toEqual([
        expect.objectContaining({ id: 't1', active: true, title: 'Links' }),
        expect.objectContaining({ id: 't2', active: false, title: 'Mug shop' }),
      ]);

      text = await call('browser_tabs', { action: 'open', url: `${origin}/hands` });
      expect(text).toContain('Opened tab t3');
      expect(text).toContain('Page: Hands');
      text = await call('browser_tabs', { action: 'list' });
      expect(text).toMatch(/t3 \(in view\): Hands/);

      text = await call('browser_tabs', { action: 'close', tab: 't3' });
      expect(text).toContain('Closed t3');
      // Back to the tab it was opened from.
      expect(text).toContain('Page: Links');
      expect(await call('browser_tabs', { action: 'switch', tab: 't9' })).toMatch(
        /There’s no tab t9/,
      );
      await call('browser_tabs', { action: 'close', tab: 't2' });
      expect(await call('browser_tabs', { action: 'close', tab: 't1' })).toMatch(/only tab/);
    },
  );

  it('a sign-in popup is a tab, and closing it comes back', { timeout: 90_000 }, async () => {
    const { call, tab } = harness('conv_popup', ['allow']);
    let text = await call('browser_open', { url: `${origin}/links` });
    text = await call('browser_click', {
      ref: refOf(text, /Sign in with a popup/),
      element: 'Sign in with a popup',
    });
    expect(text).toContain('That opened a new tab, t2');
    expect(text).toContain('Page: Sign in');
    await tab()?.page.close();
    await expect.poll(() => tab()?.current?.url()).toBe(`${origin}/links`);
  });

  it(`keeps at most ${MAX_TABS} tabs`, { timeout: 120_000 }, async () => {
    const { call, tab } = harness('conv_many');
    await call('browser_open', { url: `${origin}/shop` });
    for (let i = 1; i < MAX_TABS; i++) await call('browser_tabs', { action: 'open' });
    expect(tab()?.tabs).toHaveLength(MAX_TABS);
    expect(await call('browser_tabs', { action: 'open' })).toMatch(
      new RegExp(`already has ${MAX_TABS} tabs`),
    );
  });
});

describe.skipIf(!hasBrowser)('a person’s hands, for real', () => {
  it(
    'hovers, double-clicks, right-clicks, drags and presses shortcuts',
    { timeout: 90_000 },
    async () => {
      const { call, asked } = harness('conv_hands', ['allow']);
      let text = await call('browser_open', { url: `${origin}/hands` });
      expect(text).not.toContain('Mugs');
      // Pointing at something asks nothing.
      text = await call('browser_click', {
        ref: refOf(text, /Products/),
        element: 'Products',
        how: 'hover',
      });
      expect(text).toContain('link "Mugs"');
      expect(asked).toHaveLength(0);

      text = await call('browser_click', {
        ref: refOf(text, /Twice/),
        element: 'Twice',
        how: 'double',
      });
      expect(text).toContain('Double!');
      expect(asked.map((a) => a.browser?.action)).toEqual(['Double-click “Twice”']);

      text = await call('browser_click', {
        ref: refOf(text, /Right here/),
        element: 'Right here',
        how: 'right',
      });
      expect(text).toContain('Right!');

      text = await call('browser_click', {
        ref: refOf(text, /Card/),
        element: 'Card',
        how: 'drag',
        to: refOf(text, /region "Bin"/),
      });
      expect(text).toContain('Dropped!');
      expect(
        await call('browser_click', {
          ref: refOf(text, /Twice|Double/),
          element: 'x',
          how: 'drag',
        }),
      ).toMatch(/say where to drop/);

      text = await call('browser_press', {
        key: 'Control+Shift+K',
        ref: refOf(text, /textbox "Notes"/),
      });
      expect(text).toMatch(/textbox "Notes".*\[ref=[a-z0-9]+\]: chord!/);
    },
  );

  it('scrolls inside a list, and brings an item into view', { timeout: 60_000 }, async () => {
    const { call, tab } = harness('conv_scroll', ['allow']);
    const text = await call('browser_open', { url: `${origin}/hands` });
    const list = refOf(text, /list "Results"/);
    const top = () =>
      tab()?.page.evaluate(
        'document.querySelector("[aria-label=Results]").scrollTop',
      ) as Promise<number>;
    await call('browser_scroll', { ref: list, direction: 'down' });
    expect(await top()).toBeGreaterThan(50);
    await call('browser_scroll', { ref: list, direction: 'up' });
    expect(await top()).toBe(0);
    await call('browser_scroll', { ref: refOf(text, /Last item/) });
    expect(await top()).toBeGreaterThan(1000);
    expect(await call('browser_scroll', {})).toMatch(/Say which way/);
  });
});

describe.skipIf(!hasBrowser)('clicking by position, for real', () => {
  it(
    'clicks a canvas where the screenshot says, scaled to the page as it is now',
    { timeout: 60_000 },
    async () => {
      const { call, tab } = harness('conv_canvas', ['allow']);
      await call('browser_open', { url: `${origin}/canvas` });
      const shot = await call('browser_screenshot', {});
      const size = /(\d+)×(\d+) pixels/.exec(shot);
      expect(size).toBeTruthy();
      await call('browser_click_at', { x: 100, y: 50, element: 'the canvas' });
      expect(await tab()?.page.title()).toBe('Canvas 100,50');
      // The panel changed the page's shape since the screenshot: the point follows.
      const t = tab();
      if (!t) throw new Error('no tab');
      t.shotViewport = { width: t.viewport.width * 2, height: t.viewport.height * 2 };
      await call('browser_click_at', { x: 200, y: 100, element: 'the canvas' });
      expect(await t.page.title()).toBe('Canvas 100,50');
      t.shotViewport = undefined;
      expect(await call('browser_click_at', { x: 99_99, y: 5, element: 'far away' })).toMatch(
        /outside the page/,
      );
    },
  );

  it(
    'asks before anything significant by position too, and never types a secret',
    { timeout: 60_000 },
    async () => {
      const { call, asked, events, tab } = harness('conv_canvas_safe', ['allow', 'deny']);
      await call('browser_open', { url: `${origin}/canvas` });
      await call('browser_screenshot', {});
      // The site, then “Place order”, read from the page itself, not the agent's words.
      await call('browser_click_at', { x: 300, y: 250, element: 'empty space' });
      const refused = await call('browser_click_at', { x: 560, y: 40, element: 'a button' });
      expect(asked[1]?.browser).toMatchObject({
        kind: 'high-stakes',
        action: 'Click “Place order”',
      });
      expect(refused).toMatch(/said no/);
      expect(await tab()?.page.title()).not.toBe('Ordered');

      // Typing by position into a password field hands it to the user.
      const typing = call('browser_click_at', {
        x: 560,
        y: 135,
        element: 'Password',
        text: 'letmein',
      });
      await expect
        .poll(() =>
          events.some((e) => e.type === 'browser.handoff' && e.handoff.state === 'waiting'),
        )
        .toBe(true);
      tab()?.setControl('idle');
      const result = await typing;
      expect(result).toContain('the user typed it themselves');
      expect(await tab()?.page.locator('input[type=password]').inputValue()).toBe('');

      // A plain field: replaced, like browser_type.
      await call('browser_click_at', { x: 560, y: 215, element: 'Name', text: 'Ada' });
      expect(await tab()?.page.locator('input[aria-label=Name]').inputValue()).toBe('Ada');
    },
  );

  it('only reads in Plan only mode, by position too', { timeout: 60_000 }, async () => {
    const { call, asked } = harness('conv_canvas_plan', [], 'plan');
    await call('browser_open', { url: `${origin}/canvas` });
    expect(await call('browser_click_at', { x: 100, y: 50, element: 'canvas' })).toContain(
      'Plan only mode',
    );
    expect(asked).toHaveLength(0);
  });
});

describe.skipIf(!hasBrowser)('uploading, for real', () => {
  it(
    'puts an attached file into a file box, after asking every time',
    { timeout: 60_000 },
    async () => {
      const { call, asked, tab } = harness('conv_upload', ['allow', 'allow', 'allow']);
      const text = await call('browser_open', { url: `${origin}/upload` });
      const cv = refOf(text, /button "CV"|"CV"/);
      const result = await call('browser_upload', {
        ref: cv,
        element: 'CV',
        files: ['cv.pdf'],
      });
      expect(asked.at(-1)?.browser).toMatchObject({
        kind: 'upload',
        action: 'Upload “cv.pdf” (cv.pdf)',
      });
      expect(result).toContain('Put “cv.pdf” into “CV”');
      expect(await tab()?.page.title()).toBe('Picked cv.pdf');

      // A button that opens the file picker: the picker is answered.
      const asking = asked.length;
      await call('browser_upload', {
        ref: refOf(text, /Upload a photo/),
        element: 'Upload a photo',
        files: ['holiday.jpg'],
      });
      expect(asked.length).toBe(asking + 1);
      expect(await tab()?.page.title()).toBe('Photo holiday.jpg 15');
    },
  );

  it('refuses what isn’t the chat’s to send, and “no” holds', { timeout: 60_000 }, async () => {
    const { call, asked, tab } = harness('conv_upload_no', ['deny']);
    const text = await call('browser_open', { url: `${origin}/upload` });
    const cv = refOf(text, /"CV"/);
    for (const bad of ['../secrets.json', '.env', join(home, 'secrets.json')]) {
      const result = await call('browser_upload', { ref: cv, element: 'CV', files: [bad] });
      expect(result, bad).toMatch(/isn’t in the work folder|hidden file|Conch’s own/);
    }
    expect(asked).toHaveLength(0);
    // "No" to the upload sends nothing.
    await call('browser_click', { ref: refOf(text, /Upload a photo/), element: 'x', how: 'hover' });
    const no = await call('browser_upload', { ref: cv, element: 'CV', files: ['cv.pdf'] });
    expect(no).toMatch(/said no/);
    expect(await tab()?.page.title()).toBe('Upload');
  });

  it('asks about an upload even in Full trust', { timeout: 60_000 }, async () => {
    const { call, asked } = harness('conv_upload_trust', ['allow'], 'bypassPermissions');
    const text = await call('browser_open', { url: `${origin}/upload` });
    await call('browser_upload', { ref: refOf(text, /"CV"/), element: 'CV', files: ['cv.pdf'] });
    expect(asked.map((a) => a.browser?.kind)).toEqual(['upload']);
  });
});

describe.skipIf(!hasBrowser)('your turn, for real', () => {
  it(
    'carries on by itself once you’re signed in, and not while you type',
    { timeout: 90_000 },
    async () => {
      const { call, events, tab } = harness('conv_auto');
      await call('browser_open', { url: `${origin}/login` });
      const waiting = call('browser_handoff', { reason: 'Sign in to the test site' });
      await expect
        .poll(() =>
          events.some((e) => e.type === 'browser.handoff' && e.handoff.state === 'waiting'),
        )
        .toBe(true);
      const t = tab();
      if (!t) throw new Error('no tab');
      expect(t.control).toBe('user');
      // You type, and submit: the page moves on with no password field.
      t.lastInput = Date.now();
      await t.page.locator('input[name=email]').fill('ada@example.com');
      await t.page.locator('input[type=password]').fill('pearl-secret');
      await t.page.locator('button').click();
      t.lastInput = Date.now();
      const result = await waiting;
      expect(result).toContain('Conch saw the sign-in or check go through');
      expect(result).toContain('Page: Welcome');
      expect(result).not.toContain('pearl-secret');
      const done = events.findLast((e) => e.type === 'browser.handoff');
      expect(done?.type === 'browser.handoff' && done.handoff).toMatchObject({
        state: 'done',
        auto: true,
      });
    },
  );

  it(
    'waits for “I’m done” when it isn’t a sign-in (your details, a payment)',
    { timeout: 60_000 },
    async () => {
      const { call, events, tab } = harness('conv_manual');
      await call('browser_open', { url: `${origin}/shop` });
      const waiting = call('browser_handoff', { reason: 'Choose your seat' });
      await expect
        .poll(() =>
          events.some((e) => e.type === 'browser.handoff' && e.handoff.state === 'waiting'),
        )
        .toBe(true);
      const t = tab();
      if (!t) throw new Error('no tab');
      await t.page.goto(`${origin}/welcome`);
      t.lastInput = 0;
      await new Promise((r) => setTimeout(r, 3_500));
      expect(t.control).toBe('user');
      t.setControl('idle');
      expect(await waiting).toContain('The user is done');
    },
  );
});
