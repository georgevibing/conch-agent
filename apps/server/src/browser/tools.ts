import { AsyncLocalStorage } from 'node:async_hooks';

import type {
  BrowserActionKind,
  BrowserBox,
  BrowserPageDialog,
  BrowserPermission,
  VaultRequest,
} from '@conch/protocol';
import type { Download, Locator, Page, Response } from 'playwright-core';
import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import { ownWords } from '../conversations/risk';
import { consented, names } from '../vault/consent';
import type { HostTool, HostToolResult } from '../engines/types';
import { newId } from '../lib/ids';
import { declineCookies } from './cookies';
import {
  asksDownload,
  capFrom,
  namesDocument,
  namesSite,
  PaymentYes,
  reviewableClick,
  showsCharge,
  spendsMoney,
  totalOnPage,
  withinCap,
} from './consent';
import { agentFill, chainFromClick, pageSignInNote, type AgentFillDeps } from './fill';
import { focused, targetAt } from './point';
import { asksHighStakes, isHighStakes, SECRET_ATTR, secretLabel, type SecretKind } from './risk';
import { BrowserProblemError } from './runtime';
import { plainNavigationError, toUrl, type BrowserService } from './service';
import { displayHost, siteOf } from './site';
import { armCreate, armSignIn } from './passkeys';
import { keptIn, passkeyHandoffReason, signInSteps } from './signin';
import { markSecrets, readChanges, readPage, reviewPage } from './snapshot';
import { MAX_TABS, quoteDialog, type DialogAnswer, type Tab } from './tab';
import { resolveUploads, UploadRefused, type UploadFile } from './uploads';
import { watchHandoff } from './handoff';
import { throughBotCheck } from './bot-check';
import { shootPage } from './shot';
import { BrowserStepBudget, BrowserStepStopped } from './step-budget';

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

/** A failure that provably left the page alone: the ref is gone, the site was never reached. */
class Untouched extends Error {}

/** Steps that only look: a failure there is a failed look, never an action that may have happened. */
const LOOKS: ReadonlySet<BrowserActionKind> = new Set(['read', 'screenshot', 'wait', 'scroll']);

/** The address never reached a server: nothing was sent to the site. */
const UNREACHED =
  /net::ERR_(NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|CONNECTION_REFUSED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED)|NS_ERROR_(UNKNOWN_HOST|CONNECTION_REFUSED)/;

/** A tab that went away before work began can be reopened without replaying an action. */
const CLOSED =
  /Target page, context or browser has been closed|Target closed|Browser has been closed/i;

/** How long the agent's cursor lingers before acting, when someone is watching. */
const WATCHED_PAUSE_MS = 420;
/** More than a search, a size or a name: typed after reading, it could carry what was read. */
const LONG_TYPING = 300;

/** What each chat's tab was already told about signing in, so a page doesn't say it twice. */
const signInSaid = new WeakMap<Tab, Set<string>>();

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
/** How to use the pointer on something. */
const How = z
  .enum(['click', 'double', 'right', 'hover', 'drag'])
  .optional()
  .describe(
    'click (default), double (double-click), right (right-click), hover (point at it without clicking, e.g. to open a menu), or drag (drag it onto `to`).',
  );

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

