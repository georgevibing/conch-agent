import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationEventInput, PermissionMode, VaultSignIn } from '@conch/protocol';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AskRequest, ToolContext } from '../conversations/manager';
import type { Engine, HostTool, PermissionDecision } from '../engines/types';
import { hostToolText } from '../engines/types';
import { offerFor, personFill } from './fill';
import { findBrowsers } from './locate';
import { BrowserService, type FillRequest, type PasswordFiller } from './service';

/**
 * Signing in some other way, for real (ADR 0133 § In the browser): Product
 * Hunt saved as "Sign in with Google", its button, Google's pages filled from
 * the Google login, one question, and nothing about a value to the model.
 * The test site plays both: 127.0.0.1 is "Product Hunt", localhost is "Google".
 */
const hasBrowser =
  findBrowsers({ downloaded: () => chromium.executablePath() }).length > 0 ||
  existsSync(chromium.executablePath());

let port = 0;
const pages: Record<string, () => string> = {
  '/ph': () => `<title>Product Hunt</title><h1>Welcome to Product Hunt</h1>
    <button type=button onclick="location.href='http://localhost:${port}/google'">Continue with Google</button>
    <form><label>Email <input type=email name=email></label><button type=button>Continue with email</button></form>`,
  '/google': () => `<title>Sign in – Google Accounts</title><form>
    <label>Email or phone <input name=identifier autocomplete=username></label>
    <label>Enter your password <input type=password name=Passwd autocomplete=current-password></label>
    <button type=button>Next</button></form>`,
  '/ph2': () => `<title>Product Hunt</title><h1>Welcome to Product Hunt</h1>
    <button type=button onclick="location.href='http://localhost:${port}/google'">Continue with Google</button>
    <button type=button onclick="location.href='http://localhost:${port}/apple'">Continue with Apple</button>`,
  '/chooser': () => `<title>Choose an account</title><h1>Choose an account</h1>
    <a href="/google">Bob Builder bob@gmail.com</a><a href="/google">Ada Lovelace ada@gmail.com</a>`,
  '/pk':
    () => `<title>Shop</title><form><label>Email <input type=email name=email autocomplete=username></label>
    <button type=button>Sign in with a passkey</button></form>`,
};

const ADA = 'ada' + '-google-pass-1';
const BOB = 'bob' + '-google-pass-2';

interface Item {
  id: string;
  title: string;
  subtitle: string;
  sites: string[];
  source?: string;
  signIn?: VaultSignIn;
  values?: { username?: string; password?: string };
}

const items: Item[] = [
  {
    id: 'ph',
    title: 'Product Hunt',
    subtitle: 'ada@gmail.com',
    sites: ['127.0.0.1'],
    source: '1password',
    signIn: { via: 'provider', provider: 'google', account: 'ada@gmail.com' },
  },
  {
    id: 'g2',
    title: 'Google (work)',
    subtitle: 'bob@gmail.com',
    sites: ['localhost'],
    values: { username: 'bob@gmail.com', password: BOB },
  },
  {
    id: 'g1',
    title: 'Google',
    subtitle: 'ada@gmail.com',
    sites: ['localhost'],
    values: { username: 'ada@gmail.com', password: ADA },
  },
];

/** Passwords as the browser sees them: a fake with the vault's site rule (exact hosts here). */
function passwordsWith(list: Item[]): PasswordFiller & { filled: FillRequest[] } {
  const filled: FillRequest[] = [];
  const on = (host: string) => list.filter((i) => i.sites.includes(host));
  const policy = (request: FillRequest) => {
    const item = list.find((i) => i.id === request.itemId);
    if (!item || !item.sites.includes(request.host))
      throw new Error(`That item isn’t saved for ${request.host}.`);
    return item;
  };
  return {
    filled,
    matching: (host) =>
      Promise.resolve(
        on(host).map((i) => ({
          id: i.id,
          title: i.title,
          subtitle: i.subtitle,
          match: 'exact' as const,
          ...(i.source && { source: i.source }),
          ...(i.signIn && { signIn: i.signIn }),
        })),
      ),
    signInItemFor: (item) => {
      if (item.signIn?.via !== 'provider') return undefined;
      const own = list.find((i) => !i.signIn && i.subtitle === item.signIn?.account);
      return own && { id: own.id, title: own.title, subtitle: own.subtitle };
    },
    cards: () => Promise.resolve([]),
    ensureOpen: () => Promise.resolve(true),
    isLocked: () => Promise.resolve(false),
    fillPolicy: (request) => {
      const item = policy(request);
      return Promise.resolve({
        ask: true,
        title: item.title,
        site: request.host,
        match: 'exact',
        type: 'login',
        has: (['username', 'password'] as const).filter((want) => item.values?.[want]),
        account: item.subtitle,
      });
    },
    fillValue: (request) => {
      const item = policy(request);
      filled.push(request);
      const value = item.values?.[request.want as 'username' | 'password'];
      return value ? Promise.resolve(value) : Promise.reject(new Error('Nothing to fill.'));
    },
    allowAgent: () => Promise.resolve(),
    lookalike: () => Promise.resolve(undefined),
    // Conch's own passkeys: none here.
    passkeysFor: () => Promise.resolve([]),
    passkeyCredential: () => Promise.reject(new Error('No passkey.')),
    savePasskey: () => Promise.reject(new Error('Not here.')),
  };
}

