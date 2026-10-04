import type {
  BrowserActionKind,
  BrowserBox,
  BrowserPermission,
  VaultRequest,
} from '@conch/protocol';
import type { Download, Locator, Page } from 'playwright-core';
import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { HostTool, HostToolResult } from '../engines/types';
import { newId } from '../lib/ids';
import { declineCookies } from './cookies';
import { isHighStakes, SECRET_ATTR, secretLabel, type SecretKind } from './risk';
import { BrowserProblemError } from './runtime';
import { plainNavigationError, toUrl, type BrowserService } from './service';
import { displayHost, siteOf } from './site';
import { armCreate, armSignIn } from './passkeys';
import { markSecrets, readChanges, readPage } from './snapshot';
import type { Tab } from './tab';

/** The page's host, for a fill: https only, or this computer itself. */
function hostOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const local = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i.test(parsed.hostname);
    return parsed.protocol === 'https:' || local ? parsed.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The agent's browser tools (ADR 0014, "What the agent gets"). Every action
 * goes through `step`: it waits while you're driving, logs a live step with a
 * thumbnail, asks the questions that matter, and turns failures into words the
 * agent can act on — retrying once itself where that usually works.
 */

/** A refusal the agent should hear as-is (the user said no, plan mode, a secret field). */
class Refusal extends Error {}

/** A tab that went away mid-step: the browser restarts, and the step runs once more. */
const CLOSED =
  /Target page, context or browser has been closed|Target closed|Browser has been closed/i;

/** How long the agent's cursor lingers before acting, when someone is watching. */
const WATCHED_PAUSE_MS = 420;

/** How long a handoff waits for you before the agent is told to move on. */
const HANDOFF_WAIT_MS = 30 * 60_000;

/**
 * A ref the way a model copied it from the page text: `[ref=e12]`, `ref=e12`,
 * `e12]`, `"e12"`. Only the wrapping goes; what's left must still be a bare ref
 * (ADR 0072), so nothing else can reach the locator.
 */
