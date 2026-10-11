import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserLiveEvent, ConversationEventInput, PermissionMode } from '@conch/protocol';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AskRequest, ToolContext } from '../conversations/manager';
import type { Engine, HostTool, PermissionDecision } from '../engines/types';
import { hostToolText } from '../engines/types';
import { findBrowsers } from './locate';
import { BrowserService } from './service';
import { pageParts } from './snapshot';
import type { Watcher } from './tab';

/**
 * Everyday browsing, for real (ADR 0131): the page's own dialogs, a form in one
 * step, a page too long for one read, a site that checks for bots first, and
 * find on page. Runs against a real headless browser when there is one.
 */
const hasBrowser =
  findBrowsers({ downloaded: () => chromium.executablePath() }).length > 0 ||
  existsSync(chromium.executablePath());

const longList = Array.from(
  { length: 1500 },
  (_, i) => `<li>Item number ${i + 1} of the very long list</li>`,
).join('');

const pages: Record<string, { status?: number; body: string }> = {
  '/basket': {
    body: `<title>Basket</title><h1>Your basket</h1>
    <button onclick="document.title = confirm('Remove the mug from your basket?') ? 'Removed' : 'Kept'">Remove</button>
    <button onclick="document.title = confirm('Are you sure you want to delete your account?') ? 'Deleted' : 'Not deleted'">Close my account</button>
    <button onclick="if (confirm('Delete 3 items?')) document.title = 'Gone'">Delete</button>
    <button onclick="alert('Saved for later'); document.title = 'Saved'">Save for later</button>
    <button onclick="document.title = 'Named ' + prompt('Name your list', 'Mine')">Name the list</button>`,
  },
  '/form': {
    body: `<title>Form</title><form onsubmit="event.preventDefault()">
    <label>Full name <input name="name"></label>
    <label>Email <input type="email" name="email"></label>
    <label>Password <input type="password" name="password"></label>
    <label>Country <select name="country"><option>France</option><option>Portugal</option></select></label>
    <label><input type="checkbox" name="news"> Send me news</label>
    <label>Notes <textarea name="notes"></textarea></label>
    <label>CV <input type="file" name="cv"></label>
    <button>Apply</button></form>`,
  },
  '/long': { body: `<title>Long</title><h1>A long list</h1><ul>${longList}</ul>` },
  '/check': {
    status: 503,
    body: `<title>Just a moment...</title><div id="challenge-running">Checking if the site connection is secure</div>
    <script>setTimeout(() => { location.href = '/welcome' }, 1500)</script>`,
  },
  '/stuck': {
    status: 403,
    body: `<title>Just a moment...</title><div id="challenge-running">Verify you are human</div>`,
  },
  '/blocked': { status: 403, body: `<title>Access denied</title><h1>Access denied</h1>` },
  '/welcome': { body: `<title>Welcome</title><h1>Welcome to the shop</h1>` },
  '/article': {
    body: `<title>Article</title><p>The pearl is a gem.</p><div style="height:2400px"></div>
    <p>Another pearl, far down.</p><p>And a third pearl.</p>`,
  },
};

let site: Server;
let origin = '';
let home = '';
let browser: BrowserService;

