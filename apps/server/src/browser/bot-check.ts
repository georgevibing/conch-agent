import type { Page, Response } from 'playwright-core';

/**
 * A site checking whether a person is visiting before it shows itself (ADR
 * 0131): Cloudflare's "Just a moment…", DDoS-Guard, PerimeterX, DataDome.
 * Most pass by themselves within seconds, so Conch waits for that instead of
 * handing the agent a page that says nothing. One that stays (a box to tick)
 * is the person's, through `browser_handoff`. A site that refuses outright is
 * said plainly, with what to try instead.
 */

/** What the page looks like, read in the page: a check, a refusal, or the site itself. */
export type BotLook = 'check' | 'refused' | 'page';

/** How long a check is given to pass by itself. */
const PASS_MS = 15_000;
const LOOK_EVERY_MS = 750;

/** Run in the page. Titles and markers the common checks use; the words of a refusal. */
const LOOK = `(() => {
  const title = (document.title || '').toLowerCase();
  const text = ((document.body && document.body.innerText) || '').slice(0, 4000).toLowerCase();
  const marked = document.querySelector(
    '#challenge-form, #challenge-running, #cf-challenge-running, #challenge-stage, .cf-turnstile, ' +
    'iframe[src*="challenges.cloudflare.com"], #px-captcha, iframe[src*="captcha-delivery.com"], #ddg-captcha'
  );
  if (
    marked ||
    /^(just a moment|attention required|checking your browser|please wait.*cloudflare|one more step|ddos-guard|un instant|einen moment)/.test(title) ||
    /checking (if|whether) the site connection is secure|verify(ing)? you are (a )?human|needs to review the security of your connection|press (&|and) hold/.test(text)
  ) return 'check';
  if (
    text.length < 2000 &&
    /access denied|you have been blocked|you've been blocked|request (was )?blocked|unusual traffic|automated (queries|requests|access)|are you a robot|bot detected|forbidden/.test(title + ' ' + text)
  ) return 'refused';
  return 'page';
})()`;

export async function lookAt(page: Page): Promise<BotLook> {
  const look = await page.evaluate(LOOK).catch(() => 'page');
  return look === 'check' || look === 'refused' ? look : 'page';
}

/**
 * After opening a page: wait out a check that passes by itself, and say what
 * the agent should know. Empty when the page is just the page.
 */
export async function throughBotCheck(
  page: Page,
  response: Response | null,
  { passMs = PASS_MS, signal }: { passMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  let look = await lookAt(page);
  const status = response?.status() ?? 0;
  if (look === 'page' && (status === 403 || status === 429) && !(await hasContent(page)))
    look = 'refused';
  if (look === 'refused') return refused(status);
  if (look === 'page') return '';
  const until = Date.now() + passMs;
  while (Date.now() < until) {
    signal?.throwIfAborted();
    await new Promise((r) => setTimeout(r, LOOK_EVERY_MS));
    // A check that passes reloads into the site: let it land before looking.
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
    look = await lookAt(page);
    if (look === 'page')
      return '(The site checked the browser before showing itself, and that passed by itself.)\n';
    if (look === 'refused') return refused(status);
  }
  return '(The site is checking whether a person is visiting, and that didn’t pass by itself. Call browser_handoff so the user can do it (often a box to tick); Conch carries on once they’re through. Or find the same thing on another site.)\n';
}

/** Something to read: a refusal page is a sentence or two. */
async function hasContent(page: Page): Promise<boolean> {
  const length = await page
    .evaluate('((document.body && document.body.innerText) || "").trim().length')
    .catch(() => 0);
  return Number(length) > 2000;
}

function refused(status: number): string {
  return `(The site refused the browser${status >= 400 ? ` (it answered ${status})` : ''}: it may keep automated visits out. Don’t retry it over and over. Try again in a while, find the same thing on another site, or ask the user to open it themselves.)\n`;
}