export function browserTools(
  service: BrowserService,
  context: ToolContext,
  { timeoutMs = 120_000 } = {},
): HostTool[] {
  const active = new AsyncLocalStorage<BrowserStepBudget>();
  const waiting = <T>(label: string, work: () => Promise<T>): Promise<T> =>
    active.getStore()?.wait(label, work) ?? work();
  const ctx: ToolContext = {
    ...context,
    get signal() {
      return active.getStore()?.signal ?? context.signal;
    },
    ask: (request) => waiting('Waiting for your approval', () => context.ask(request)),
  };
  const check = () => {
    active.getStore()?.check();
    ctx.signal.throwIfAborted();
  };
  /** Steps that reached the page: from here on, a failure may have done something there. */
  const acted = new WeakSet<BrowserStepBudget>();
  /** Mark the moment this step acts (the cursor at the control, the person handed the browser). */
  const acting = () => {
    check();
    const budget = active.getStore();
    if (budget) acted.add(budget);
  };
  /**
   * Which page an action is on, for a task's ledger (ADR 0033): this turn's tools and
   * every step that reached a tab. Pressing Enter twice, or the same ref on a newer page,
   * is a new action; only a call whose step never reached a tab keeps its place.
   */
  const session = newId('pages');
  let generation = 0;
  const { conversationId } = ctx;
  /** The person said yes to something significant in this step: the site's own "Are you sure?" after it doesn't ask again. */
  let vouched = false;
  /** One card for a payment (ADR 0131, 2026-10-27): a yes to one half of a checkout carries the other. */
  const payments = new PaymentYes();
  /**
   * Auto or Full trust, with the person here and nobody else's words in the chat: the only
   * time their own words can stand in for a card. Your own Chrome keeps every card.
   */
  // Someone can answer: the chat, a task from it, or the owner's own chat app (ADR 0151).
  const answerable = () => !ctx.unattended || ctx.attended === true;
  const yoursToSay = () =>
    (ctx.permissionMode === 'auto' || ctx.permissionMode === 'bypassPermissions') &&
    answerable() &&
    !service.runtime.backend.shared &&
    !(ctx.taints?.().some((source) => source.kind === 'person') ?? false);
  /** The words the page shows, for its total: what the person sees, not the model's account of it. */
  const visibleText = (tab: Tab) =>
    tab.page
      .locator('body')
      .innerText({ timeout: 3_000 })
      .catch(() => '');
  /** The page asks money for this: a total, a price a month, a deposit (ADR 0131). */
  const charges = async (tab: Tab) => showsCharge(await visibleText(tab));
  /** The page's own total is inside a limit the person named ("buy it if under $50"). */
  const withinTheirLimit = async (tab: Tab): Promise<boolean> => {
    if (!yoursToSay()) return false;
    const cap = capFrom(ctx.said?.() ?? []);
    if (!cap) return false;
    const total = totalOnPage(await visibleText(tab));
    return Boolean(total && withinCap(cap, total));
  };

  const locate = (tab: Tab, ref: string): Locator => tab.page.locator(`aria-ref=${ref}`);
  /** A ref to act on, which must still be on the page: a gone one fails before anything is done. */
  const present = async (tab: Tab, ref: string): Promise<Locator> => {
    const target = locate(tab, ref);
    if (!(await target.count().catch(() => 0)))
      throw new Untouched(
        'That element isn’t on the page any more: the page changed. Read the page again and use a fresh ref.',
      );
    return target;
  };

  /** Wait a beat so the agent's cursor visibly reaches the control, if anyone's watching. */
  const point = async (
    tab: Tab,
    action: BrowserActionKind,
    label: string,
    box?: BrowserBox,
  ): Promise<void> => {
    acting();
    tab.announce({ type: 'action', action, label, box });
    if (tab.watched) await new Promise((r) => setTimeout(r, WATCHED_PAUSE_MS));
    check();
  };

  /** The one door every browser action goes through, on every provider. */
  const step = async (
    action: BrowserActionKind,
    labels: { running: string; done: string },
    work: (tab: Tab) => Promise<Outcome>,
  ): Promise<string | HostToolResult> => {
    let tab: Tab | undefined;
    let ended = false;
    let budget: BrowserStepBudget | undefined;
    const stepId = newId('step');
    const log = (
      status: 'running' | 'waiting' | 'done' | 'error',
      label: string,
      shot?: string,
      title = '',
    ) => {
      if (ended) return;
      ctx.append({
        type: 'browser.step',
        step: {
          stepId,
          status,
          action,
          label,
          url: tab?.current?.url() ?? '',
          title,
          shot,
          by: 'agent',
        },
      });
      ended = status === 'done' || status === 'error';
    };
    log('running', 'Starting the browser');
    try {
      return await service.steps.run(
        conversationId,
        context.signal,
        () => log('waiting', 'Waiting for the previous browser step'),
        async () => {
          const own = new BrowserStepBudget(context.signal, {
            timeoutMs,
            state: (label) => log(label ? 'waiting' : 'running', label ?? labels.running),
            cancel: (humanWait) => {
              if (tab && !humanWait) service.cancelStep(tab);
            },
          });
          budget = own;
          const execute = async (attempt = 0): Promise<string | HostToolResult> => {
            let workStarted = false;
            try {
              tab = await service.tabFor(conversationId);
              // Opening the browser may finish after a cancellation. Close that late tab too.
              if (ctx.signal.aborted) service.cancelStep(tab);
              check();
              const current = tab;
              if (current.control === 'user')
                await waiting('Waiting for you to hand the browser back', () =>
                  current.whenFree(ctx.signal),
                );
              else await current.whenFree(ctx.signal);
              check();
              const touched = current.touched;
              current.touched = false;
              current.setControl('agent');
              // The page's dialogs during this step are the agent's to answer (ADR 0131).
              vouched = false;
              current.answerer = (dialog) => answerDialog(current, dialog);
              current.lastUsed = Date.now();
              log('running', labels.running);
              current.opened.length = 0;
              current.evicted.length = 0;
              // Once work starts, its external effects may be uncertain even if reading
              // the result or saving a thumbnail fails. Never replay the whole action.
              workStarted = true;
              const outcome = await work(current);
              await current.dialogsSettled();
              check();
              const shot = current.closed
                ? undefined
                : await service.saveShot(conversationId, (await current.thumbnail())?.jpeg);
              const title = current.closed ? '' : await current.page.title().catch(() => '');
              check();
              log('done', outcome.label ?? labels.done, shot, title);
              const notes: string[] = [];
              if (touched)
                notes.push(
                  '(The user used the browser themselves since your last step, so the page may have changed.)',
                );
              const opened = current.opened.splice(0).filter((id) => current.entry(id));
              if (opened.length)
                notes.push(
                  `(That opened a new tab, ${opened.join(', ')}, which is in view now. browser_tabs switches back.)`,
                );
              const evicted = current.evicted.splice(0);
              if (evicted.length)
                notes.push(
                  `(A chat keeps ${MAX_TABS} tabs, so Conch closed the one unused longest: ${evicted.join(', ')}.)`,
                );
              notes.push(...current.dialogNotes.splice(0));
              const note = notes.length ? `${notes.join('\n')}\n` : '';
              return outcome.images
                ? { text: note + outcome.text, images: outcome.images }
                : note + outcome.text;
            } catch (error) {
              check(); // A timeout or Stop must never enter automatic crash recovery.
              const closed =
                !(error instanceof Refusal) && CLOSED.test(String((error as Error)?.message));
              if (closed && workStarted) {
                throw new Error(
                  acted.has(own) || LOOKS.has(action)
                    ? 'The browser closed during this step. It may have acted on the site before closing. Check the page before repeating the action.'
                    : 'The browser closed before this step did anything on the page, so nothing happened there. Try it again.',
                  { cause: error },
                );
              }
              if (closed && attempt === 0) {
                log('running', 'The browser restarted; opening the page again');
                service.runtime.heal('Restarted the browser mid-step');
                await service.forgetTab(conversationId);
                check();
                return execute(1);
              }
              throw error;
            } finally {
              if (tab) tab.answerer = undefined;
              if (tab?.control === 'agent') tab.setControl('idle');
              // The page this turn's next action sees is a newer one.
              if (workStarted) generation += 1;
            }
          };
          return active.run(own, () => own.run(() => execute()));
        },
      );
    } catch (error) {
      // An action that never reached the page (refused, its element gone, held up before
      // acting) says so: a task's ledger keeps it as never run, not as an action that may
      // have happened and so blocks the task's next ones (ADR 0033). Looks never act.
      const untouched =
        !LOOKS.has(action) && (error instanceof Untouched || !(budget && acted.has(budget)));
      const message = context.signal.aborted
        ? 'Stopped.'
        : error instanceof BrowserStepStopped && error.timedOut && untouched
          ? 'The browser took too long, so Conch stopped this step before it did anything on the page. Nothing happened there; try it again.'
          : error instanceof BrowserStepStopped ||
              error instanceof Refusal ||
              error instanceof Untouched
            ? error.message
            : error instanceof BrowserProblemError
              ? `The browser isn’t available: ${error.problem.message}`
              : explain(error);
      log('error', message);
      // A plain result is success to every provider. Only deliberate refusals are
      // successful answers; cancellation and uncertain execution must stay errors.
      if (context.signal.aborted) throw new BrowserStepStopped(false);
      if (error instanceof Refusal)
        return untouched ? { text: message, effect: 'not-executed' } : message;
      if (untouched) return { text: message, isError: true, effect: 'not-executed' };
      if (error instanceof BrowserStepStopped) throw error;
      throw new Error(message, { cause: error });
    }
  };

  /** Ask before acting on a site, and always before something significant. */
  const permit = async (
    tab: Tab,
    request: {
      action: string;
      highStakes: boolean;
      box?: BrowserBox;
      kind?: 'download' | 'upload';
      /** Typing a long text: after reading, it could carry what was read (ADR 0117). */
      carries?: boolean;
      /** No thumbnail: a page with a dialog showing is frozen, and can't be pictured. */
      picture?: false;
      /** A resolved click: its full page is review evidence, not permission. */
      reviewClick?: boolean;
    },
  ): Promise<void> => {
    check();
    const url = tab.page.url();
    const site = siteOf(url) ?? displayHost(url);
    if (ctx.permissionMode === 'plan') {
      throw new Refusal(
        'This chat is in Read only mode, so you can read pages but not click, type or choose. Tell the user what you’d do instead.',
      );
    }
    const kind: BrowserPermission['kind'] =
      request.kind ?? (request.highStakes ? 'high-stakes' : 'site');
    // Read something untrusted (ADR 0028): even a trusted site asks once per site (Full trust
    // doesn't, in a chat you're in: `untrusted` is empty there unless someone else spoke).
    // An upload sends the person's files out: it carries the same note when the chat read something.
    const looked = kind === 'site' || kind === 'upload' || kind === 'download';
    const read = looked ? ctx.untrusted?.() : undefined;
    const held = looked ? await ctx.restricted?.('browser') : undefined;
    const untrusted = read ?? held;
    // Your own Chrome is signed in to your life (ADR 0080): each site asks once per chat, always.
    const own = service.runtime.backend.shared;
    // Full trust and Auto use a site, and download or upload there, without asking until the
    // chat reads something that could be steering them (ADR 0100). Paying, sending or deleting
    // on a site (`high-stakes`) asks in every mode.
    const goesAhead =
      !untrusted &&
      !own &&
      (ctx.permissionMode === 'bypassPermissions' || ctx.permissionMode === 'auto');
    // Auto after reading, a person here and only things read (ADR 0117): clicking, choosing
    // and typing on a site is reading it further: a filter, a size, a search. What matters
    // still asks: paying, sending or deleting (`high-stakes`, in every mode), a long text
    // typed in (it could carry what was read), an upload and a download.
    const someone = ctx.taints?.().some((source) => source.kind === 'person') ?? false;
    const browsing =
      ctx.permissionMode === 'auto' &&
      answerable() &&
      !someone &&
      !held &&
      !own &&
      !request.carries;
    if (kind === 'site') {
      if (tab.sites.has(site)) return;
      if (goesAhead || browsing) return;
      if (!untrusted && !own && (await service.store.trusts(site))) return;
    }
    if ((kind === 'download' || kind === 'upload') && goesAhead) return;
    // A download the person's own latest words asked for goes after reading too: it lands in
    // Conch's downloads, read as untrusted. An upload sends their files out, so it still asks.
    if (kind === 'download' && browsing && asksDownload(ownWords(ctx.said?.().at(-1) ?? '')))
      return;
    const picture = request.picture === false ? undefined : await tab.thumbnail(request.box);
    const shot = await service.saveShot(conversationId, picture?.jpeg);
    const title = await tab.page.title().catch(() => '');
    // Only a resolved communication click is eligible here. Payment, access changes,
    // upload contents and typed-but-not-yet-applied payloads keep their own consent.
    // Money stays out: a label about it (`spendsMoney`), or a "Book now" or "Subscribe" beside
    // a price on the page ("€384 total", "$9.99/month", "€20 deposit"), which is paying by
    // another name. Its card, or a limit named below.
    const pays =
      kind === 'high-stakes' &&
      (spendsMoney(request.action) || (request.reviewClick === true && (await charges(tab))));
    const review =
      ctx.permissionMode === 'auto' && !own && !someone && request.reviewClick && !pays
        ? await reviewPage(tab.page)
        : undefined;
    // Paying, once the person settled it: a yes to the saved card on this site a moment ago,
    // or a total on the page inside the limit they named. Never the model's word for either.
    if (pays && yoursToSay()) {
      if (payments.take(site) || (await withinTheirLimit(tab))) {
        tab.sites.add(site);
        vouched = true;
        return;
      }
    }
    const decision = await ctx.ask({
      toolName: `browser_${kind}`,
      input: { site, action: request.action, url, ...(review && { page: review }) },
      ...(review && {
        revalidate: async () => !ctx.signal.aborted && (await reviewPage(tab.page)) === review,
      }),
      summary:
        kind === 'site'
          ? `use ${site}`
          : `${request.action.charAt(0).toLowerCase()}${request.action.slice(1)} on ${site}`,
      browser: {
        kind,
        site,
        url,
        title,
        action: request.action,
        box: picture?.box,
        shot,
        ...(own && { ownChrome: true }),
        // An errand's own browser (ADR 0141): Allow also lends this site's sign-in.
        ...(kind === 'site' && service.lendsSignIn(conversationId) && { lendsSignIn: true }),
      },
      ...(untrusted && { taint: `${untrusted} So I’m checking before I act on ${site}.` }),
    });
    if (decision === 'deny') {
      throw new Refusal(
        kind === 'site'
          ? `The user doesn’t want you acting on ${site}. You can still read it. Don’t try another way; ask what they’d like instead.`
          : `The user said no to “${request.action}”. Don’t try another way; ask what they’d like instead.`,
      );
    }
    if (kind === 'site' || kind === 'high-stakes') tab.sites.add(site);
    // The person's press lends the site's sign-in to this errand, never Auto by itself.
    if (kind === 'site') await service.lendSignIn(conversationId, site);
    if (kind === 'high-stakes') vouched = true;
    // The person's yes to the order covers filling the saved card on this checkout.
    if (pays) payments.agreed(site);
    // "Always" in your own Chrome stays this chat's: it never grants a site for good there.
    if (decision === 'allow-always' && kind === 'site' && !own) await service.grantSite(site);
  };

  /**
   * What a fill from Passwords needs from this turn (ADR 0130, `fill.ts`): the
   * chat's mode and questions, the Unlock card, and the page's picture for the
   * card. Undefined when there are no Passwords.
   */
  const fillDeps = (tab: Tab): AgentFillDeps | undefined => {
    const passwords = service.passwords;
    if (!passwords) return undefined;
    const show = (request: VaultRequest) => ctx.append({ type: 'vault.request', request });
    return {
      passwords,
      permissionMode: ctx.permissionMode,
      ask: ctx.ask,
      untrusted: () => ctx.untrusted?.(),
      // Locked: the person unlocks it from the chat, and this carries on.
      unlock: () =>
        waiting('Waiting for you to unlock Passwords', () =>
          passwords.ensureOpen(show, ctx.signal),
        ),
      picture: async (target) => {
        const picture = await tab.thumbnail(await tab.boxOf(target));
        const shot = await service.saveShot(conversationId, picture?.jpeg);
        return { ...(picture?.box && { box: picture.box }), ...(shot && { shot }) };
      },
      check,
      consent: {
        // The person's own message named this site or the item ("order the ink on Amazon",
        // "sign in to Hetzner"), or Full trust: signing in there is part of what they asked.
        // The fill still only goes to the item's own site, over https; a lookalike is refused.
        signIn: (title, host) => {
          if (!yoursToSay()) return false;
          const site = siteOf(`https://${host}`) ?? host;
          return (
            consented(ctx, title) ||
            (ctx.said?.() ?? []).some(
              (message) => names(message, title) || namesSite(message, site),
            )
          );
        },
        // Your details: the person named the saved identity or passport, or Full trust.
        identity: (title) =>
          yoursToSay() &&
          (consented(ctx, title) ||
            (ctx.permissionMode === 'auto' &&
              !ctx.untrusted?.() &&
              (ctx.said?.() ?? []).some((message) => namesDocument(ownWords(message), title)))),
        payment: async (host) => {
          if (!yoursToSay()) return false;
          const site = siteOf(`https://${host}`) ?? host;
          return payments.take(site) || (await withinTheirLimit(tab));
        },
        paid: (host) => payments.agreed(siteOf(`https://${host}`) ?? host),
      },
    };
  };

  /** You type the secret yourself: the agent waits, then carries on. */
  const handoff = async (tab: Tab, reason: string): Promise<'done' | 'auto' | 'cancelled'> => {
    // The person may do anything there: what follows is no longer provably untouched.
    acting();
    const handoffId = newId('handoff');
    const url = tab.page.url();
    // A sign-in or a captcha: it carries on by itself once that's behind you.
    let auto = false;
    const unwatch = await watchHandoff(tab, () => {
      auto = true;
      tab.setControl('idle');
    }).catch(() => () => undefined);
    if (ctx.signal.aborted) {
      unwatch();
      check();
    }
    tab.handoff = { handoffId, state: 'waiting', reason, url };
    ctx.append({ type: 'browser.handoff', handoff: tab.handoff });
    tab.setControl('user');
    tab.lastInput = Date.now();
    const timeout = AbortSignal.timeout(HANDOFF_WAIT_MS);
    const either = AbortSignal.any([ctx.signal, timeout]);
    let outcome: 'done' | 'auto' | 'cancelled' = 'done';
    try {
      await waiting('Waiting for you in the browser', () => tab.whenFree(either));
      if (auto) outcome = 'auto';
    } catch {
      outcome = 'cancelled';
    } finally {
      unwatch();
    }
    tab.handoff = undefined;
    ctx.append({
      type: 'browser.handoff',
      handoff: {
        handoffId,
        state: outcome === 'cancelled' ? 'cancelled' : 'done',
        reason,
        url,
        ...(outcome === 'auto' && { auto: true }),
      },
    });
    if (tab.control === 'user' && !context.signal.aborted) tab.setControl('idle');
    return outcome;
  };

  /**
   * The page's own dialog during the agent's step (ADR 0131). A message is
   * closed and passed on. "Leave this page?" leaves: going was the agent's step.
   * A question ("Remove 3 items?") is answering the site, so it's asked like any
   * act there: the site question, and the person's yes when its words are
   * significant (unless they just said yes to this very thing). A text box of
   * the page's own gets Cancel: Conch never types into one.
   */
  const answerDialog = async (tab: Tab, dialog: BrowserPageDialog): Promise<DialogAnswer> => {
    const said = quoteDialog(dialog.message);
    const note = (text: string) => tab.dialogNotes.push(text);
    if (dialog.kind === 'alert') {
      note(`(The page showed a message: ${said}. Conch closed it.)`);
      return { accept: true };
    }
    if (dialog.kind === 'leave') {
      note('(The page warned that leaving could lose what was typed there. Conch left it.)');
      return { accept: true };
    }
    if (dialog.kind === 'prompt') {
      note(
        `(The page asked for text in a box of its own: ${said}. Conch can’t type there, so it answered Cancel. Look for another way on the page, or ask the user.)`,
      );
      return { accept: false };
    }
    try {
      await permit(tab, {
        action: `Say OK to ${said}`,
        highStakes: !vouched && asksHighStakes(dialog.message),
        picture: false,
      });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      note(
        ctx.permissionMode === 'plan'
          ? `(The page asked ${said}. This chat is in Read only mode, so Conch answered Cancel.)`
          : `(The page asked ${said}. The user said no, so Conch answered Cancel. Don’t try another way; ask what they’d like instead.)`,
      );
      return { accept: false };
    }
    note(`(The page asked ${said}, and Conch answered OK.)`);
    return { accept: true };
  };

  /**
   * An action the page's dialog held up: it waited behind the question (a
   * click times out there), which isn't a failure once the question is answered.
   */
  const throughDialogs = async (tab: Tab, act: () => Promise<unknown>): Promise<void> => {
    const before = tab.dialogsOpened;
    try {
      await act();
    } catch (error) {
      if (tab.dialogsOpened === before || !/Timeout/i.test(String((error as Error)?.message)))
        throw error;
    }
    await tab.dialogsSettled();
  };

  /** A click (or Enter) that might start a download: offer to keep it. */
  const catchDownload = async (tab: Tab, act: () => Promise<void>): Promise<string> => {
    let download: Download | undefined;
    const onDownload = (d: Download) => (download = d);
    tab.page.on('download', onDownload);
    try {
      await throughDialogs(tab, act);
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

  /** Open an address; a heavy page settles for its first byte, and is read as it is. */
  const goTo = async (page: Page, url: string): Promise<Response | null> => {
    try {
      try {
        return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (error) {
        if (!/Timeout/i.test(String((error as Error).message))) throw error;
        return await page.goto(url, { waitUntil: 'commit', timeout: 30_000 });
      }
    } catch (error) {
      if (UNREACHED.test(String((error as Error)?.message)))
        throw new Untouched(plainNavigationError(error as Error));
      throw error;
    }
  };

  const settle = async (page: Page) => {
    await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => undefined);
  };

  /** Which tab this is, when there's more than one. */
  const withTabs = async (tab: Tab, text: string) => {
    if (tab.tabs.length < 2) return text;
    const list = await tab.list();
    const tabs = list
      .map((t) => `${t.id}${t.active ? ' (in view)' : ''}: ${t.title || t.url || 'a new tab'}`)
      .join(' · ');
    return `Tabs: ${tabs}\n${text}`;
  };
  /**
   * Conch's word on signing in, beside the page (ADR 0133): "Product Hunt signs in
   * with Google: click “Continue with Google” [ref=e12]…". Once per page and thing said.
   */
  const signInNote = async (tab: Tab, text: string): Promise<string> => {
    const note = await pageSignInNote(service.passwords, tab, text).catch(() => undefined);
    if (!note) return '';
    const said = signInSaid.get(tab) ?? new Set<string>();
    signInSaid.set(tab, said);
    const key = `${tab.page.url().split('#')[0]}\n${note}`;
    if (said.has(key)) return '';
    said.add(key);
    if (said.size > 50) said.delete(said.values().next().value as string);
    return `\n(${note})`;
  };
  /** After an action: only what changed on the page (the whole page when it's a new one). */
  const pageText = async (tab: Tab) => {
    await tab.dialogsSettled();
    const text = (await readChanges(tab.page)).text;
    return withTabs(tab, `${text}${await signInNote(tab, text)}`);
  };
  /** The whole page: on opening one, or when the agent asks for it (a part at a time when it's long). */
  const wholePage = async (tab: Tab, options: { find?: string; part?: number } = {}) => {
    await tab.dialogsSettled();
    const text = (await readPage(tab.page, options)).text;
    return withTabs(tab, `${text}${await signInNote(tab, text)}`);
  };

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
          const response = await goTo(tab.page, url);
          await settle(tab.page);
          const checked = await throughBotCheck(tab.page, response, { signal: ctx.signal });
          const declined = await service.declined(tab.page);
          return {
            text: `${checked}${declined ? `(Declined ${declined}’s cookie banner for the user.)\n` : ''}${await wholePage(tab)}`,
          };
        },
      );
    },
  };

  const read: HostTool<{ find: z.ZodOptional<z.ZodString>; part: z.ZodOptional<z.ZodNumber> }> = {
    name: 'browser_read',
    effect: 'read',
    description:
      'Read the whole page that’s open now: its text and controls with [ref] handles. Other browser actions answer with only what changed, so use this when you need to see everything again. Pass `find` to see only the parts that mention something. A long page comes in parts: `part` reads the next one.',
    input: {
      find: z.string().max(200).optional().describe('Only show lines mentioning this.'),
      part: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe('For a long page: which part to read (1 is the start).'),
    },
    run: ({ find, part }) =>
      step(
        'read',
        {
          running: part && part > 1 ? `Reading part ${part} of the page` : 'Reading the page',
          done: find
            ? `Looked for “${find}”`
            : part && part > 1
              ? `Read part ${part} of the page`
              : 'Read the page',
        },
        async (tab) => ({ text: await wholePage(tab, { find, part }) }),
      ),
  };

  const click: HostTool<{
    ref: typeof Ref;
    element: typeof Element;
    how: typeof How;
    to: z.ZodOptional<typeof Ref>;
  }> = {
    name: 'browser_click',
    description:
      'Click an element on the page by its ref. `how` also double-clicks, right-clicks, hovers (to open a menu) or drags it onto another element (`to`). Conch asks the user the first time you act on a site, and before anything significant (buying, sending, deleting).',
    input: {
      ref: Ref,
      element: Element,
      how: How,
      to: Ref.optional().describe('For drag: the ref of the element to drop it on.'),
    },
    run: ({ ref, element, how = 'click', to }) => {
      const words = {
        click: ['Clicking', 'Clicked'],
        double: ['Double-clicking', 'Double-clicked'],
        right: ['Right-clicking', 'Right-clicked'],
        hover: ['Pointing at', 'Pointed at'],
        drag: ['Dragging', 'Dragged'],
      }[how];
      const action: BrowserActionKind =
        how === 'hover' ? 'hover' : how === 'drag' ? 'drag' : 'click';
      return step(
        action,
        { running: `${words[0]} “${element}”`, done: `${words[1]} “${element}”` },
        async (tab) => {
          if (how === 'drag' && !to)
            throw new Refusal('To drag, say where to drop it: `to` is the ref of the place.');
          const target = await present(tab, ref);
          const own = await wordsOf(target);
          // Scrolled into view inside whatever list or panel holds it, then measured.
          await target.scrollIntoViewIfNeeded({ timeout: 4_000 }).catch(() => undefined);
          const box = await tab.boxOf(target);
          if (how === 'hover') {
            // Pointing changes nothing: no question, as with reading.
            await point(tab, 'hover', `Pointing at “${element}”`, box);
            await target.hover({ timeout: 6_000 });
            await new Promise((r) => setTimeout(r, 400));
            return { text: await pageText(tab) };
          }
          const drop = to ? await present(tab, to) : undefined;
          const dropWords = drop ? await wordsOf(drop) : '';
          await permit(tab, {
            action:
              how === 'drag'
                ? `Drag “${own || element}” onto “${dropWords || 'another element'}”`
                : `${how === 'double' ? 'Double-click' : how === 'right' ? 'Right-click' : 'Click'} “${own || element}”`,
            // Exact resolved communication labels only; 'Send payment' and 'Publish
            // access key' are not ordinary communication candidates.
            // Communication, bookings, subscriptions and invites, by their exact resolved
            // label; anything about money ('Send payment', 'Book · $40') keeps its card.
            reviewClick: how === 'click' && reviewableClick(own),
            highStakes:
              isHighStakes(own) ||
              isHighStakes(element) ||
              (how === 'drag' && isHighStakes(dropWords)),
            box,
          });
          await point(tab, action, `${words[0]} “${element}”`, box);
          if (how === 'drag' && drop) {
            await target.dragTo(drop, { timeout: 8_000 });
            await settle(tab.page);
            return { text: await pageText(tab) };
          }
          // A provider's button for the site's own sign-in ("Continue with Google", ADR 0133):
          // its pages then fill the account this site signs in with.
          const chained =
            how === 'click'
              ? await chainFromClick(service.passwords, tab, own).catch(() => undefined)
              : undefined;
          const press = () =>
            target.click({
              timeout: 6_000,
              ...(how === 'double' && { clickCount: 2 }),
              ...(how === 'right' && { button: 'right' as const }),
            });
          let downloaded = '';
          try {
            downloaded = await catchDownload(tab, press);
          } catch (error) {
            if (!/intercepts pointer events/.test(String((error as Error).message))) throw error;
            // Usually a cookie banner or a menu: clear it and try once more.
            await declineCookies(tab.page).catch(() => undefined);
            await tab.page.keyboard.press('Escape').catch(() => undefined);
            downloaded = await catchDownload(tab, press);
          }
          await settle(tab.page);
          return { text: `${downloaded}${chained ? `${chained}\n` : ''}${await pageText(tab)}` };
        },
      );
    },
  };

  const type: HostTool<{
    ref: typeof Ref;
    element: typeof Element;
    text: z.ZodString;
    submit: z.ZodOptional<z.ZodBoolean>;
    details: z.ZodOptional<z.ZodBoolean>;
    item: z.ZodOptional<z.ZodString>;
  }> = {
    name: 'browser_type',
    description:
      'Type into a field by its ref (replacing what’s there). Set `submit` to press Enter after. Signing in, signing up or paying: give an empty text on the username, password, new password, one-time code or card field, and Conch fills it from the user’s Passwords (after asking them, and asking which account if there are several), makes and saves a strong password on a sign-up or change form, or hands the field to the user. When the account signs in another way (Continue with Google, a company’s single sign-on, a passkey, an emailed link), Conch says which of the page’s buttons to press instead; on the provider’s own page, the same empty text fills the provider’s saved login. A form asking for the user’s own details (a visa, a booking’s traveller, a sign-up’s address): set `details` with an empty text and Conch fills the form from their saved identity or passport. You never see or type those values yourself.',
    input: {
      ref: Ref,
      element: Element,
      text: z
        .string()
        .max(5_000)
        .describe(
          'What to type. For a username, password, new password, code or card field, leave it empty: Conch fills it.',
        ),
      submit: z.boolean().optional().describe('Press Enter afterwards (e.g. to search).'),
      details: z
        .boolean()
        .optional()
        .describe(
          'A form asking for the user’s own details (name, email, phone, address, date of birth, passport or ID number and its dates): true with an empty text, and Conch fills this box and the rest of the form from their saved identity or passport in Passwords, after one question. You never see the values.',
        ),
      item: z
        .string()
        .max(300)
        .optional()
        .describe(
          'Only if the user named one: the id of the saved item to fill from (from passwords_find). Omit it and Conch finds the one saved for this site, and asks the user which when there are several.',
        ),
    },
    run: ({ ref, element, text, submit, item, details }) =>
      step(
        'type',
        { running: `Typing in “${element}”`, done: `Typed in “${element}”` },
        async (tab) => {
          await markSecrets(tab.page);
          const target = await present(tab, ref);
          const secret = details && !text ? 'identity' : await secretOf(target);
          // Passwords fills sign-ins, codes, cards, your details and new passwords, with the person's OK.
          const deps = secret || !text ? fillDeps(tab) : undefined;
          if (deps) acting();
          const filled = deps
            ? await agentFill(deps, tab, target, { secret, text, item, element })
            : undefined;
          if (filled?.kind === 'filled')
            return { label: filled.label, text: `${filled.text}\n${await pageText(tab)}` };
          if (filled?.kind === 'said') return { label: filled.label, text: filled.text };
          // Secrets never pass through the model: the user types this one. A sign-in only the
          // person can do (a passkey kept in another app, ADR 0133) is theirs too, whatever the box.
          const theirs = filled?.kind === 'handoff' ? filled : undefined;
          if (secret || theirs?.reason) {
            const outcome = await handoff(
              tab,
              theirs?.reason ||
                `Please type ${secret ? secretLabel(secret) : 'it'} into “${element}”, then hand the browser back.`,
            );
            return {
              label:
                outcome !== 'cancelled'
                  ? theirs?.note
                    ? 'You signed in'
                    : `You filled in “${element}”`
                  : `Waited for you at “${element}”`,
              text:
                outcome !== 'cancelled'
                  ? `${theirs?.note ?? `That field takes ${secret ? secretLabel(secret) : 'something only the user can give'}, so the user typed it themselves (you never see it).`} Carry on from here.\n${await pageText(tab)}`
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
            carries: text.length > LONG_TYPING,
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

  const press: HostTool<{ key: z.ZodString; ref: z.ZodOptional<typeof Ref> }> = {
    name: 'browser_press',
    description:
      'Press a key or a shortcut: Enter, Escape, Tab, ArrowDown, PageDown, Control+A, Shift+Tab, Control+Shift+K. Give `ref` to press it on that element (it gets the focus first).',
    input: {
      key: z
        .string()
        .min(1)
        .max(60)
        .regex(/^[\w+\-.,;:'"`=/\\[\] ]+$/, 'A key name like "Enter", or keys joined by "+".')
        .describe('A key name, or a shortcut with "+": "Enter", "Escape", "Control+A".'),
      ref: Ref.optional().describe('Press it on this element, e.g. a text box or a list.'),
    },
    run: ({ key, ref }) =>
      step('press', { running: `Pressing ${key}`, done: `Pressed ${key}` }, async (tab) => {
        const target = ref ? await present(tab, ref) : undefined;
        if (target) {
          await markSecrets(tab.page);
          // A shortcut on a secret field could paste one in: those are the user's.
          if ((await secretOf(target)) && !/^(enter|tab|escape|shift\+tab)$/i.test(key))
            throw new Refusal(
              'That field takes a password, code or card number: only the user types there. Use browser_handoff.',
            );
          await target.focus({ timeout: 5_000 });
        }
        const enter = /^enter$/i.test(key);
        const formButton = enter
          ? await tab.page
              .evaluate(
                'document.activeElement?.form?.querySelector("[type=submit], button:not([type])")?.innerText ?? ""',
              )
              .then(String)
              .catch(() => '')
          : '';
        const box = target ? await tab.boxOf(target) : undefined;
        await permit(tab, {
          action: enter && formButton ? `Press Enter (${formButton.trim()})` : `Press ${key}`,
          highStakes: enter && isHighStakes(formButton),
          box,
        });
        await point(tab, 'press', `Pressing ${key}`, box);
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
          const target = await present(tab, ref);
          const box = await tab.boxOf(target);
          await permit(tab, {
            action: `Choose “${option}” in “${element}”`,
            highStakes: false,
            box,
          });
          await point(tab, 'select', `Choosing “${option}”`, box);
          await throughDialogs(tab, () =>
            target
              .selectOption({ label: option }, { timeout: 6_000 })
              .catch(() => target.selectOption(option, { timeout: 6_000 })),
          );
          await settle(tab.page);
          return { text: await pageText(tab) };
        },
      ),
  };

  const FormField = z.object({
    ref: Ref,
    element: Element,
    value: z
      .string()
      .max(5_000)
      .optional()
      .describe('What to type (it replaces what’s there), or the option to choose in a list.'),
    checked: z
      .boolean()
      .optional()
      .describe('For a checkbox, switch or radio button: true to tick it, false to clear it.'),
  });

  /**
   * Many fields in one step (ADR 0131): a long form is one question and one
   * look at the page, not one per box. It never sends the form; the agent
   * clicks the form's own button next, and that's judged like any click.
   */
  const form: HostTool<{ fields: z.ZodArray<typeof FormField> }> = {
    name: 'browser_form',
    description:
      'Fill in several fields of a form in one go, by their refs: text boxes (`value`), drop-down lists (`value`: the option as it reads) and checkboxes or radio buttons (`checked`). It doesn’t send the form: click its button afterwards. Password, code and card fields are left for browser_type, and file boxes for browser_upload.',
    input: {
      fields: z.array(FormField).min(1).max(40).describe('The fields to fill in, in order.'),
    },
    run: ({ fields }) =>
      step(
        'type',
        {
          running: `Filling in ${fields.length === 1 ? 'a field' : `${fields.length} fields`}`,
          done: `Filled in ${fields.length === 1 ? 'a field' : `${fields.length} fields`}`,
        },
        async (tab) => {
          await markSecrets(tab.page);
          const planned: {
            field: z.infer<typeof FormField>;
            target: Locator;
            how: 'choose' | 'tick' | 'type';
          }[] = [];
          const skipped: string[] = [];
          let significant = false;
          for (const field of fields) {
            const target = locate(tab, field.ref);
            const kind = await target
              .evaluate(
                (el: { tagName: string; getAttribute(n: string): string | null }) => ({
                  tag: el.tagName.toLowerCase(),
                  type: (el.getAttribute('type') ?? '').toLowerCase(),
                  role: (el.getAttribute('role') ?? '').toLowerCase(),
                }),
                undefined,
                { timeout: 3_000 },
              )
              .catch(() => undefined);
            if (!kind) {
              skipped.push(`“${field.element}” (it isn’t on the page any more: read it again)`);
              continue;
            }
            // Secrets never pass through the model: browser_type fills them from Passwords or hands them over.
            if (await secretOf(target)) {
              skipped.push(`“${field.element}” (a password, code or card field: use browser_type)`);
              continue;
            }
            if (kind.type === 'file') {
              skipped.push(`“${field.element}” (a file box: use browser_upload)`);
              continue;
            }
            const ticks =
              kind.type === 'checkbox' ||
              kind.type === 'radio' ||
              ['checkbox', 'radio', 'switch', 'menuitemcheckbox'].includes(kind.role);
            if (ticks ? field.checked === undefined : field.value === undefined) {
              skipped.push(
                `“${field.element}” (${ticks ? 'say `checked` for a box to tick' : 'say its `value`'})`,
              );
              continue;
            }
            // Ticking "Delete my account", or agreeing to pay, is significant, as clicking it would be.
            if (
              ticks &&
              field.checked &&
              (isHighStakes(await wordsOf(target)) || isHighStakes(field.element))
            )
              significant = true;
            planned.push({
              field,
              target,
              how: kind.tag === 'select' ? 'choose' : ticks ? 'tick' : 'type',
            });
          }
          if (!planned.length)
            throw new Refusal(
              `Nothing to fill in: ${skipped.join('; ')}. Read the page again for fresh refs.`,
            );
          const first = planned[0];
          const box = first ? await tab.boxOf(first.target) : undefined;
          await permit(tab, {
            action:
              planned.length === 1
                ? `Fill in “${first?.field.element}”`
                : `Fill in ${planned.length} fields (${planned
                    .slice(0, 4)
                    .map((p) => `“${p.field.element}”`)
                    .join(', ')}${planned.length > 4 ? '…' : ''})`,
            highStakes: significant,
            box,
            carries: planned.some((p) => (p.field.value?.length ?? 0) > LONG_TYPING),
          });
          const filled: string[] = [];
          for (const [i, { field, target, how }] of planned.entries()) {
            check();
            const at = await tab.boxOf(target);
            const label = `Filling in “${field.element}”`;
            // The cursor visits each field; only the first waits the watched beat.
            if (i === 0) await point(tab, 'type', label, at);
            else tab.announce({ type: 'action', action: 'type', label, box: at });
            try {
              await throughDialogs(tab, async () => {
                if (how === 'choose') {
                  const option = field.value ?? '';
                  await target
                    .selectOption({ label: option }, { timeout: 5_000 })
                    .catch(() => target.selectOption(option, { timeout: 5_000 }));
                } else if (how === 'tick') {
                  await target.setChecked(field.checked ?? true, { timeout: 5_000 });
                } else {
                  const text = field.value ?? '';
                  await target.fill(text, { timeout: 5_000 }).catch(async () => {
                    // Rich editors don't take `fill`: type it like a person.
                    await target.click({ timeout: 4_000 });
                    await target.pressSequentially(text, { delay: 8 });
                  });
                }
              });
              filled.push(field.element);
            } catch (error) {
              skipped.push(`“${field.element}” (${explain(error)})`);
            }
          }
          await settle(tab.page);
          const said = [
            `Filled in ${filled.length} of ${fields.length} field${fields.length === 1 ? '' : 's'}${filled.length ? `: ${filled.map((f) => `“${f}”`).join(', ')}` : ''}.`,
            ...(skipped.length ? [`Not filled: ${skipped.join('; ')}.`] : []),
            'The form isn’t sent yet: click its button when it’s ready.',
          ].join(' ');
          return {
            label: `Filled in ${filled.length === 1 ? '1 field' : `${filled.length} fields`}`,
            text: `${said}\n${await pageText(tab)}`,
          };
        },
      ),
  };

  const scroll: HostTool<{
    direction: z.ZodOptional<z.ZodEnum<{ up: 'up'; down: 'down'; left: 'left'; right: 'right' }>>;
    ref: z.ZodOptional<typeof Ref>;
  }> = {
    name: 'browser_scroll',
    effect: 'read',
    description:
      'Scroll the page by most of a screen (`direction`), bring an element into view (`ref` alone, even inside a scrolling list or panel), or scroll inside a list or panel (`ref` and `direction`).',
    input: {
      direction: z.enum(['up', 'down', 'left', 'right']).optional(),
      ref: Ref.optional().describe(
        'An element: brought into view, or with `direction`, the list or panel to scroll in.',
      ),
    },
    run: ({ direction, ref }) =>
      step(
        'scroll',
        {
          running: direction ? `Scrolling ${direction}` : 'Bringing it into view',
          done: direction ? `Scrolled ${direction}` : 'Brought it into view',
        },
        async (tab) => {
          if (!direction && !ref)
            throw new Refusal(
              'Say which way to scroll (`direction`), or what to bring into view (`ref`).',
            );
          const target = ref ? locate(tab, ref) : undefined;
          await point(
            tab,
            'scroll',
            direction ? `Scrolling ${direction}` : 'Bringing it into view',
          );
          const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
          const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
          if (target && !direction) {
            await target.scrollIntoViewIfNeeded({ timeout: 5_000 });
          } else if (target) {
            // The element, or the nearest thing around it that scrolls that way.
            const moved = await target.evaluate(
              (start: unknown, [x, y]: [number, number]) => {
                interface Box {
                  scrollTop: number;
                  scrollLeft: number;
                  scrollHeight: number;
                  scrollWidth: number;
                  clientHeight: number;
                  clientWidth: number;
                  parentElement: Box | null;
                  scrollBy(dx: number, dy: number): void;
                }
                const view = globalThis as unknown as {
                  getComputedStyle(el: Box): { overflowY: string; overflowX: string };
                };
                const scrolls = (el: Box) => {
                  const style = view.getComputedStyle(el);
                  return y
                    ? /(auto|scroll|overlay)/.test(style.overflowY) &&
                        el.scrollHeight > el.clientHeight
                    : /(auto|scroll|overlay)/.test(style.overflowX) &&
                        el.scrollWidth > el.clientWidth;
                };
                let el: Box | null = start as Box;
                while (el && !scrolls(el)) el = el.parentElement;
                if (!el) return false;
                const before = [el.scrollLeft, el.scrollTop];
                el.scrollBy(x * el.clientWidth * 0.8, y * el.clientHeight * 0.8);
                return before[0] !== el.scrollLeft || before[1] !== el.scrollTop;
              },
              [dx, dy] as [number, number],
            );
            if (!moved) {
              // Nothing there scrolls by script: the wheel over it does what a person's would.
              const box = await target.boundingBox({ timeout: 2_000 }).catch(() => null);
              if (box) await tab.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await tab.page.mouse.wheel(dx * 480, dy * 480);
            }
          } else {
            await tab.page.mouse.move(tab.viewport.width / 2, tab.viewport.height / 2);
            await tab.page.mouse.wheel(dx * 640, dy * 640);
          }
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
    effect: 'read',
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
          // One picture pixel is one CSS pixel, whatever the screen's density, and
          // no more than the model reads (`shot.ts`): browser_click_at's x,y are in
          // this picture's pixels, whatever the panel does next. (Your own Chrome
          // isn't emulated, so its size is what was measured, not `viewportSize`.)
          const viewport = tab.page.viewportSize() ?? tab.viewport;
          const shot = await shootPage(tab.page, {
            viewport,
            model: ctx.model,
            mask,
            maskColor: '#9a8f88',
          });
          const title = await tab.page.title().catch(() => '');
          const { width, height } = shot;
          tab.shotViewport = { width, height };
          return {
            text: `Screenshot of “${title}” (${tab.page.url()}): the visible part of the page, ${width}×${height} pixels, x across from the left and y down from the top. Where there’s no ref to use (a canvas, an unlabelled control), browser_click_at acts at x,y in these pixels.`,
            images: [{ data: shot.jpeg.toString('base64'), mimeType: 'image/jpeg' }],
          };
        },
      ),
  };

  const wait: HostTool<{ text: z.ZodOptional<z.ZodString>; seconds: z.ZodOptional<z.ZodNumber> }> =
    {
      name: 'browser_wait',
      effect: 'read',
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
          return outcome === 'auto'
            ? {
                label: 'You got through, so I carried on',
                text: `The user got through (Conch saw the sign-in or check go through). Carry on from here.\n${await pageText(tab)}`,
              }
            : { text: `The user is done. Carry on from here.\n${await pageText(tab)}` };
        },
      ),
  };

  const passkey: HostTool<{
    action: z.ZodEnum<{ sign_in: 'sign_in'; save: 'save' }>;
    item: z.ZodOptional<z.ZodString>;
  }> = {
    name: 'browser_passkey',
    description:
      'Use a passkey on the page that’s open. `sign_in`: Conch holds the user’s saved passkey for this site (after asking them); then click the site’s “Sign in with a passkey” button and Conch answers it. `save`: when the site offers to create a passkey, call this first, then click its button; the new passkey is kept in the user’s Passwords. A passkey kept only in another app (1Password, the system) can’t be used here: Conch says so, and the user signs in. You never see the key.',
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
          if (
            !(await waiting('Waiting for you to unlock Passwords', () =>
              passwords.ensureOpen(show, ctx.signal),
            ))
          )
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
            acting();
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
          if (!chosen.length) {
            // Saved as passkey-only, but kept where Conch can't use it (ADR 0133): say so plainly.
            const kept = (await passwords.matching(host).catch(() => [])).find(
              (i) =>
                i.signIn?.via === 'passkey' &&
                i.signIn.usable === false &&
                (!item || i.id === item),
            );
            if (kept) {
              const only = {
                id: kept.id,
                title: kept.title,
                ...(kept.source && { source: kept.source }),
                signIn: { via: 'passkey' as const, usable: false },
              };
              return {
                label: `${kept.title}’s passkey is in ${keptIn(kept.source)}`,
                text: `${signInSteps(only)} A reason for browser_handoff: “${passkeyHandoffReason(only)}”`,
              };
            }
            return {
              label: `No passkey saved for ${host}`,
              text: `The user has no passkey saved for ${host}. Sign in with the password instead (browser_type fills it), or ask the user.`,
            };
          }
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
          acting();
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

  const tabs: HostTool<{
    action: z.ZodEnum<{ list: 'list'; open: 'open'; switch: 'switch'; close: 'close' }>;
    tab: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
  }> = {
    name: 'browser_tabs',
    description: `The chat’s browser tabs (up to ${MAX_TABS}): list them, open a new one (with an address or words to search), switch to one, or close one. Links that open a new tab, and sign-in popups, become tabs by themselves and come into view.`,
    input: {
      action: z.enum(['list', 'open', 'switch', 'close']),
      tab: z
        .string()
        .regex(/^t\d{1,3}$/i, 'A tab id from the list, like t2.')
        .optional()
        .describe('For switch and close: the tab, e.g. "t2".'),
      url: z
        .string()
        .min(1)
        .max(4096)
        .optional()
        .describe('For open: a web address, or words to search for.'),
    },
    run: ({ action, tab: id, url: raw }) =>
      step(
        'tab',
        {
          running:
            action === 'open'
              ? 'Opening a new tab'
              : action === 'switch'
                ? `Switching to tab ${id ?? ''}`
                : action === 'close'
                  ? `Closing tab ${id ?? ''}`
                  : 'Looking at the tabs',
          done:
            action === 'open'
              ? 'Opened a new tab'
              : action === 'switch'
                ? `Switched to tab ${id ?? ''}`
                : action === 'close'
                  ? `Closed tab ${id ?? ''}`
                  : 'Looked at the tabs',
        },
        async (tab) => {
          const listed = async () =>
            (await tab.list())
              .map(
                (t) =>
                  `${t.id}${t.active ? ' (in view)' : ''}: ${t.title || '(no title)'} — ${t.url || 'a new tab'}`,
              )
              .join('\n');
          if (action === 'list') return { text: `Tabs:\n${await listed()}` };
          if (action === 'open') {
            const url = raw ? toUrl(raw) : undefined;
            if (url) {
              const verdict = await service.guard.navigation(url);
              if (!verdict.ok) throw new Refusal(verdict.message);
            }
            check();
            const opened = await service.openTab(tab);
            if (!opened)
              throw new Refusal(
                `This chat already has ${MAX_TABS} tabs open. Close one first (browser_tabs close).`,
              );
            let checked = '';
            if (url) {
              await point(tab, 'open', `Opening ${displayHost(url)}`);
              const response = await goTo(tab.page, url);
              await settle(tab.page);
              checked = await throughBotCheck(tab.page, response, { signal: ctx.signal });
            }
            return {
              label: url ? `Opened ${displayHost(url)} in a new tab` : 'Opened a new tab',
              text: `Opened tab ${opened}.\n${checked}${await pageText(tab)}`,
            };
          }
          if (!id)
            throw new Refusal(`Say which tab: one of ${tab.tabs.map((t) => t.id).join(', ')}.`);
          acting();
          if (action === 'switch') {
            if (!tab.switchTo(id))
              throw new Refusal(
                `There’s no tab ${id}. The tabs are: ${tab.tabs.map((t) => t.id).join(', ')}.`,
              );
            return { text: await pageText(tab) };
          }
          const closed = await tab.closeTab(id);
          if (closed === 'missing')
            throw new Refusal(
              `There’s no tab ${id}. The tabs are: ${tab.tabs.map((t) => t.id).join(', ')}.`,
            );
          if (closed === 'last')
            throw new Refusal(
              'That’s the only tab, so it stays open. Open another page in it instead.',
            );
          return { text: `Closed ${id}. Tabs now:\n${await listed()}\n${await pageText(tab)}` };
        },
      ),
  };

  const clickAt: HostTool<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    element: typeof Element;
    how: typeof How;
    to_x: z.ZodOptional<z.ZodNumber>;
    to_y: z.ZodOptional<z.ZodNumber>;
    text: z.ZodOptional<z.ZodString>;
    submit: z.ZodOptional<z.ZodBoolean>;
  }> = {
    name: 'browser_click_at',
    description:
      'Click at a point on the page, by its x,y in the last browser_screenshot’s pixels: for canvases, maps and controls the page text has no ref for. Prefer refs when there are any. Give `text` to type after clicking (into the field there), and `submit` to press Enter. `how` double-clicks, right-clicks, hovers or drags to to_x,to_y. Conch asks the user just as it does for a click.',
    input: {
      x: z.number().min(0).max(10_000).describe('Pixels from the left of the screenshot.'),
      y: z.number().min(0).max(10_000).describe('Pixels from the top of the screenshot.'),
      element: Element,
      how: How,
      to_x: z.number().min(0).max(10_000).optional().describe('For drag: where to drop, x.'),
      to_y: z.number().min(0).max(10_000).optional().describe('For drag: where to drop, y.'),
      text: z
        .string()
        .max(5_000)
        .optional()
        .describe('Type this after clicking (it replaces what’s in a text field).'),
      submit: z.boolean().optional().describe('Press Enter after typing.'),
    },
    run: ({ x, y, element, how = 'click', to_x, to_y, text, submit }) => {
      const action: BrowserActionKind =
        text !== undefined ? 'type' : how === 'hover' ? 'hover' : how === 'drag' ? 'drag' : 'click';
      const running =
        text !== undefined
          ? `Typing in “${element}”`
          : how === 'hover'
            ? `Pointing at “${element}”`
            : how === 'drag'
              ? `Dragging “${element}”`
              : `Clicking “${element}”`;
      return step(
        action,
        {
          running,
          done:
            text !== undefined
              ? `Typed in “${element}”`
              : how === 'hover'
                ? `Pointed at “${element}”`
                : how === 'drag'
                  ? `Dragged “${element}”`
                  : `Clicked “${element}”`,
        },
        async (tab) => {
          // The screenshot's pixels, onto today's page (the panel may have changed its shape).
          const shot = tab.shotViewport ?? tab.viewport;
          const sx = tab.viewport.width / shot.width;
          const sy = tab.viewport.height / shot.height;
          const at = (px: number, py: number) => ({ px: px * sx, py: py * sy });
          const { px, py } = at(x, y);
          if (px >= tab.viewport.width || py >= tab.viewport.height)
            throw new Refusal(
              `${Math.round(x)},${Math.round(y)} is outside the page (${shot.width}×${shot.height}). Take a fresh browser_screenshot and use its pixels.`,
            );
          if (how === 'drag' && (to_x === undefined || to_y === undefined))
            throw new Refusal('To drag, give where to drop it: to_x and to_y.');
          await markSecrets(tab.page);
          const hit = await targetAt(tab.page, px, py);
          const box = tab.boxAt(hit.box ?? { x: px - 14, y: py - 14, width: 28, height: 28 });
          // Secrets never pass through the model, by ref or by position.
          if (text !== undefined && hit.secret) {
            const outcome = await handoff(
              tab,
              `Please type ${secretLabel(hit.secret)} into “${element}”, then hand the browser back.`,
            );
            return {
              label:
                outcome !== 'cancelled'
                  ? `You filled in “${element}”`
                  : `Waited for you at “${element}”`,
              text:
                outcome !== 'cancelled'
                  ? `That field takes ${secretLabel(hit.secret)}, so the user typed it themselves (you never see it). Carry on from here.\n${await pageText(tab)}`
                  : 'The user didn’t fill in the field. Ask them how they’d like to continue.',
            };
          }
          if (how === 'hover') {
            await point(tab, 'hover', running, box);
            await tab.page.mouse.move(px, py, { steps: 4 });
            await new Promise((r) => setTimeout(r, 400));
            return { text: await pageText(tab) };
          }
          const drop = how === 'drag' ? at(to_x ?? 0, to_y ?? 0) : undefined;
          const dropHit = drop ? await targetAt(tab.page, drop.px, drop.py) : undefined;
          const named = hit.words || element;
          const verb =
            how === 'double'
              ? 'Double-click'
              : how === 'right'
                ? 'Right-click'
                : how === 'drag'
                  ? 'Drag'
                  : 'Click';
          await permit(tab, {
            action:
              how === 'drag'
                ? `Drag “${named}” onto “${dropHit?.words || 'another place'}”`
                : text !== undefined
                  ? `${verb} “${named}” and type “${text.length > 40 ? `${text.slice(0, 40)}…` : text}”`
                  : `${verb} “${named}”`,
            highStakes:
              isHighStakes(hit.words) ||
              isHighStakes(element) ||
              Boolean(dropHit && isHighStakes(dropHit.words)),
            box,
          });
          await point(tab, action, running, box);
          if (drop) {
            await tab.page.mouse.move(px, py);
            await tab.page.mouse.down();
            await tab.page.mouse.move(drop.px, drop.py, { steps: 12 });
            await tab.page.mouse.up();
            await settle(tab.page);
            return { text: await pageText(tab) };
          }
          let downloaded = await catchDownload(tab, () =>
            tab.page.mouse.click(px, py, {
              ...(how === 'double' && { clickCount: 2 }),
              ...(how === 'right' && { button: 'right' as const }),
            }),
          );
          if (text !== undefined) {
            await markSecrets(tab.page);
            const field = await focused(tab.page);
            if (field?.secret)
              throw new Refusal(
                'That click put the cursor in a password, code or card field: only the user types there. Use browser_handoff.',
              );
            // A text field is replaced, as browser_type does; a canvas just takes the keys.
            if (field?.editable) await tab.page.keyboard.press('ControlOrMeta+A');
            await tab.page.keyboard.type(text, { delay: 8 });
            if (submit) {
              const formButton = String(
                await tab.page
                  .evaluate(
                    'document.activeElement?.form?.querySelector("[type=submit], button:not([type])")?.innerText ?? ""',
                  )
                  .catch(() => ''),
              ).trim();
              if (isHighStakes(formButton))
                await permit(tab, {
                  action: `Press Enter (${formButton})`,
                  highStakes: true,
                  box,
                });
              downloaded += await catchDownload(tab, () => tab.page.keyboard.press('Enter'));
            }
          }
          await settle(tab.page);
          return { text: `${downloaded}${await pageText(tab)}` };
        },
      );
    },
  };

  const upload: HostTool<{
    ref: typeof Ref;
    element: typeof Element;
    files: z.ZodArray<z.ZodString>;
  }> = {
    name: 'browser_upload',
    description:
      'Put files into a file box on the page (an “Upload” or “Choose file” button, by its ref). Files can be ones the user attached in this chat (by name), things you made in this chat (by title), or files in the work folder (by path). Conch shows the user what goes where and asks every time.',
    input: {
      ref: Ref,
      element: Element,
      files: z
        .array(z.string().min(1).max(1000))
        .min(1)
        .max(10)
        .describe(
          'Each file: an attachment’s name, something you made, or a path in the work folder.',
        ),
    },
    run: ({ ref, element, files: wanted }) =>
      step(
        'upload',
        {
          running: `Uploading to “${element}”`,
          done: `Uploaded ${wanted.length === 1 ? 'a file' : `${wanted.length} files`} to “${element}”`,
        },
        async (tab) => {
          const sources = service.uploads;
          if (!sources)
            throw new Refusal('Uploading files isn’t available here. Ask the user to do it.');
          let files: UploadFile[];
          try {
            files = await resolveUploads(wanted, {
              conversationId,
              workspace: await (ctx.workspace?.() ?? service.workspace()),
              sources,
            });
          } catch (error) {
            if (error instanceof UploadRefused) throw new Refusal(error.message);
            throw error;
          }
          const target = await present(tab, ref);
          const box = await tab.boxOf(target);
          const kind = await target
            .evaluate((el: { tagName: string; type?: string; multiple?: boolean }) => ({
              input: el.tagName === 'INPUT' && el.type === 'file',
              multiple: Boolean(el.multiple),
            }))
            .catch(() => ({ input: false, multiple: false }));
          const names = files.map((f) => `“${f.name}”`).join(', ');
          await permit(tab, {
            action: `Upload ${names} (${files.map((f) => f.from).join(', ')})`,
            highStakes: true,
            box,
            kind: 'upload',
          });
          await point(tab, 'upload', `Uploading to “${element}”`, box);
          const payload = files.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer }));
          if (kind.input) {
            if (files.length > 1 && !kind.multiple)
              throw new Refusal('That box takes one file at a time. Upload them one by one.');
            await target.setInputFiles(payload, { timeout: 10_000 });
          } else {
            // A button that opens the file picker: answer the picker instead.
            const chooser = tab.page.waitForEvent('filechooser', { timeout: 6_000 });
            await target.click({ timeout: 6_000 });
            const picker = await chooser.catch(() => undefined);
            if (!picker)
              throw new Refusal(
                `Clicking “${element}” didn’t ask for a file. Find the upload button or file box (often “Choose file” or “Upload”) and use its ref.`,
              );
            if (files.length > 1 && !picker.isMultiple())
              throw new Refusal('That box takes one file at a time. Upload them one by one.');
            check();
            await picker.setFiles(payload, { timeout: 10_000 });
          }
          await settle(tab.page);
          return {
            text: `Put ${names} into “${element}”. If the site has its own button to send or save them, that’s the next step.\n${await pageText(tab)}`,
          };
        },
      ),
  };

  const all = [
    open,
    read,
    click,
    type,
    form,
    passkey,
    press,
    select,
    scroll,
    back,
    screenshot,
    wait,
    handOff,
    tabs,
    clickAt,
    upload,
  ] as HostTool[];
  for (const t of all) {
    t.searchHint = 'browser web page website';
    // The page it acted on is part of what the action is (see `generation`).
    if (t.effect !== 'read') t.identity = (args) => JSON.stringify([session, generation, args]);
  }
  // A browsing task starts with these, so they're there without a tool search first.
  for (const t of [open, read, click, type] as HostTool[]) t.alwaysLoad = true;
  return all;
}
