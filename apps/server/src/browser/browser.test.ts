import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserLiveEvent, ConversationEventInput, PermissionMode } from '@conch/protocol';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AskRequest, ToolContext } from '../conversations/manager';
import type { Engine, HostTool, PermissionDecision } from '../engines/types';
import { hostToolText } from '../engines/types';
import type { VaultService as VaultServiceType } from '../vault/service';
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
  '/step1': `<title>Sign in</title><form><label>Email or phone <input name=identifier autocomplete=username></label>
    <button type=button onclick="location.href='/step2'">Next</button></form>`,
  '/step2': `<title>Welcome</title><form><label>Enter your password <input type=password name=pw autocomplete=current-password></label>
    <button type=button>Sign in</button></form>`,
  // A page that plants the boxes a fill writes into, and the masks a secret needs.
  '/planted': `<title>Welcome</title><form>${[0, 1, 2, 3]
    .map(
      (i) =>
        `<input type=password name=stolen${i} data-conch-fill=f${i} data-conch-secret=password>`,
    )
    .join('')}</form>`,
  '/otp': `<title>2-Step Verification</title><form><label>Enter the code <input name=otp autocomplete=one-time-code inputmode=numeric></label>
    <button type=button>Verify</button></form>`,
  '/signup': `<title>Join</title><form><label>Email <input type=email name=email></label>
    <label>Password <input type=password name=new></label><label>Confirm password <input type=password name=confirm></label>
    <button type=button>Create account</button></form>`,
  '/change': `<title>Security</title><form><label>Current password <input type=password name=cur autocomplete=current-password></label>
    <label>New password <input type=password name=n1 autocomplete=new-password></label>
    <label>Confirm new password <input type=password name=n2 autocomplete=new-password></label><button type=button>Save</button></form>`,
  '/checkout': `<title>Checkout</title><h1>Your order</h1><p>The pearl mug</p>
    <p>Order total: £12.00</p>
    <button onclick="document.title='Ordered'">Place order</button>
    <button onclick="document.title='Booked'">Book a table</button>`,
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
    // A sign-in box from another origin (localhost, not 127.0.0.1) inside the page.
    const port = (site.address() as { port: number }).port;
    if (req.url === '/framed')
      pages[req.url] = `<title>Shop</title><h1>Shop</h1>
      <iframe title="Sign in" src="http://localhost:${port}/login" width=600 height=300></iframe>`;
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

/** An answer to a card: a decision, or the person's press (which may pick one of its choices). */
type Answer = PermissionDecision | ((request: AskRequest) => PermissionDecision);