let site: Server;
let home = '';
let browser: BrowserService;

beforeAll(async () => {
  site = createServer((req, res) => {
    const page = pages[(req.url ?? '').split('?')[0] ?? ''];
    res.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>${page ? page() : '<title>Not found</title>'}`);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  port = (site.address() as { port: number }).port;
  home = await mkdtemp(join(tmpdir(), 'conch-signin-'));
  browser = new BrowserService({
    home,
    gatewayPort: 4999,
    workspace: () => Promise.resolve(home),
    emit: () => undefined,
  });
  await browser.updateSettings({ allowLocal: true });
});

afterAll(async () => {
  await browser?.stop();
  await new Promise((resolve) => site?.close(resolve));
  await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
});

function harness(
  conversationId: string,
  answers: PermissionDecision[] = [],
  mode: PermissionMode = 'auto',
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

describe.skipIf(!hasBrowser)('signing in another way, for real (ADR 0133)', () => {
  it(
    'Sign in with Google: the button, Google’s pages filled from the Google login, one question, no value to the model',
    { timeout: 90_000 },
    async () => {
      const passwords = passwordsWith(items);
      browser.passwords = passwords;
      try {
        const { call, asked } = harness('conv_google', ['allow']);
        const all: string[] = [];
        const opened = await call('browser_open', { url: `http://127.0.0.1:${port}/ph` });
        all.push(opened);
        // Conch says how this site signs in, beside the page, with its own button.
        const button = refOf(opened, /button "Continue with Google"/);
        expect(opened).toContain('(Passwords: “Product Hunt” signs in with Google (ada@gmail.com)');
        expect(opened).toContain(`“Continue with Google” [ref=${button}]`);
        expect(opened).toContain('Conch fills them from “Google” (ada@gmail.com)');

        // Hunting for a box anyway: told the same, and nothing is asked or filled.
        const email = await call('browser_type', {
          ref: refOf(opened, /textbox "Email"/),
          element: 'Email',
          text: '',
        });
        all.push(email);
        expect(email).toMatch(/signs in with Google .*not a password on this site/);
        expect(asked).toHaveLength(0);

        // The button: Google's page, and the chain.
        const clicked = await call('browser_click', {
          ref: button,
          element: 'Continue with Google',
        });
        all.push(clicked);
        expect(clicked).toContain('That’s “Product Hunt”’s sign-in with Google');
        const tab = browser.tabIfOpen('conv_google');
        expect(tab?.page.url()).toContain(`localhost:${port}/google`);

        // Two Google logins saved there: the one Product Hunt signs in with, without a choice.
        const google = await call('browser_read', {});
        const filled = await call('browser_type', {
          ref: refOf(google, /textbox "Enter your password"/),
          element: 'Password',
          text: '',
        });
        all.push(google, filled);
        expect(asked).toHaveLength(1);
        expect(asked[0]?.browser).toMatchObject({
          kind: 'fill',
          fill: 'sign-in',
          action: 'Sign in to “Product Hunt” with Google as ada@gmail.com',
          for: 'Product Hunt',
        });
        expect(asked[0]?.browser?.accounts).toBeUndefined();
        expect(filled).toContain('from the user’s saved item “Google”');
        expect(filled).toContain('This is “Product Hunt”’s sign-in with Google');
        expect(await tab?.page.locator('input[name=Passwd]').inputValue()).toBe(ADA);
        expect(await tab?.page.locator('input[name=identifier]').inputValue()).toBe(
          'ada@gmail.com',
        );
        // The Product Hunt item itself never filled anything, and only Google's own site got Google's.
        expect(passwords.filled.every((f) => f.itemId === 'g1' && f.host === 'localhost')).toBe(
          true,
        );

        // Back on Product Hunt's own site, a password box there never gets Google's password.
        const back = await call('browser_open', { url: `http://127.0.0.1:${port}/google` });
        const refused = await call('browser_type', {
          ref: refOf(back, /textbox "Enter your password"/),
          element: 'Password',
          text: '',
        });
        all.push(back, refused);
        expect(refused).toMatch(/signs in with Google .*not a password on this site/);
        expect(await tab?.page.locator('input[name=Passwd]').inputValue()).toBe('');
        expect(passwords.filled.some((f) => f.host === '127.0.0.1')).toBe(false);
        expect(asked).toHaveLength(1);

        // Nothing about a value reached the model.
        for (const text of all) {
          expect(text).not.toContain(ADA);
          expect(text).not.toContain(BOB);
        }
      } finally {
        browser.passwords = undefined;
      }
    },
  );

  it(
    'saved as “another account”: asks which rather than guessing, and the button pressed says whose',
    { timeout: 60_000 },
    async () => {
      const unnamed = items.map((i) =>
        i.id === 'ph'
          ? { ...i, signIn: { via: 'provider' as const, provider: 'other' as const } }
          : i,
      );
      const passwords = passwordsWith(unnamed);
      // The vault's own pick: only a named provider has a login.
      passwords.signInItemFor = (item) =>
        item.signIn?.provider === 'google'
          ? { id: 'g1', title: 'Google', subtitle: 'ada@gmail.com' }
          : undefined;
      browser.passwords = passwords;
      try {
        const { call, asked } = harness('conv_unnamed', ['allow']);
        const opened = await call('browser_open', { url: `http://127.0.0.1:${port}/ph2` });
        expect(opened).toContain('Passwords doesn’t say whose');
        expect(opened).toMatch(/Don’t guess: ask the user which one they use/);
        const tab = browser.tabIfOpen('conv_unnamed');
        if (!tab) throw new Error('no tab');
        const offer = await offerFor(passwords, tab);
        expect(offer?.signIn).toMatchObject({
          via: 'provider',
          name: 'another account',
          buttons: ['Continue with Google', 'Continue with Apple'],
        });
        expect(offer?.signIn?.button).toBeUndefined();

        const clicked = await call('browser_click', {
          ref: refOf(opened, /button "Continue with Google"/),
          element: 'Continue with Google',
        });
        expect(clicked).toContain('That’s “Product Hunt”’s sign-in with Google');
        const google = await call('browser_read', {});
        const filled = await call('browser_type', {
          ref: refOf(google, /textbox "Enter your password"/),
          element: 'Password',
          text: '',
        });
        expect(asked[0]?.browser).toMatchObject({
          action: 'Sign in to “Product Hunt” with Google as ada@gmail.com',
        });
        expect(filled).toContain('from the user’s saved item “Google”');
        expect(filled).not.toContain(ADA);
      } finally {
        browser.passwords = undefined;
      }
    },
  );

  it(
    'an emailed link: the email filled, and the agent told where the link or code comes from',
    { timeout: 60_000 },
    async () => {
      browser.passwords = passwordsWith([
        {
          id: 'sub',
          title: 'Substack',
          subtitle: 'ada@example.com',
          sites: ['127.0.0.1'],
          signIn: { via: 'link', account: 'ada@example.com' },
          values: { username: 'ada@example.com' },
        },
      ]);
      try {
        const { call } = harness('conv_link', ['allow']);
        const opened = await call('browser_open', { url: `http://127.0.0.1:${port}/pk` });
        const typed = await call('browser_type', {
          ref: refOf(opened, /textbox "Email"/),
          element: 'Email',
          text: '',
        });
        expect(typed).toContain('Conch filled the username');
        expect(typed).toMatch(/signs in with a link or code sent by email/);
        expect(typed).toMatch(/If you can read the user’s email/);
        expect(
          await browser.tabIfOpen('conv_link')?.page.locator('input[name=email]').inputValue(),
        ).toBe('ada@example.com');
      } finally {
        browser.passwords = undefined;
      }
    },
  );

  it(
    'Google already signed in: its chooser shows the account, and the agent is told to click it',
    { timeout: 60_000 },
    async () => {
      browser.passwords = passwordsWith(items);
      try {
        const { call, asked } = harness('conv_chooser');
        const opened = await call('browser_open', { url: `http://127.0.0.1:${port}/ph` });
        await call('browser_click', {
          ref: refOf(opened, /button "Continue with Google"/),
          element: 'Continue with Google',
        });
        const chooser = await call('browser_open', { url: `http://localhost:${port}/chooser` });
        const ada = refOf(chooser, /link "Ada Lovelace ada@gmail.com"/);
        expect(chooser).toContain(
          `Google shows ada@gmail.com, the account “Product Hunt” signs in with: click “Ada Lovelace ada@gmail.com” [ref=${ada}]`,
        );
        expect(asked).toHaveLength(0);
      } finally {
        browser.passwords = undefined;
      }
    },
  );

  it(
    'a passkey kept in 1Password: handed to the person with the reason, and the agent hears why',
    { timeout: 60_000 },
    async () => {
      browser.passwords = passwordsWith([
        {
          id: 'shop',
          title: 'Shop',
          subtitle: 'ada@example.com',
          sites: ['127.0.0.1'],
          source: '1password',
          signIn: { via: 'passkey', usable: false },
        },
      ]);
      try {
        const { call, asked, events } = harness('conv_passkey');
        const opened = await call('browser_open', { url: `http://127.0.0.1:${port}/pk` });
        expect(opened).toContain('signs in with a passkey kept in 1Password');
        const typing = call('browser_type', {
          ref: refOf(opened, /textbox "Email"/),
          element: 'Email',
          text: '',
        });
        await expect
          .poll(() =>
            events.find((e) => e.type === 'browser.handoff' && e.handoff.state === 'waiting'),
          )
          .toMatchObject({
            handoff: {
              reason:
                'Your passkey for Shop is kept in 1Password, which Conch’s browser can’t use. Sign in yourself, then hand the browser back.',
            },
          });
        browser.tabIfOpen('conv_passkey')?.setControl('idle');
        const result = await typing;
        expect(result).toContain('so the user signed in themselves');
        expect(result).toContain('browser_passkey with save');
        expect(asked).toHaveLength(0);

        const passkey = await harness('conv_passkey').call('browser_passkey', {
          action: 'sign_in',
        });
        expect(passkey).toMatch(/kept in 1Password, which Conch’s browser can’t use/);
        expect(passkey).toMatch(/A reason for browser_handoff/);
      } finally {
        browser.passwords = undefined;
      }
    },
  );

  it(
    'the live view: “Continue with Google” offered and pressed, then Google’s login first, for Product Hunt',
    { timeout: 60_000 },
    async () => {
      const passwords = passwordsWith(items);
      browser.passwords = passwords;
      try {
        const { call } = harness('conv_live');
        await call('browser_open', { url: `http://127.0.0.1:${port}/ph` });
        const tab = browser.tabIfOpen('conv_live');
        if (!tab) throw new Error('no tab');
        expect(await offerFor(passwords, tab)).toEqual({
          field: 'sign-in',
          site: '127.0.0.1',
          items: [{ id: 'ph', title: 'Product Hunt', account: 'ada@gmail.com' }],
          signIn: {
            via: 'provider',
            provider: 'google',
            name: 'Google',
            account: 'ada@gmail.com',
            button: 'Continue with Google',
            with: { id: 'g1', title: 'Google', account: 'ada@gmail.com' },
          },
        });
        // Only while you drive, and only an item saved for this page.
        expect(await personFill(passwords, tab, { item: 'ph', signIn: true })).toMatchObject({
          ok: false,
        });
        tab.setControl('user');
        expect(await personFill(passwords, tab, { item: 'g1', signIn: true })).toEqual({
          ok: false,
          message: 'That item isn’t saved for this site.',
        });
        expect(await personFill(passwords, tab, { item: 'ph', signIn: true })).toEqual({
          ok: true,
        });
        await expect.poll(() => tab.page.url()).toContain(`localhost:${port}/google`);
        await tab.page.locator('input[name=identifier]').focus();
        const offer = await offerFor(passwords, tab);
        expect(offer).toMatchObject({ field: 'username', for: 'Product Hunt' });
        expect(offer?.items.map((i) => i.id)).toEqual(['g1', 'g2']);
        tab.setControl('idle');
      } finally {
        browser.passwords = undefined;
      }
    },
  );
});
