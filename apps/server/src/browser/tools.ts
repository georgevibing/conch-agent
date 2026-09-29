import type { BrowserActionKind, BrowserBox, BrowserPermission } from '@conch/protocol';
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
import { markSecrets, readPage } from './snapshot';
import type { Tab } from './tab';

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

const Ref = z
  .string()
  .regex(/^[a-z0-9]{1,16}$/i, 'Use a ref from the page text, like e12.')
  .describe('The element’s ref from the page text, e.g. "e12".');
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
      const shot = await service.saveShot(conversationId, await tab.thumbnail());
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
    if (kind === 'site') {
      if (ctx.permissionMode === 'bypassPermissions') return;
      if (tab.sites.has(site) || (await service.store.trusts(site))) return;
    }
    const shot = await service.saveShot(conversationId, await tab.thumbnail());
    const title = await tab.page.title().catch(() => '');
    const decision = await ctx.ask({
      toolName: `browser_${kind}`,
      input: { site, action: request.action, url },
      summary:
        kind === 'site'
          ? `use ${site}`
          : `${request.action.charAt(0).toLowerCase()}${request.action.slice(1)} on ${site}`,
      browser: { kind, site, url, title, action: request.action, box: request.box, shot },
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

  const pageText = async (tab: Tab, find?: string) => (await readPage(tab.page, { find })).text;

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
            text: `${declined ? `(Declined ${declined}’s cookie banner for the user.)\n` : ''}${await pageText(tab)}`,
          };
        },
      );
    },
  };

  const read: HostTool<{ find: z.ZodOptional<z.ZodString> }> = {
    name: 'browser_read',
    description:
      'Read the page that’s open now: its text and controls with [ref] handles. Pass `find` to see only the parts that mention something.',
    input: {
      find: z.string().max(200).optional().describe('Only show lines mentioning this.'),
    },
    run: ({ find }) =>
      step(
        'read',
        { running: 'Reading the page', done: find ? `Looked for “${find}”` : 'Read the page' },
        async (tab) => ({ text: await pageText(tab, find) }),
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
  }> = {
    name: 'browser_type',
    description:
      'Type into a field by its ref (replacing what’s there). Set `submit` to press Enter after. Never use it for passwords, codes or card numbers: Conch hands those fields to the user.',
    input: {
      ref: Ref,
      element: Element,
      text: z.string().max(5_000).describe('What to type.'),
      submit: z.boolean().optional().describe('Press Enter afterwards (e.g. to search).'),
    },
    run: ({ ref, element, text, submit }) =>
      step(
        'type',
        { running: `Typing in “${element}”`, done: `Typed in “${element}”` },
        async (tab) => {
          await markSecrets(tab.page);
          const target = locate(tab, ref);
          const secret = await secretOf(target);
          if (secret) {
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
      'Look at the page as an image (for layout, pictures, charts). Prefer browser_read for text. Secret fields are masked.',
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
          return {
            text: `Screenshot of “${title}” (${tab.page.url()}). If you can’t see the image, use browser_read instead.`,
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

  return [
    open,
    read,
    click,
    type,
    press,
    select,
    scroll,
    back,
    screenshot,
    wait,
    handOff,
  ] as HostTool[];
}