function harness(
  answers: Answer[] = [],
  mode: PermissionMode = 'default',
  conversationId = 'conv_test',
  said: readonly string[] = [],
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
      const answer = answers.shift() ?? 'deny';
      return Promise.resolve(typeof answer === 'function' ? answer(request) : answer);
    },
    signal: new AbortController().signal,
    said: () => said,
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
      'running',
      'done',
    ]);
    const done = steps.at(-1);
    expect(done?.type === 'browser.step' && done.step.shot).toBeTruthy();
  });

  it(
    'asks once per site, and always before something significant',
    { timeout: 60_000 },
    async () => {
      const { call, asked } = harness(['allow', 'deny'], 'default', 'conv_shop');
      const page = await call('browser_open', { url: `${origin}/shop` });
      let text = await call('browser_click', {
        ref: refOf(page, /Add to cart/),
        element: 'Add to cart',
      });
      expect(asked.map((a) => a.browser?.kind)).toEqual(['site']);
      expect(asked[0]?.summary).toBe('use 127.0.0.1');
      // After an action, only what changed comes back (ADR 0085), the new line marked.
      expect(text).toContain('<page-changes>');
      expect(text).toMatch(/^\+ .*In your cart: 1/m);
      // The same site again: no question.
      text = await call('browser_click', {
        ref: refOf(page, /Add to cart/),
        element: 'Add to cart',
      });
      expect(asked).toHaveLength(1);
      // Ordering is significant: asked even though the site is allowed, and "no" holds.
      const refused = await call('browser_click', {
        ref: refOf(page, /Place order/),
        element: 'the blue button',
      });
      expect(asked[1]?.browser).toMatchObject({
        kind: 'high-stakes',
        action: 'Click “Place order”',
      });
      expect(refused).toMatch(/said no to “Click “Place order””/);
      // Asked for, the whole page comes back.
      const whole = await call('browser_read', {});
      expect(whole).toContain('<page-content>');
      expect(whole).not.toContain('Ordered!');
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
    'fills a saved password for the site, with your OK, and the model never sees it',
    { timeout: 90_000 },
    async () => {
      const { VaultService } = await import('../vault/service');
      const vault = new VaultService({
        home: await mkdtemp(join(tmpdir(), 'conch-fill-')),
        keystore: 'file',
      });
      browser.passwords = vault;
      const saved = await vault.create({
        type: 'login',
        title: 'Test site',
        fields: [
          { label: 'Username', kind: 'text', role: 'username', value: 'ada@example.com' },
          { label: 'Password', kind: 'secret', role: 'password', value: 'river-otter-copper-42!' },
        ],
        urls: [origin],
        tags: [],
        notes: '',
        favorite: false,
        agentAccess: 'ask',
        allowedSites: [],
      });
      try {
        // Said no: nothing is filled, and the model is told so.
        const no = harness(['deny'], 'default', 'conv_fill_no');
        let text = await no.call('browser_open', { url: `${origin}/login` });
        const declined = await no.call('browser_type', {
          ref: refOf(text, /textbox "Password"/),
          element: 'Password',
          text: '',
        });
        expect(no.asked[0]?.browser).toMatchObject({
          kind: 'fill',
          fill: 'sign-in',
          action: 'Sign in as ada@example.com',
        });
        expect(declined).toMatch(/doesn’t want Conch to fill that/);
        expect(
          await browser
            .tabIfOpen('conv_fill_no')
            ?.page.locator('input[type=password]')
            .inputValue(),
        ).toBe('hunter2');

        // Said yes: the password and the username go straight into the page.
        const yes = harness(['allow'], 'default', 'conv_fill_yes');
        text = await yes.call('browser_open', { url: `${origin}/login` });
        const filled = await yes.call('browser_type', {
          ref: refOf(text, /textbox "Password"/),
          element: 'Password',
          text: '',
        });
        expect(filled).toContain('Conch filled the password (and the username)');
        expect(filled).toContain('from the user’s saved item “Test site”');
        expect(filled).not.toContain('river-otter');
        const page = browser.tabIfOpen('conv_fill_yes')?.page;
        expect(await page?.locator('input[type=password]').inputValue()).toBe(
          'river-otter-copper-42!',
        );
        expect(await page?.locator('input[name=email]').inputValue()).toBe('ada@example.com');
        expect((await vault.detail(saved.id)).usedAt).toBeDefined();

        // Saved for another site: never offered here; the person types it.
        await vault.update(saved.id, {
          type: 'login',
          title: 'Test site',
          fields: (await vault.detail(saved.id)).fields.map((f) => ({
            id: f.id,
            label: f.label,
            kind: f.kind,
            ...(f.role && { role: f.role }),
          })),
          urls: ['https://example.com'],
          tags: [],
          notes: '',
          favorite: false,
          agentAccess: 'ask',
          allowedSites: [],
        });
        const other = harness([], 'default', 'conv_fill_other');
        text = await other.call('browser_open', { url: `${origin}/login` });
        const typing = other.call('browser_type', {
          ref: refOf(text, /textbox "Password"/),
          element: 'Password',
          text: '',
        });
        await expect
          .poll(() =>
            other.events.some((e) => e.type === 'browser.handoff' && e.handoff.state === 'waiting'),
          )
          .toBe(true);
        expect(other.asked).toHaveLength(0);
        browser.tabIfOpen('conv_fill_other')?.setControl('idle');
        await typing;
      } finally {
        browser.passwords = undefined;
      }
    },
  );

  describe('Passwords in the browser (ADR 0130)', () => {
    const TOTP = 'JBSWY3DPEHPK3PXP';
    async function withVault<T>(work: (vault: VaultServiceType) => Promise<T>): Promise<T> {
      const { VaultService } = await import('../vault/service');
      const vault = new VaultService({
        home: await mkdtemp(join(tmpdir(), 'conch-fill-')),
        keystore: 'file',
      });
      browser.passwords = vault;
      try {
        return await work(vault);
      } finally {
        browser.passwords = undefined;
      }
    }
    const login = (title: string, user: string, password: string, more: object = {}) => ({
      type: 'login' as const,
      title,
      fields: [
        { label: 'Username', kind: 'text' as const, role: 'username' as const, value: user },
        { label: 'Password', kind: 'secret' as const, role: 'password' as const, value: password },
        ...('totp' in more
          ? [{ label: 'One-time code', kind: 'totp' as const, value: String(more.totp) }]
          : []),
      ],
      urls: [origin],
      tags: [],
      notes: '',
      favorite: false,
      agentAccess: 'ask' as const,
      allowedSites: [],
    });

    it(
      'asks once for a sign-in that spans pages: the username, then the password, then the code',
      { timeout: 90_000 },
      async () => {
        await withVault(async (vault) => {
          await vault.create(login('Mail', 'ada@example.com', 'violet-heron-57!', { totp: TOTP }));
          const h = harness(['allow'], 'default', 'conv_steps');
          let text = await h.call('browser_open', { url: `${origin}/step1` });
          const user = await h.call('browser_type', {
            ref: refOf(text, /textbox "Email or phone"/),
            element: 'Email or phone',
            text: '',
          });
          expect(h.asked).toHaveLength(1);
          expect(h.asked[0]?.browser).toMatchObject({
            kind: 'fill',
            fill: 'sign-in',
            action: 'Sign in as ada@example.com',
          });
          expect(user).toContain('Conch filled the username');
          const page = () => browser.tabIfOpen('conv_steps')?.page;
          expect(await page()?.locator('input[name=identifier]').inputValue()).toBe(
            'ada@example.com',
          );
          // The next page: the same sign-in, so no second question.
          text = await h.call('browser_open', { url: `${origin}/step2` });
          const password = await h.call('browser_type', {
            ref: refOf(text, /textbox "Enter your password"/),
            element: 'Password',
            text: '',
          });
          expect(h.asked).toHaveLength(1);
          expect(password).toContain('Conch filled the password');
          expect(password).not.toContain('violet-heron');
          expect(await page()?.locator('input[type=password]').inputValue()).toBe(
            'violet-heron-57!',
          );
          // And its code, computed in the gateway.
          text = await h.call('browser_open', { url: `${origin}/otp` });
          const code = await h.call('browser_type', {
            ref: refOf(text, /textbox "Enter the code"/),
            element: 'Code',
            text: '',
          });
          expect(h.asked).toHaveLength(1);
          expect(code).toContain('Conch filled the one-time code');
          const { parseTotp, totpNow } = await import('../vault/totp');
          const now = Date.now();
          const filled = await page()?.locator('input[name=otp]').inputValue();
          expect([
            totpNow(parseTotp(TOTP), now).code,
            totpNow(parseTotp(TOTP), now - 30_000).code,
          ]).toContain(filled);
          expect(code).not.toContain(filled ?? '------');
        });
      },
    );

    it(
      'lets the person pick between saved accounts on the card, in one tap',
      { timeout: 90_000 },
      async () => {
        await withVault(async (vault) => {
          await vault.create(login('Work', 'ada@work.example', 'work-pass-1!'));
          const home = await vault.create(login('Home', 'ada@home.example', 'home-pass-2!'));
          const h = harness(
            [
              (request) => {
                request.choose?.(home.id);
                return 'allow';
              },
            ],
            'default',
            'conv_choose',
          );
          const text = await h.call('browser_open', { url: `${origin}/login` });
          const result = await h.call('browser_type', {
            ref: refOf(text, /textbox "Password"/),
            element: 'Password',
            text: '',
          });
          const accounts = h.asked[0]?.browser?.accounts ?? [];
          expect(accounts.map((a) => a.account).sort()).toEqual([
            'ada@home.example',
            'ada@work.example',
          ]);
          // Names only on the card: never a value.
          expect(JSON.stringify(h.asked[0])).not.toMatch(/pass-[12]/);
          expect(result).toContain('“Home”');
          const page = browser.tabIfOpen('conv_choose')?.page;
          expect(await page?.locator('input[type=password]').inputValue()).toBe('home-pass-2!');
          expect(await page?.locator('input[name=email]').inputValue()).toBe('ada@home.example');
          // A choice the card never offered is refused.
          expect(() => h.asked[0]?.choose?.('pw_someone_else')).toThrow();
        });
      },
    );

    it(
      'fills nothing once the page went elsewhere while the person was asked',
      { timeout: 90_000 },
      async () => {
        await withVault(async (vault) => {
          await vault.create(login('Mail', 'ada@example.com', 'violet-heron-57!'));
          const page = () => browser.tabIfOpen('conv_moved')?.page;
          const elsewhere = origin.replace('127.0.0.1', 'localhost');
          const h = harness(
            [
              (async () => {
                await page()?.goto(`${elsewhere}/planted`);
                return 'allow';
              }) as unknown as Answer,
            ],
            'default',
            'conv_moved',
          );
          const text = await h.call('browser_open', { url: `${origin}/step2` });
          await h.call('browser_type', {
            ref: refOf(text, /textbox "Enter your password"/),
            element: 'Password',
            text: '',
          });
          expect(h.asked).toHaveLength(1);
          expect(page()?.url()).toContain('/planted');
          for (const i of [0, 1, 2, 3])
            expect(await page()?.locator(`input[name=stolen${i}]`).inputValue()).toBe('');
        });
      },
    );

    it(
      'makes, saves and fills a strong password on a sign-up form',
      { timeout: 90_000 },
      async () => {
        await withVault(async (vault) => {
          // The site's question for typing the email, then the new password's.
          const h = harness(['allow', 'allow'], 'default', 'conv_signup');
          const text = await h.call('browser_open', { url: `${origin}/signup` });
          await h.call('browser_type', {
            ref: refOf(text, /textbox "Email"/),
            element: 'Email',
            text: 'new@example.com',
          });
          const made = await h.call('browser_type', {
            ref: refOf(text, /textbox "Password"/),
            element: 'Password',
            text: '',
          });
          expect(h.asked.at(-1)?.browser).toMatchObject({
            kind: 'fill',
            fill: 'new-password',
            action: 'Make a strong password for 127.0.0.1',
          });
          expect(made).toContain('saved it in the user’s Passwords');
          const page = browser.tabIfOpen('conv_signup')?.page;
          const first = await page?.locator('input[name=new]').inputValue();
          expect(first?.length).toBeGreaterThanOrEqual(20);
          expect(await page?.locator('input[name=confirm]').inputValue()).toBe(first);
          expect(made).not.toContain(first ?? '-');
          const { items } = await vault.list();
          const saved = items.find((i) => i.domains.includes('127.0.0.1'));
          expect(saved?.subtitle).toBe('new@example.com');
          expect(
            await vault.fillValue({ itemId: saved?.id ?? '', host: '127.0.0.1', want: 'password' }),
          ).toBe(first);
        });
      },
    );

    it(
      'changes a saved password: the old one in the current box, the new one kept with its history',
      { timeout: 90_000 },
      async () => {
        await withVault(async (vault) => {
          const item = await vault.create(login('Account', 'ada@example.com', 'old-secret-123!'));
          const h = harness(['allow'], 'default', 'conv_change');
          const text = await h.call('browser_open', { url: `${origin}/change` });
          const changed = await h.call('browser_type', {
            ref: refOf(text, /textbox "New password"/),
            element: 'New password',
            text: '',
          });
          expect(h.asked[0]?.browser).toMatchObject({
            fill: 'new-password',
            action: 'Make a new password for “Account”',
          });
          expect(changed).toContain('the old one is kept in its history');
          const page = browser.tabIfOpen('conv_change')?.page;
          expect(await page?.locator('input[name=cur]').inputValue()).toBe('old-secret-123!');
          const next = await page?.locator('input[name=n1]').inputValue();
          expect(next).not.toBe('old-secret-123!');
          expect(await page?.locator('input[name=n2]').inputValue()).toBe(next);
          expect(
            await vault.fillValue({ itemId: item.id, host: '127.0.0.1', want: 'password' }),
          ).toBe(next);
          expect((await vault.detail(item.id)).history).toBe(1);
        });
      },
    );

    it(
      'signs in with no card in Auto when the person asked for this sign-in, and asks when not',
      { timeout: 90_000 },
      async () => {
        await withVault(async (vault) => {
          await vault.create(login('Mail', 'ada@example.com', 'violet-heron-57!'));
          const asked = harness([], 'auto', 'conv_said_signin', ['log in to Mail with my login']);
          let text = await asked.call('browser_open', { url: `${origin}/step1` });
          const filled = await asked.call('browser_type', {
            ref: refOf(text, /textbox "Email or phone"/),
            element: 'Email or phone',
            text: '',
          });
          expect(asked.asked).toHaveLength(0);
          expect(filled).toContain('Conch filled the username');

          const other = harness(['deny'], 'auto', 'conv_unsaid_signin', ['what’s new today?']);
          text = await other.call('browser_open', { url: `${origin}/step1` });
          await other.call('browser_type', {
            ref: refOf(text, /textbox "Email or phone"/),
            element: 'Email or phone',
            text: '',
          });
          expect(other.asked.map((a) => a.browser?.kind)).toEqual(['fill']);
        });
      },
    );

    it(
      'never fills a sign-in box from another origin inside the page',
      { timeout: 90_000 },
      async () => {
        await withVault(async (vault) => {
          await vault.create({
            ...login('Local', 'ada@example.com', 'framed-pass-9!'),
            urls: [origin, origin.replace('127.0.0.1', 'localhost')],
          });
          const h = harness(['allow'], 'default', 'conv_framed');
          const text = await h.call('browser_open', { url: `${origin}/framed` });
          const typing = h.call('browser_type', {
            ref: refOf(text, /textbox "Password"/),
            element: 'Password',
            text: '',
          });
          await expect
            .poll(() =>
              h.events.some((e) => e.type === 'browser.handoff' && e.handoff.state === 'waiting'),
            )
            .toBe(true);
          const waiting = h.events.find(
            (e) => e.type === 'browser.handoff' && e.handoff.state === 'waiting',
          );
          expect(waiting?.type === 'browser.handoff' && waiting.handoff.reason).toMatch(
            /comes from another site inside the page/,
          );
          expect(h.asked).toHaveLength(0);
          browser.tabIfOpen('conv_framed')?.setControl('idle');
          await typing;
          const frame = browser.tabIfOpen('conv_framed')?.page.frames()[1];
          expect(await frame?.locator('input[type=password]').inputValue()).toBe('hunter2');
        });
      },
    );

    it('fills nothing in Read only mode', { timeout: 60_000 }, async () => {
      await withVault(async (vault) => {
        await vault.create(login('Mail', 'ada@example.com', 'violet-heron-57!'));
        const h = harness(['allow'], 'plan', 'conv_fill_plan');
        const text = await h.call('browser_open', { url: `${origin}/login` });
        const result = await h.call('browser_type', {
          ref: refOf(text, /textbox "Password"/),
          element: 'Password',
          text: '',
        });
        expect(result).toContain('Read only mode');
        expect(h.asked).toHaveLength(0);
        expect(
          await browser
            .tabIfOpen('conv_fill_plan')
            ?.page.locator('input[type=password]')
            .inputValue(),
        ).toBe('hunter2');
      });
    });

    it(
      'offers Passwords in the live view, and fills only what you pressed, on its own site',
      { timeout: 90_000 },
      async () => {
        await withVault(async (vault) => {
          const item = await vault.create(login('Mail', 'ada@example.com', 'violet-heron-57!'));
          const other = await vault.create({
            ...login('Elsewhere', 'bob@example.com', 'not-for-here-1!'),
            urls: ['https://example.com'],
          });
          const sent: BrowserLiveEvent[] = [];
          const watcher = {
            visible: true,
            send: (e: BrowserLiveEvent) => sent.push(e),
            frame: () => undefined,
          };
          const h = harness([], 'default', 'conv_live_fill');
          await h.call('browser_open', { url: `${origin}/login` });
          const tab = browser.tabIfOpen('conv_live_fill');
          if (!tab) throw new Error('no tab');
          // The assistant has the wheel: a press from the panel fills nothing.
          tab.setControl('agent');
          await browser.command('conv_live_fill', watcher, { type: 'fill', item: item.id });
          expect(sent.at(-1)).toMatchObject({ type: 'error' });
          // You click into the password box: the panel is offered what's saved, by name.
          tab.setControl('user');
          const box = await tab.page.locator('input[type=password]').boundingBox();
          const viewport = tab.page.viewportSize() ?? { width: 1280, height: 800 };
          const at = {
            x: ((box?.x ?? 0) + 5) / viewport.width,
            y: ((box?.y ?? 0) + 5) / viewport.height,
          };
          await browser.command('conv_live_fill', watcher, {
            type: 'mouse',
            action: 'down',
            ...at,
          });
          await browser.command('conv_live_fill', watcher, { type: 'mouse', action: 'up', ...at });
          const offer = sent.findLast((e) => e.type === 'typing');
          expect(offer).toMatchObject({
            type: 'typing',
            editable: true,
            fill: {
              field: 'password',
              items: [{ id: item.id, title: 'Mail', account: 'ada@example.com' }],
            },
          });
          expect(JSON.stringify(offer)).not.toContain('violet');
          // An item saved for another site is refused, whatever the panel sends.
          await browser.command('conv_live_fill', watcher, { type: 'fill', item: other.id });
          expect(sent.at(-1)).toMatchObject({ type: 'error' });
          expect(await tab.page.locator('input[type=password]').inputValue()).toBe('hunter2');
          // The one you pressed goes in, with its username.
          await tab.page.locator('input[type=password]').focus();
          await browser.command('conv_live_fill', watcher, { type: 'fill', item: item.id });
          expect(await tab.page.locator('input[type=password]').inputValue()).toBe(
            'violet-heron-57!',
          );
          expect(await tab.page.locator('input[name=email]').inputValue()).toBe('ada@example.com');
          expect((await vault.detail(item.id)).usedAt).toBeDefined();
        });
      },
    );
  });

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

  it('only reads in Read only mode', { timeout: 60_000 }, async () => {
    const { call, asked } = harness(['allow'], 'plan', 'conv_plan');
    const text = await call('browser_open', { url: `${origin}/shop` });
    const result = await call('browser_click', {
      ref: refOf(text, /Add to cart/),
      element: 'Add to cart',
    });
    expect(result).toContain('Read only mode');
    expect(asked).toHaveLength(0);
  });
});