export function unwrapRef(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const bare = /^\s*\[?\s*(?:ref\s*[=:]\s*)?["'`]?([a-z0-9]{1,16})["'`]?\s*\]?\s*$/i.exec(value);
  return bare ? bare[1] : value;
}

const Ref = z.preprocess(
  unwrapRef,
  z
    .string()
    .regex(/^[a-z0-9]{1,16}$/i, 'Use a ref from the page text, like e12.')
    .describe('The element’s ref from the page text, e.g. "e12".'),
);
const Element = z
  .string()
  .max(120)
  .describe('What the element is, in a few words (e.g. "Search box", "Sign in button").');

interface Outcome {
  text: string;
  images?: HostToolResult['images'];
  /** The step's label once done ("Opened booking.com"), if it differs from the plan. */
  label?: string;
}

/** Playwright's action errors, in words the agent can act on. */
function explain(error: unknown): string {
  const message = String((error as Error)?.message ?? error);
  if (/intercepts pointer events/.test(message)) {
    const who = /<([a-z][^>]{0,80})>[^<]*intercepts pointer events/i.exec(message)?.[1];
    return `Something is covering that element${who ? ` (<${who}>)` : ''}. Close it first (a dialog, a banner, a menu), then try again.`;
  }
  if (/Timeout .*exceeded/i.test(message) && /aria-ref|locator/i.test(message))
    return 'That element isn’t on the page any more: the page changed. Read the page again and use a fresh ref.';
  if (/not an? (?:<select>|select) element|not a select/i.test(message))
    return 'That element isn’t a list to choose from. Click it instead, then pick the option.';
  if (/did not find some options|options? not found/i.test(message))
    return 'That list has no option by that name. Read the page for the exact options.';
  if (/net::|NS_ERROR|Timeout/i.test(message)) return plainNavigationError(error as Error);
  return message.split('\n')[0]?.slice(0, 240) ?? 'That didn’t work.';
}

export function browserTools(service: BrowserService, ctx: ToolContext): HostTool[] {
  const { conversationId } = ctx;

  const locate = (tab: Tab, ref: string): Locator => tab.page.locator(`aria-ref=${ref}`);

  /** Wait a beat so the agent's cursor visibly reaches the control, if anyone's watching. */
  const point = async (
    tab: Tab,
    action: BrowserActionKind,
    label: string,
    box?: BrowserBox,
  ): Promise<void> => {
    tab.announce({ type: 'action', action, label, box });
    if (tab.watched) await new Promise((r) => setTimeout(r, WATCHED_PAUSE_MS));
  };

  /** The one door every browser action goes through. */
  const step = async (
    action: BrowserActionKind,
    labels: { running: string; done: string },
    work: (tab: Tab) => Promise<Outcome>,
    attempt = 0,
  ): Promise<string | HostToolResult> => {
    let tab: Tab;
    try {
      tab = await service.tabFor(conversationId);
    } catch (error) {
      const problem = error instanceof BrowserProblemError ? error.problem : undefined;
      return [
        `The browser isn’t available: ${problem?.message ?? explain(error)}`,
        problem?.command
          ? `Tell the user; it’s fixed by running this once: ${problem.command}`
          : 'Tell the user; Settings › Browser shows what’s wrong and has a Repair button.',
      ].join(' ');
    }
    try {
      await tab.whenFree(ctx.signal);
    } catch {
      return 'Stopped.';
    }
    const touched = tab.touched;
    tab.touched = false;
    tab.setControl('agent');
    tab.lastUsed = Date.now();
    const stepId = newId('step');
    const log = (status: 'running' | 'done' | 'error', label: string, shot?: string) =>
      ctx.append({
        type: 'browser.step',
        step: {
          stepId,
          status,
          action,
          label,
          url: tab.page.url(),
          title: '',
          shot,
          by: 'agent',
        },
      });
    log('running', labels.running);
    try {
      const outcome = await work(tab);
      const shot = await service.saveShot(conversationId, (await tab.thumbnail())?.jpeg);
      const title = await tab.page.title().catch(() => '');
      ctx.append({
        type: 'browser.step',
        step: {
          stepId,
          status: 'done',
          action,
          label: outcome.label ?? labels.done,
          url: tab.page.url(),
          title,
          shot,
          by: 'agent',
        },
      });
      const note = touched
        ? '(The user used the browser themselves since your last step, so the page may have changed.)\n'
        : '';
      return outcome.images
        ? { text: note + outcome.text, images: outcome.images }
        : note + outcome.text;
    } catch (error) {
      if (
        !(error instanceof Refusal) &&
        CLOSED.test(String((error as Error)?.message)) &&
        attempt === 0
      ) {
        // The browser went away (crash, closed): it restarts and restores the page.
        log('error', `${labels.running}: the browser restarted, trying again`);
        service.runtime.heal('The browser closed mid-step; Conch restarted it and carried on.');
        await service.forgetTab(conversationId);
        return step(action, labels, work, attempt + 1);
      }
      const message = error instanceof Refusal ? error.message : explain(error);
      log('error', `${labels.running}: ${message}`);
      return message;
    } finally {
      if (tab.control === 'agent') tab.setControl('idle');
      tab.lastUsed = Date.now();
    }
  };

  /** Ask before acting on a site, and always before something significant. */
  const permit = async (
    tab: Tab,
    request: { action: string; highStakes: boolean; box?: BrowserBox; kind?: 'download' },
  ): Promise<void> => {
    const url = tab.page.url();
    const site = siteOf(url) ?? displayHost(url);
    if (ctx.permissionMode === 'plan') {
      throw new Refusal(
        'This chat is in Plan only mode, so you can read pages but not click, type or choose. Tell the user what you’d do instead.',
      );
    }
    const kind: BrowserPermission['kind'] =
      request.kind ?? (request.highStakes ? 'high-stakes' : 'site');
    // Read something untrusted (ADR 0028): even a trusted site, or Full trust, asks once per site.
    const untrusted =
      kind === 'site' ? (ctx.untrusted?.() ?? (await ctx.restricted?.('browser'))) : undefined;
    if (kind === 'site') {
      if (tab.sites.has(site)) return;
      if (!untrusted && ctx.permissionMode === 'bypassPermissions') return;
      if (!untrusted && (await service.store.trusts(site))) return;
    }
    const picture = await tab.thumbnail(request.box);
    const shot = await service.saveShot(conversationId, picture?.jpeg);
    const title = await tab.page.title().catch(() => '');
    const decision = await ctx.ask({
      toolName: `browser_${kind}`,
      input: { site, action: request.action, url },
      summary:
        kind === 'site'
          ? `use ${site}`
          : `${request.action.charAt(0).toLowerCase()}${request.action.slice(1)} on ${site}`,
      browser: { kind, site, url, title, action: request.action, box: picture?.box, shot },
      ...(untrusted && { taint: `${untrusted} So I’m checking before I act on ${site}.` }),
    });
    if (decision === 'deny') {
      throw new Refusal(
        kind === 'site'
          ? `The user doesn’t want you acting on ${site}. You can still read it. Don’t try another way; ask what they’d like instead.`
          : `The user said no to “${request.action}”. Don’t try another way; ask what they’d like instead.`,
      );
    }
    tab.sites.add(site);
    if (decision === 'allow-always' && kind === 'site') await service.grantSite(site);
  };

  /**
   * Fill a secret field from Passwords (ADR 0025). Only on the item's own site
   * (the field's frame included), only after the person says yes (unless they
   * chose "Always" for that item), and the value goes straight from the
   * gateway into the page: the model is told that it happened, never what.
   * Returns undefined when there's nothing saved to offer (the person types it).
   */
  const fillSaved = async (
    tab: Tab,
    target: Locator,
    element: string,
    secret: SecretKind,
    itemId: string | undefined,
  ): Promise<Outcome | undefined> => {
    const passwords = service.passwords;
    if (!passwords || secret === 'identity') return undefined;
    const frameUrl = await target
      .elementHandle({ timeout: 2_000 })
      .then((h) => h?.ownerFrame())
      .then((f) => f?.url())
      .catch(() => undefined);
    const host = hostOf(frameUrl ?? tab.page.url());
    const topHost = hostOf(tab.page.url());
    // A sign-in box from another site inside this page is never filled.
    if (!host || host !== topHost) return undefined;
    const hints = await target
      .evaluate((el: { getAttribute(n: string): string | null }) =>
        [
          el.getAttribute('autocomplete'),
          el.getAttribute('name'),
          el.getAttribute('id'),
          el.getAttribute('aria-label'),
          el.getAttribute('placeholder'),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      )
      .catch(() => '');
    const want: 'password' | 'totp' | 'cardNumber' | 'cvv' | 'expiry' | 'cardholder' =
      secret === 'payment'
        ? /cvc|cvv|csc|security code/.test(hints)
          ? 'cvv'
          : /exp/.test(hints) || /expir/.test(element.toLowerCase())
            ? 'expiry'
            : /name/.test(hints)
              ? 'cardholder'
              : 'cardNumber'
        : /one-time-code|otp|2fa|verification|totp|\bcode\b/.test(hints) ||
            /code/.test(element.toLowerCase())
          ? 'totp'
          : 'password';
    // Locked: the person unlocks it from the chat, and this carries on.
    const show = (request: VaultRequest) => ctx.append({ type: 'vault.request', request });
    if (!(await passwords.ensureOpen(show, ctx.signal)))
      return {
        label: `Passwords stayed locked`,
        text: 'The user’s Passwords is locked and wasn’t unlocked. Ask them to unlock it, or hand the field to them.',
      };
    let chosen = itemId;
    if (!chosen) {
      const matches = await (
        secret === 'payment' ? passwords.cards() : passwords.matching(host)
      ).catch(() => []);
      if (!matches.length) return undefined;
      if (matches.length > 1)
        return {
          label: `Found ${matches.length} saved items for ${host}`,
          text: `The user has ${matches.length} saved items for ${host}: ${matches.map((m) => `“${m.title}”${m.subtitle ? ` (${m.subtitle})` : ''} id=${m.id}`).join('; ')}. Call browser_type again with \`item\` set to the right one, or ask the user which.`,
        };
      chosen = matches[0]?.id;
    }
    if (!chosen) return undefined;
    let policy: { ask: boolean; title: string; site: string };
    try {
      policy = await passwords.fillPolicy({ itemId: chosen, host, want });
    } catch (error) {
      return {
        label: `Didn’t fill “${element}”`,
        text: `${(error as Error).message} Hand the field to the user instead, or ask them.`,
      };
    }
    const what =
      want === 'totp'
        ? 'the one-time code'
        : want === 'cvv'
          ? 'the security code'
          : want === 'cardNumber'
            ? 'the card number'
            : want === 'expiry'
              ? 'the expiry date'
              : want === 'cardholder'
                ? 'the name on the card'
                : 'the password';
    if (policy.ask) {
      const box = await tab.boxOf(target);
      const picture = await tab.thumbnail(box);
      const shot = await service.saveShot(conversationId, picture?.jpeg);
      const decision = await ctx.ask({
        toolName: 'browser_fill',
        input: { site: policy.site, item: policy.title, field: want },
        summary: `fill ${what} for “${policy.title}” on ${policy.site}`,
        browser: {
          kind: 'fill',
          site: policy.site,
          url: tab.page.url(),
          title: await tab.page.title().catch(() => ''),
          action: `Fill ${what} for “${policy.title}”`,
          box: picture?.box,
          shot,
        },
      });
      if (decision === 'deny')
        return {
          label: `You didn’t fill “${element}”`,
          text: 'The user doesn’t want Conch to fill that from their passwords. Ask them how they’d like to continue.',
        };
      if (decision === 'allow-always') await passwords.allowAgent(chosen).catch(() => undefined);
    }
    const value = await passwords.fillValue({ itemId: chosen, host, want }).catch((e: Error) => e);
    if (value instanceof Error)
      return {
        label: `Couldn’t fill “${element}”`,
        text: `${value.message} Hand the field to the user instead.`,
      };
    await target.fill(value);
    // The account name goes in the same form, if that box is empty.
    if (want === 'password') {
      const username = target
        .locator('xpath=ancestor::form[1]')
        .locator(
          'input[autocomplete="username"], input[type="email"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[id*="user" i], input[id*="email" i]',
        )
        .first();
      const empty = await username.inputValue({ timeout: 1_000 }).then(
        (v) => v === '',
        () => false,
      );
      if (empty) {
        const user = await passwords
          .fillValue({ itemId: chosen, host, want: 'username' })
          .catch(() => undefined);
        if (user) await username.fill(user).catch(() => undefined);
      }
    }
    return {
      label: `Filled ${what} from Passwords`,
      text: `Conch filled ${what} from the user’s saved item “${policy.title}” (you never see it). Carry on.\n${await pageText(tab)}`,
    };
  };

  /** You type the secret yourself: the agent waits, then carries on. */
  const handoff = async (tab: Tab, reason: string): Promise<'done' | 'cancelled'> => {
    const handoffId = newId('handoff');
    const url = tab.page.url();
    tab.handoff = { handoffId, state: 'waiting', reason, url };
    ctx.append({ type: 'browser.handoff', handoff: tab.handoff });
    tab.setControl('user');
    const timeout = AbortSignal.timeout(HANDOFF_WAIT_MS);
    const either = AbortSignal.any([ctx.signal, timeout]);
    let outcome: 'done' | 'cancelled' = 'done';
    try {
      await tab.whenFree(either);
    } catch {
      outcome = 'cancelled';
    }
    tab.handoff = undefined;
    ctx.append({ type: 'browser.handoff', handoff: { handoffId, state: outcome, reason, url } });
    if (tab.control === 'user') tab.setControl('idle');
    return outcome;
  };

  /** A click (or Enter) that might start a download: offer to keep it. */
  const catchDownload = async (tab: Tab, act: () => Promise<void>): Promise<string> => {
    let download: Download | undefined;
    const onDownload = (d: Download) => (download = d);
    tab.page.on('download', onDownload);
    try {
      await act();
      await tab.page
        .waitForLoadState('domcontentloaded', { timeout: 5_000 })
        .catch(() => undefined);
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      tab.page.off('download', onDownload);
    }
    const started = download as Download | undefined;
    if (!started) return '';
    const name = started.suggestedFilename();
    try {
      await permit(tab, { action: `Download ${name}`, highStakes: true, kind: 'download' });
    } catch (error) {
      await started.cancel().catch(() => undefined);
      throw error;
    }
    const path = await service.saveDownload(started);
    return `Downloaded ${name} to ${path}.\n`;
  };

  const settle = async (page: Page) => {
    await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => undefined);
  };

  /** After an action: only what changed on the page (the whole page when it's a new one). */
  const pageText = async (tab: Tab) => (await readChanges(tab.page)).text;
  /** The whole page: on opening one, or when the agent asks for it. */
  const wholePage = async (tab: Tab, find?: string) => (await readPage(tab.page, { find })).text;

  const secretOf = async (locator: Locator): Promise<SecretKind | undefined> => {
    const value = await locator.getAttribute(SECRET_ATTR, { timeout: 2_000 }).catch(() => null);
    return value === 'password' || value === 'payment' || value === 'identity' ? value : undefined;
  };

  /** The control's own words (not the agent's description of it), for the high-stakes check. */
  const wordsOf = (locator: Locator) =>
    locator
      .evaluate(
        (el: { innerText?: string; value?: string; getAttribute(n: string): string | null }) =>
          (
            el.innerText ||
            el.getAttribute('aria-label') ||
            el.value ||
            el.getAttribute('title') ||
            ''
          )
            .trim()
            .slice(0, 120),
      )
      .catch(() => '');

  const open: HostTool<{ url: z.ZodString }> = {
    name: 'browser_open',
    description:
      'Open a web page in the browser (the user can watch). Give an address, or words to search the web for. Returns the page’s text and controls with [ref] handles.',
    input: { url: z.string().min(1).max(4096).describe('A web address, or words to search for.') },
    run: ({ url: raw }) => {
      const url = toUrl(raw);
      const host = displayHost(url);
      const searching = url.startsWith('https://html.duckduckgo.com/html/');
      return step(
        'open',
        {
          running: searching ? `Searching for “${raw.trim()}”` : `Opening ${host}`,
          done: searching ? `Searched for “${raw.trim()}”` : `Opened ${host}`,
        },
        async (tab) => {
          const verdict = await service.guard.navigation(url);
          if (!verdict.ok) throw new Refusal(verdict.message);
          await point(tab, 'open', `Opening ${host}`);
          try {
            await tab.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          } catch (error) {
            // Heavy pages: settle for the first byte, then read what's there.
            if (!/Timeout/i.test(String((error as Error).message))) throw error;
            await tab.page.goto(url, { waitUntil: 'commit', timeout: 30_000 });
          }
          await settle(tab.page);
          const declined = await service.declined(tab.page);
          return {
            text: `${declined ? `(Declined ${declined}’s cookie banner for the user.)\n` : ''}${await wholePage(tab)}`,
          };
        },
      );
    },
  };

  const read: HostTool<{ find: z.ZodOptional<z.ZodString> }> = {
    name: 'browser_read',
    description:
      'Read the whole page that’s open now: its text and controls with [ref] handles. Other browser actions answer with only what changed, so use this when you need to see everything again. Pass `find` to see only the parts that mention something.',
    input: {
      find: z.string().max(200).optional().describe('Only show lines mentioning this.'),
    },
    run: ({ find }) =>
      step(
        'read',
        { running: 'Reading the page', done: find ? `Looked for “${find}”` : 'Read the page' },
        async (tab) => ({ text: await wholePage(tab, find) }),
      ),
  };

  const click: HostTool<{ ref: typeof Ref; element: typeof Element }> = {
    name: 'browser_click',
    description:
      'Click an element on the page by its ref. Conch asks the user the first time you act on a site, and before anything significant (buying, sending, deleting).',
    input: { ref: Ref, element: Element },
    run: ({ ref, element }) =>
      step(
        'click',
        { running: `Clicking “${element}”`, done: `Clicked “${element}”` },
        async (tab) => {
          const target = locate(tab, ref);
          const words = await wordsOf(target);
          const box = await tab.boxOf(target);
          await permit(tab, {
            action: `Click “${words || element}”`,
            highStakes: isHighStakes(words) || isHighStakes(element),
            box,
          });
          await point(tab, 'click', `Clicking “${element}”`, box);
          let downloaded = '';
          try {
            downloaded = await catchDownload(tab, () => target.click({ timeout: 6_000 }));
          } catch (error) {
            if (!/intercepts pointer events/.test(String((error as Error).message))) throw error;
            // Usually a cookie banner or a menu: clear it and try once more.
            await declineCookies(tab.page).catch(() => undefined);
            await tab.page.keyboard.press('Escape').catch(() => undefined);
            downloaded = await catchDownload(tab, () => target.click({ timeout: 6_000 }));
          }
          await settle(tab.page);
          return { text: `${downloaded}${await pageText(tab)}` };
        },
      ),
  };

  const type: HostTool<{
    ref: typeof Ref;
    element: typeof Element;
    text: z.ZodString;
    submit: z.ZodOptional<z.ZodBoolean>;
    item: z.ZodOptional<z.ZodString>;
  }> = {
    name: 'browser_type',
    description:
      'Type into a field by its ref (replacing what’s there). Set `submit` to press Enter after. On a password, one-time code or card field, Conch fills it from the user’s saved Passwords (after asking them) or hands the field to the user; you never see or type those values yourself.',
    input: {
      ref: Ref,
      element: Element,
      text: z
        .string()
        .max(5_000)
        .describe('What to type. For a password or code field, leave it empty: Conch fills it.'),
      submit: z.boolean().optional().describe('Press Enter afterwards (e.g. to search).'),
      item: z
        .string()
        .max(300)
        .optional()
        .describe(
          'For a password, code or card field: the id of the saved item to fill it from (from passwords_find). Omit it and Conch picks the one saved for this site.',
        ),
    },
    run: ({ ref, element, text, submit, item }) =>
      step(
        'type',
        { running: `Typing in “${element}”`, done: `Typed in “${element}”` },
        async (tab) => {
          await markSecrets(tab.page);
          const target = locate(tab, ref);
          const secret = await secretOf(target);
          if (secret) {
            // A saved password for this site: Conch fills it, with the person's OK.
            const filled = await fillSaved(tab, target, element, secret, item);
            if (filled) return filled;
            // Secrets never pass through the model: the user types this one.
            const outcome = await handoff(
              tab,
              `Please type ${secretLabel(secret)} into “${element}”, then hand the browser back.`,
            );
            return {
              label:
                outcome === 'done'
                  ? `You filled in “${element}”`
                  : `Waited for you at “${element}”`,
              text:
                outcome === 'done'
                  ? `That field takes ${secretLabel(secret)}, so the user typed it themselves (you never see it). Carry on from here.\n${await pageText(tab)}`
                  : 'The user didn’t fill in the field. Ask them how they’d like to continue.',
            };
          }
          const box = await tab.boxOf(target);
          const formButton = submit
            ? await target
                .evaluate(
                  (el: {
                    form?: {
                      querySelector(s: string): { innerText?: string; value?: string } | null;
                    } | null;
                  }) => {
                    const button = el.form?.querySelector('[type=submit], button:not([type])');
                    return (button?.innerText || button?.value || '').trim().slice(0, 120);
                  },
                )
                .catch(() => '')
            : '';
          await permit(tab, {
            action:
              submit && formButton
                ? `Type in “${element}” and ${formButton.toLowerCase()}`
                : `Type in “${element}”`,
            highStakes: Boolean(submit) && isHighStakes(formButton),
            box,
          });
          await point(tab, 'type', `Typing in “${element}”`, box);
          try {
            await target.fill(text, { timeout: 6_000 });
          } catch {
            // Rich editors don't take `fill`: type it like a person.
            await target.click({ timeout: 4_000 });
            await target.pressSequentially(text, { delay: 8 });
          }
          let downloaded = '';
          if (submit) downloaded = await catchDownload(tab, () => target.press('Enter'));
          await settle(tab.page);
          return { text: `${downloaded}${await pageText(tab)}` };
        },
      ),
  };

  const press: HostTool<{ key: z.ZodString }> = {
    name: 'browser_press',
    description:
      'Press a key in the page: Enter, Escape, Tab, ArrowDown, PageDown, or a shortcut like Control+A.',
    input: { key: z.string().min(1).max(40).describe('A key name, e.g. "Enter" or "Escape".') },
    run: ({ key }) =>
      step('press', { running: `Pressing ${key}`, done: `Pressed ${key}` }, async (tab) => {
        const enter = /^enter$/i.test(key);
        const formButton = enter
          ? await tab.page
              .evaluate(
                'document.activeElement?.form?.querySelector("[type=submit], button:not([type])")?.innerText ?? ""',
              )
              .then(String)
              .catch(() => '')
          : '';
        await permit(tab, {
          action: enter && formButton ? `Press Enter (${formButton.trim()})` : `Press ${key}`,
          highStakes: enter && isHighStakes(formButton),
        });
        await point(tab, 'press', `Pressing ${key}`);
        const downloaded = await catchDownload(tab, () => tab.page.keyboard.press(key));
        await settle(tab.page);
        return { text: `${downloaded}${await pageText(tab)}` };
      }),
  };

  const select: HostTool<{ ref: typeof Ref; element: typeof Element; option: z.ZodString }> = {
    name: 'browser_select',
    description: 'Choose an option in a drop-down list by its ref and the option’s text.',
    input: {
      ref: Ref,
      element: Element,
      option: z.string().min(1).max(200).describe('The option to choose, as it reads.'),
    },
    run: ({ ref, element, option }) =>
      step(
        'select',
        {
          running: `Choosing “${option}” in “${element}”`,
          done: `Chose “${option}” in “${element}”`,
        },
        async (tab) => {
          const target = locate(tab, ref);
          const box = await tab.boxOf(target);
          await permit(tab, {
            action: `Choose “${option}” in “${element}”`,
            highStakes: false,
            box,
          });
          await point(tab, 'select', `Choosing “${option}”`, box);
          await target
            .selectOption({ label: option }, { timeout: 6_000 })
            .catch(() => target.selectOption(option, { timeout: 6_000 }));
          await settle(tab.page);
          return { text: await pageText(tab) };
        },
      ),
  };

  const scroll: HostTool<{
    direction: z.ZodEnum<{ up: 'up'; down: 'down' }>;
    ref: z.ZodOptional<typeof Ref>;
  }> = {
    name: 'browser_scroll',
    description:
      'Scroll the page up or down by most of a screen, or bring an element (by ref) into view.',
    input: {
      direction: z.enum(['up', 'down']),
      ref: Ref.optional(),
    },
    run: ({ direction, ref }) =>
      step(
        'scroll',
        { running: `Scrolling ${direction}`, done: `Scrolled ${direction}` },
        async (tab) => {
          await point(tab, 'scroll', `Scrolling ${direction}`);
          if (ref) await locate(tab, ref).scrollIntoViewIfNeeded({ timeout: 5_000 });
          else await tab.page.mouse.wheel(0, direction === 'down' ? 640 : -640);
          await new Promise((r) => setTimeout(r, 300));
          return { text: await pageText(tab) };
        },
      ),
  };

  const back: HostTool = {
    name: 'browser_back',
    description: 'Go back to the previous page.',
    input: {},
    run: () =>
      step('back', { running: 'Going back', done: 'Went back' }, async (tab) => {
        await point(tab, 'back', 'Going back');
        await tab.page.goBack({ waitUntil: 'domcontentloaded', timeout: 20_000 });
        await settle(tab.page);
        return { text: await pageText(tab) };
      }),
  };

  const screenshot: HostTool = {
    name: 'browser_screenshot',
    description:
      'Look at the page as a picture of what’s on screen (layout, pictures, charts, canvas, captchas). Prefer browser_read for text and controls. If your model can’t see pictures, you get a description from one that can. Secret fields are masked.',
    input: {},
    run: () =>
      step(
        'screenshot',
        { running: 'Looking at the page', done: 'Looked at the page' },
        async (tab) => {
          await markSecrets(tab.page);
          const mask = tab.page.frames().map((frame) => frame.locator(`[${SECRET_ATTR}]`));
          const image = await tab.page.screenshot({
            type: 'jpeg',
            quality: 70,
            mask,
            maskColor: '#9a8f88',
          });
          const title = await tab.page.title().catch(() => '');
          const size = tab.page.viewportSize();
          return {
            // One picture pixel is one CSS pixel (the browser runs at scale 1),
            // so a position read off the picture is a position on the page.
            text: `Screenshot of “${title}” (${tab.page.url()}): the visible part of the page${size ? `, ${size.width}×${size.height} pixels, x across from the left and y down from the top` : ''}.`,
            images: [{ data: image.toString('base64'), mimeType: 'image/jpeg' }],
          };
        },
      ),
  };

  const wait: HostTool<{ text: z.ZodOptional<z.ZodString>; seconds: z.ZodOptional<z.ZodNumber> }> =
    {
      name: 'browser_wait',
      description: 'Wait for some text to appear on the page (up to 20 s), or for a few seconds.',
      input: {
        text: z.string().max(200).optional().describe('Text to wait for.'),
        seconds: z.number().min(0.5).max(10).optional().describe('Or just wait this long.'),
      },
      run: ({ text, seconds }) =>
        step(
          'wait',
          {
            running: text ? `Waiting for “${text}”` : 'Waiting',
            done: text ? `Saw “${text}”` : 'Waited',
          },
          async (tab) => {
            if (text) {
              const found = await tab.page
                .getByText(text, { exact: false })
                .first()
                .waitFor({ state: 'visible', timeout: 20_000 })
                .then(() => true)
                .catch(() => false);
              if (!found)
                return {
                  text: `“${text}” didn’t appear within 20 seconds.\n${await pageText(tab)}`,
                  label: `“${text}” didn’t appear`,
                };
            } else {
              await new Promise((r) => setTimeout(r, (seconds ?? 2) * 1_000));
            }
            return { text: await pageText(tab) };
          },
        ),
    };

  const handOff: HostTool<{ reason: z.ZodString }> = {
    name: 'browser_handoff',
    description:
      'Hand the browser to the user for something only they should do (sign in, a captcha, payment, personal details) and wait until they hand it back. Say what they need to do in a short sentence.',
    input: {
      reason: z
        .string()
        .min(3)
        .max(200)
        .describe('What the user needs to do, e.g. "Sign in to your Google account".'),
    },
    run: ({ reason }) =>
      step(
        'handoff',
        { running: 'Waiting for you', done: 'You handed the browser back' },
        async (tab) => {
          const outcome = await handoff(tab, reason);
          if (outcome === 'cancelled') {
            return {
              label: 'Stopped waiting for you',
              text: 'The user didn’t take over (or stopped). Ask them how they’d like to continue.',
            };
          }
          await settle(tab.page);
          return { text: `The user is done. Carry on from here.\n${await pageText(tab)}` };
        },
      ),
  };

  const passkey: HostTool<{
    action: z.ZodEnum<{ sign_in: 'sign_in'; save: 'save' }>;
    item: z.ZodOptional<z.ZodString>;
  }> = {
    name: 'browser_passkey',
    description:
      'Use a passkey on the page that’s open. `sign_in`: Conch holds the user’s saved passkey for this site (after asking them); then click the site’s “Sign in with a passkey” button and Conch answers it. `save`: when the site offers to create a passkey, call this first, then click its button; the new passkey is kept in the user’s Passwords. You never see the key.',
    input: {
      action: z
        .enum(['sign_in', 'save'])
        .describe('Sign in with a saved passkey, or save a new one.'),
      item: z
        .string()
        .max(300)
        .optional()
        .describe('For sign_in with several saved: the item id Conch listed.'),
    },
    run: ({ action, item }) =>
      step(
        'type',
        action === 'sign_in'
          ? { running: 'Getting your passkey ready', done: 'Passkey ready' }
          : { running: 'Getting ready to save a passkey', done: 'Ready to save a passkey' },
        async (tab) => {
          const passwords = service.passwords;
          if (!passwords?.passkeysFor || !passwords.passkeyCredential || !passwords.savePasskey)
            throw new Refusal('Passkeys aren’t available here. Use the password instead.');
          const host = hostOf(tab.page.url());
          if (!host)
            throw new Refusal('Passkeys only work on a secure (https) page. Open the site first.');
          const show = (request: VaultRequest) => ctx.append({ type: 'vault.request', request });
          if (!(await passwords.ensureOpen(show, ctx.signal)))
            return {
              label: 'Passwords stayed locked',
              text: 'The user’s Passwords is locked and wasn’t unlocked. Ask them to unlock it, or to sign in themselves.',
            };
          const askFill = async (title: string, site: string, what: string) => {
            const picture = await tab.thumbnail();
            const shot = await service.saveShot(conversationId, picture?.jpeg);
            return ctx.ask({
              toolName: 'browser_fill',
              input: { site, item: title, field: 'passkey' },
              summary: `${what.charAt(0).toLowerCase()}${what.slice(1)} on ${site}`,
              browser: {
                kind: 'fill',
                site,
                url: tab.page.url(),
                title: await tab.page.title().catch(() => ''),
                action: what,
                shot,
              },
            });
          };
          if (action === 'save') {
            const decision = await askFill(
              host,
              host,
              `Make a passkey for ${host} and keep it in Passwords`,
            );
            if (decision === 'deny')
              return {
                label: 'You didn’t save a passkey',
                text: 'The user doesn’t want a passkey made here. Carry on without it.',
              };
            // Said in the chat once the site has made it (after this step ended).
            const note = (status: 'done' | 'error', label: string) =>
              ctx.append({
                type: 'browser.step',
                step: {
                  stepId: newId('step'),
                  status,
                  action: 'type',
                  label,
                  url: tab.page.url(),
                  title: '',
                  by: 'agent',
                },
              });
            await armCreate(tab.page, (credential) => {
              void passwords.savePasskey?.(credential, host).then(
                (saved) =>
                  note(
                    'done',
                    saved.created
                      ? `Saved a passkey for ${host} in Passwords`
                      : `Saved a passkey for ${host} to “${saved.title}”`,
                  ),
                () => note('error', `Couldn’t save the passkey for ${host}`),
              );
            });
            return {
              label: `Ready to save a passkey for ${host}`,
              text: `Conch’s browser will answer ${host}’s next “create a passkey” for the next 3 minutes and keep the passkey in the user’s Passwords. Now click the site’s button to create it.`,
            };
          }
          const saved = await passwords.passkeysFor(host).catch(() => []);
          const chosen = item ? saved.filter((p) => p.itemId === item) : saved;
          if (!chosen.length)
            return {
              label: `No passkey saved for ${host}`,
              text: `The user has no passkey saved for ${host}. Sign in with the password instead (browser_type fills it), or ask the user.`,
            };
          if (chosen.length > 1)
            return {
              label: `Found ${chosen.length} passkeys for ${host}`,
              text: `The user has ${chosen.length} passkeys for ${host}: ${chosen.map((p) => `“${p.title}”${p.userName ? ` (${p.userName})` : ''} id=${p.itemId}`).join('; ')}. Call browser_passkey again with \`item\` set to the right one, or ask the user which.`,
            };
          const pick = chosen[0];
          if (!pick) throw new Refusal('No passkey to use.');
          let policy: { ask: boolean; title: string; site: string };
          try {
            policy = (await passwords.passkeyPolicy?.(pick.itemId, pick.passkeyId, host)) ?? {
              ask: true,
              title: pick.title,
              site: host,
            };
          } catch (error) {
            return { label: 'Didn’t use the passkey', text: (error as Error).message };
          }
          if (policy.ask) {
            const decision = await askFill(
              policy.title,
              policy.site,
              `Sign in with the passkey for “${policy.title}”`,
            );
            if (decision === 'deny')
              return {
                label: 'You didn’t use the passkey',
                text: 'The user doesn’t want Conch to use that passkey. Ask them how they’d like to sign in.',
              };
            if (decision === 'allow-always')
              await passwords.allowAgent(pick.itemId).catch(() => undefined);
          }
          const credential = await passwords
            .passkeyCredential(pick.itemId, pick.passkeyId, host)
            .catch((e: Error) => e);
          if (credential instanceof Error)
            return { label: 'Couldn’t use the passkey', text: credential.message };
          await armSignIn(tab.page, credential, (signCount) => {
            void passwords
              .passkeyUsed?.(pick.itemId, credential.credentialId, signCount)
              .catch(() => undefined);
          });
          return {
            label: `Passkey for “${policy.title}” ready`,
            text: `Conch’s browser holds the passkey for “${policy.title}” for the next 3 minutes, for ${policy.site} only (you never see it). Now click the site’s passkey sign-in button (“Sign in with a passkey”, or the sign-in button if it offers one); Conch answers it.`,
          };
        },
      ),
  };

  const all = [
    open,
    read,
    click,
    type,
    passkey,
    press,
    select,
    scroll,
    back,
    screenshot,
    wait,
    handOff,
  ] as HostTool[];
  for (const t of all) t.searchHint = 'browser web page website';
  // A browsing task starts with these, so they're there without a tool search first.
  for (const t of [open, read, click, type] as HostTool[]) t.alwaysLoad = true;
  return all;
}