beforeAll(async () => {
  site = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    const page = pages[path] ?? { status: 404, body: '<title>Not found</title>' };
    res.writeHead(page.status ?? 200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>${page.body}`);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  origin = `http://127.0.0.1:${address.port}`;
  home = await mkdtemp(join(tmpdir(), 'conch-everyday-'));
  await mkdir(join(home, 'workspace'), { recursive: true });
  browser = new BrowserService({
    home,
    gatewayPort: 4999,
    workspace: () => Promise.resolve(join(home, 'workspace')),
    emit: () => undefined,
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

/** Someone watching the panel, keeping what the live view tells them. */
function watcher(): Watcher & { events: BrowserLiveEvent[] } {
  const events: BrowserLiveEvent[] = [];
  return { visible: true, events, send: (event) => events.push(event), frame: () => undefined };
}

describe('long pages in parts', () => {
  it('cuts between lines, each part within the limit, nothing lost', () => {
    const body = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const parts = pageParts(body, 60);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(60);
    expect(parts.join('\n')).toBe(body);
  });

  it('cuts a line longer than a part where it is', () => {
    const parts = pageParts('x'.repeat(130), 60);
    expect(parts).toHaveLength(3);
    expect(parts.join('')).toBe('x'.repeat(130));
  });
});

describe.skipIf(!hasBrowser)('the page’s own dialogs, for real', () => {
  it(
    'an everyday question is answered OK and told; a message is closed and told',
    { timeout: 90_000 },
    async () => {
      const { call, asked, tab } = harness('conv_dialog_ok', ['allow']);
      const page = await call('browser_open', { url: `${origin}/basket` });
      let text = await call('browser_click', { ref: refOf(page, /"Remove"/), element: 'Remove' });
      // The site question, once; "Remove the mug?" isn't significant, so nothing more.
      expect(asked.map((a) => a.browser?.kind)).toEqual(['site']);
      expect(text).toContain(
        'The page asked “Remove the mug from your basket?”, and Conch answered OK.',
      );
      expect(await tab()?.page.title()).toBe('Removed');

      text = await call('browser_click', {
        ref: refOf(page, /Save for later/),
        element: 'Save for later',
      });
      expect(text).toContain('The page showed a message: “Saved for later”. Conch closed it.');
      expect(await tab()?.page.title()).toBe('Saved');
    },
  );

  it(
    'a significant question asks the person, after the click took longer than its own wait',
    { timeout: 90_000 },
    async () => {
      // A person takes their time: the click waits behind the page's question meanwhile.
      const answers: PermissionDecision[] = ['allow'];
      const asked: AskRequest[] = [];
      const ctx: ToolContext = {
        conversationId: 'conv_dialog_ask',
        append: () => undefined,
        engine: { hostTools: true } as unknown as Engine,
        permissionMode: 'default',
        ask: async (request) => {
          asked.push(request);
          if (request.browser?.kind === 'high-stakes')
            await new Promise((r) => setTimeout(r, 7_500));
          return answers.shift() ?? 'allow';
        },
        signal: new AbortController().signal,
      };
      const tools = new Map(browser.tools(ctx).map((t) => [t.name, t]));
      const call = async (name: string, args: Record<string, unknown>) =>
        hostToolText(await (tools.get(name) as HostTool).run(args as never));
      const page = await call('browser_open', { url: `${origin}/basket` });
      const text = await call('browser_click', {
        ref: refOf(page, /Close my account/),
        element: 'Close my account',
      });
      expect(asked.map((a) => a.browser?.kind)).toEqual(['site', 'high-stakes']);
      expect(asked[1]?.browser?.action).toBe(
        'Say OK to “Are you sure you want to delete your account?”',
      );
      // No picture of a frozen page.
      expect(asked[1]?.browser?.shot).toBeUndefined();
      expect(text).toContain('and Conch answered OK');
      expect(await browser.tabIfOpen('conv_dialog_ask')?.page.title()).toBe('Deleted');
    },
  );

  it(
    'the person says no: Cancel, and the agent is told not to find another way',
    {
      timeout: 90_000,
    },
    async () => {
      const { call, asked, tab } = harness('conv_dialog_no', ['allow', 'deny']);
      const page = await call('browser_open', { url: `${origin}/basket` });
      const text = await call('browser_click', {
        ref: refOf(page, /Close my account/),
        element: 'Close my account',
      });
      expect(asked).toHaveLength(2);
      expect(text).toContain('The user said no, so Conch answered Cancel');
      expect(await tab()?.page.title()).toBe('Not deleted');
    },
  );

  it(
    'a yes to “Delete” covers the site’s own “Delete 3 items?” after it',
    {
      timeout: 90_000,
    },
    async () => {
      const { call, asked, tab } = harness('conv_dialog_vouched', ['allow', 'allow']);
      const page = await call('browser_open', { url: `${origin}/basket` });
      await call('browser_click', { ref: refOf(page, /"Delete"/), element: 'Delete' });
      // The click on Delete asks (that covers the site too); the dialog after it doesn't ask again.
      expect(asked.map((a) => a.browser?.kind)).toEqual(['high-stakes']);
      expect(await tab()?.page.title()).toBe('Gone');
    },
  );

  it(
    'a text box of the page’s own gets Cancel, and the agent hears why',
    {
      timeout: 90_000,
    },
    async () => {
      const { call, tab } = harness('conv_dialog_prompt', ['allow']);
      const page = await call('browser_open', { url: `${origin}/basket` });
      const text = await call('browser_click', {
        ref: refOf(page, /Name the list/),
        element: 'Name the list',
      });
      expect(text).toContain('Conch can’t type there, so it answered Cancel');
      expect(await tab()?.page.title()).toBe('Named null');
    },
  );

  it('in Read only mode a question gets Cancel', { timeout: 90_000 }, async () => {
    const { call, tab } = harness('conv_dialog_plan', [], 'plan');
    await call('browser_open', { url: `${origin}/basket` });
    const page = tab()?.page;
    // Nothing the agent may click; the page asks by itself while the agent reads.
    await page?.evaluate(
      `setTimeout(() => { document.title = confirm('Remove all?') ? 'yes' : 'no' }, 50)`,
    );
    const text = await call('browser_wait', { seconds: 1 });
    expect(text).toContain('Read only mode, so Conch answered Cancel');
    expect(await page?.title()).toBe('no');
  });

  it(
    'while you drive, the question is yours: shown in the panel until you answer',
    { timeout: 90_000 },
    async () => {
      const { call, tab } = harness('conv_dialog_you', ['allow']);
      await call('browser_open', { url: `${origin}/basket` });
      const you = watcher();
      const unwatch = browser.watch('conv_dialog_you', you);
      try {
        const current = tab();
        if (!current) throw new Error('no tab');
        current.setControl('user');
        void current.page
          .locator('text=Remove')
          .click()
          .catch(() => undefined);
        await expect.poll(() => current.dialog?.message).toBe('Remove the mug from your basket?');
        expect((await current.state()).dialog).toMatchObject({
          kind: 'confirm',
          site: '127.0.0.1',
        });
        // Your hands on the page wait for the answer.
        await browser.command('conv_dialog_you', you, {
          type: 'mouse',
          action: 'down',
          x: 0.5,
          y: 0.5,
        });
        expect(you.events).toContainEqual({
          type: 'error',
          message: 'Answer the page’s question first.',
        });
        const id = current.dialog?.id ?? '';
        await browser.command('conv_dialog_you', you, { type: 'dialog', id, accept: false });
        await expect.poll(() => current.page.title()).toBe('Kept');
        expect(current.dialog).toBeUndefined();

        // Handing back with a question showing: Cancel, and the agent hears so.
        void current.page
          .locator('text=Remove')
          .click()
          .catch(() => undefined);
        await expect.poll(() => current.dialog?.kind).toBe('confirm');
        current.setControl('idle');
        await expect.poll(() => current.page.title()).toBe('Kept');
        const text = await call('browser_read', {});
        expect(text).toContain('while nobody was at the browser, so Conch answered Cancel');
      } finally {
        unwatch();
      }
    },
  );
});

describe.skipIf(!hasBrowser)('a form in one step, for real', () => {
  it(
    'fills text, a list and a box at once; leaves secrets and files',
    {
      timeout: 90_000,
    },
    async () => {
      const { call, asked, tab } = harness('conv_form', ['allow']);
      const page = await call('browser_open', { url: `${origin}/form` });
      const text = await call('browser_form', {
        fields: [
          { ref: refOf(page, /textbox "Full name"/), element: 'Full name', value: 'Ada Lovelace' },
          { ref: refOf(page, /textbox "Email"/), element: 'Email', value: 'ada@example.com' },
          { ref: refOf(page, /textbox "Password"/), element: 'Password', value: 'nope' },
          { ref: refOf(page, /combobox "Country"/), element: 'Country', value: 'Portugal' },
          { ref: refOf(page, /checkbox "Send me news"/), element: 'Send me news', checked: true },
          { ref: refOf(page, /textbox "Notes"/), element: 'Notes', value: 'Two lines\nof notes' },
          { ref: refOf(page, /button "CV"/), element: 'CV', value: 'cv.pdf' },
        ],
      });
      // One question for the whole form.
      expect(asked).toHaveLength(1);
      expect(asked[0]?.browser?.action).toMatch(/^Fill in 5 fields \(“Full name”, “Email”/);
      expect(text).toContain('Filled in 5 of 7 fields');
      expect(text).toContain('“Password” (a password, code or card field: use browser_type)');
      expect(text).toContain('“CV” (a file box: use browser_upload)');
      expect(text).toContain('The form isn’t sent yet');
      const values = await tab()?.page.evaluate(`(() => {
      const f = document.forms[0];
      return [f.name.value, f.email.value, f.password.value, f.country.value, f.news.checked, f.notes.value];
    })()`);
      expect(values).toEqual([
        'Ada Lovelace',
        'ada@example.com',
        '',
        'Portugal',
        true,
        'Two lines\nof notes',
      ]);
    },
  );

  it('a stale ref is skipped and said, the rest filled', { timeout: 90_000 }, async () => {
    const { call } = harness('conv_form_stale', ['allow']);
    const page = await call('browser_open', { url: `${origin}/form` });
    const text = await call('browser_form', {
      fields: [
        { ref: refOf(page, /textbox "Full name"/), element: 'Full name', value: 'Ada' },
        { ref: 'e999', element: 'Phone', value: '123' },
      ],
    });
    expect(text).toContain('Filled in 1 of 2 fields');
    expect(text).toContain('“Phone” (it isn’t on the page any more: read it again)');
  });

  it('Read only mode fills nothing', { timeout: 90_000 }, async () => {
    const { call } = harness('conv_form_plan', [], 'plan');
    const page = await call('browser_open', { url: `${origin}/form` });
    const text = await call('browser_form', {
      fields: [{ ref: refOf(page, /textbox "Full name"/), element: 'Full name', value: 'Ada' }],
    });
    expect(text).toMatch(/Read only mode/);
  });
});

describe.skipIf(!hasBrowser)('a long page, for real', () => {
  it('reads on part by part, to the end', { timeout: 90_000 }, async () => {
    const { call } = harness('conv_long');
    const first = await call('browser_open', { url: `${origin}/long` });
    expect(first).toContain('Item number 1 of');
    expect(first).not.toContain('Item number 1500 of');
    const parts = Number(/Part 1 of (\d+) of this page/.exec(first)?.[1]);
    expect(parts).toBeGreaterThan(1);
    expect(first).toContain('browser_read with part=2 reads the next one');
    const last = await call('browser_read', { part: parts });
    expect(last).toContain('Item number 1500 of');
    expect(last).toContain('That’s the end of the page.');
    expect(await call('browser_read', { part: parts + 5 })).toContain(
      `This page has ${parts} parts`,
    );
  });
});

describe.skipIf(!hasBrowser)('a site that checks for bots first, for real', () => {
  it('waits out a check that passes by itself', { timeout: 90_000 }, async () => {
    const { call } = harness('conv_check');
    const text = await call('browser_open', { url: `${origin}/check` });
    expect(text).toContain('that passed by itself');
    expect(text).toContain('Welcome to the shop');
  });

  it('a check that stays is handed to the person', { timeout: 90_000 }, async () => {
    const { call } = harness('conv_stuck');
    const text = await call('browser_open', { url: `${origin}/stuck` });
    expect(text).toContain('didn’t pass by itself. Call browser_handoff');
  });

  it('a refusal says so, and not to retry', { timeout: 90_000 }, async () => {
    const { call } = harness('conv_blocked');
    const text = await call('browser_open', { url: `${origin}/blocked` });
    expect(text).toContain('The site refused the browser (it answered 403)');
    expect(text).toContain('Don’t retry it over and over');
  });
});

describe.skipIf(!hasBrowser)('find on page, for you, for real', () => {
  it('finds, counts, moves on and back, and stops', { timeout: 90_000 }, async () => {
    const { call, tab } = harness('conv_find');
    await call('browser_open', { url: `${origin}/article` });
    const you = watcher();
    const unwatch = browser.watch('conv_find', you);
    try {
      const found = () => you.events.filter((e) => e.type === 'found').at(-1);
      await browser.command('conv_find', you, { type: 'find', text: 'pearl' });
      expect(found()).toEqual({ type: 'found', text: 'pearl', matches: 3, current: 1 });
      await browser.command('conv_find', you, { type: 'find', text: 'pearl', direction: 'next' });
      expect(found()).toMatchObject({ matches: 3, current: 2 });
      // Scrolled to the one far down.
      expect(Number(await tab()?.page.evaluate('window.scrollY'))).toBeGreaterThan(1000);
      await browser.command('conv_find', you, { type: 'find', text: 'pearl', direction: 'next' });
      await browser.command('conv_find', you, { type: 'find', text: 'pearl', direction: 'next' });
      // Round to the first again.
      expect(found()).toMatchObject({ current: 1 });
      await browser.command('conv_find', you, {
        type: 'find',
        text: 'pearl',
        direction: 'previous',
      });
      expect(found()).toMatchObject({ current: 3 });
      await browser.command('conv_find', you, { type: 'find', text: 'opal' });
      expect(found()).toMatchObject({ matches: 0, current: 0 });
      await browser.command('conv_find', you, { type: 'find', text: '' });
      expect(String(await tab()?.page.evaluate('String(getSelection())'))).toBe('');
      // The agent hears that you used the page.
      expect(await call('browser_read', {})).toContain('The user used the browser themselves');
    } finally {
      unwatch();
    }
  });
});