describe.skipIf(!hasBrowser)('what the person already said, in Auto (ADR 0131, 2026-10-27)', () => {
  it(
    'places an order inside the limit they named, and asks past it',
    { timeout: 60_000 },
    async () => {
      const within = harness([], 'auto', 'conv_cap_ok', ['buy the pearl mug if it’s under £20']);
      let page = await within.call('browser_open', { url: `${origin}/checkout` });
      await within.call('browser_click', {
        ref: refOf(page, /Place order/),
        element: 'Place order',
      });
      expect(within.asked).toHaveLength(0);
      expect(await browser.tabIfOpen('conv_cap_ok')?.page.title()).toBe('Ordered');

      const past = harness(['deny'], 'auto', 'conv_cap_past', ['buy it if under £10']);
      page = await past.call('browser_open', { url: `${origin}/checkout` });
      const refused = await past.call('browser_click', {
        ref: refOf(page, /Place order/),
        element: 'Place order',
      });
      expect(past.asked.map((a) => a.browser?.kind)).toEqual(['high-stakes']);
      expect(refused).toMatch(/said no/);

      // A limit in another currency than the page's is no limit at all.
      const dollars = harness(['deny'], 'auto', 'conv_cap_usd', ['buy it if under $50']);
      page = await dollars.call('browser_open', { url: `${origin}/checkout` });
      await dollars.call('browser_click', {
        ref: refOf(page, /Place order/),
        element: 'Place order',
      });
      expect(dollars.asked.map((a) => a.browser?.kind)).toEqual(['high-stakes']);
    },
  );

  it('lets Auto’s review weigh a booking, never a payment', { timeout: 60_000 }, async () => {
    const h = harness(['deny', 'deny'], 'auto', 'conv_review_book');
    const page = await h.call('browser_open', { url: `${origin}/checkout` });
    await h.call('browser_click', { ref: refOf(page, /Book a table/), element: 'Book a table' });
    await h.call('browser_click', { ref: refOf(page, /Place order/), element: 'Place order' });
    expect(h.asked.map((a) => a.browser?.kind)).toEqual(['high-stakes', 'high-stakes']);
    // The booking carries the page for the review; the order doesn't.
    expect(h.asked[0]?.revalidate).toBeTypeOf('function');
    expect(h.asked[1]?.revalidate).toBeUndefined();
  });
});
