import type { Page } from 'playwright-core';

import { SECRET_ATTR } from './risk';
import { markSecrets } from './snapshot';
import type { Tab } from './tab';

/**
 * Noticing when you're done with a sign-in or a captcha (ADR 0080 § Your
 * turn), so the assistant carries on without waiting for "I’m done".
 *
 * Only a handoff that starts at a gate — a password or code field, or a
 * captcha — is watched. It's done when the gate is gone: the page moved on
 * and shows no password, code or captcha any more (a two-step sign-in's code
 * page is still a gate), a sign-in window that opened has closed again, or the
 * captcha has handed its page a token. And only once you've stopped touching
 * the page for a moment, so it never takes the wheel from under your hands.
 * Anything else (a payment, your details) waits for you to say so.
 */

/** Captcha frames by where they come from. */
const CAPTCHA =
  /(?:google\.com|recaptcha\.net)\/recaptcha\/|hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs\.com|funcaptcha\.com|geetest\.com|captcha-delivery\.com/i;

export interface Gate {
  /** Origin and path: where the page is, without what changes as you type. */
  where: string;
  /** A password or one-time-code field shows. */
  secret: boolean;
  captcha: boolean;
  /** What the captcha has given the page so far (empty until solved). */
  token: string;
}

function whereOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** Runs in each frame (after `markSecrets`): is a password or code field showing? */
function secretShowing(attr: string): boolean {
  interface El {
    getAttribute(n: string): string | null;
    getClientRects(): { length: number };
  }
  const doc = (
    globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<El> } }
  ).document;
  return Array.from(doc.querySelectorAll(`[${attr}="password"]`)).some(
    (el) => el.getClientRects().length > 0,
  );
}

/** Runs in the page: the tokens captchas leave in the form when solved. */
function captchaToken(): string {
  interface Field {
    value?: string;
  }
  const doc = (
    globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<Field> } }
  ).document;
  return Array.from(
    doc.querySelectorAll(
      '[name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]',
    ),
  )
    .map((f) => f.value ?? '')
    .join('');
}

/** Where the page stands: a gate, or not. */
export async function gateOf(page: Page): Promise<Gate> {
  await markSecrets(page);
  const frames = page.frames();
  const secrets = await Promise.all(
    frames.map((f) => f.evaluate(secretShowing, SECRET_ATTR).then(Boolean, () => false)),
  );
  return {
    where: whereOf(page.url()),
    secret: secrets.some(Boolean),
    captcha: frames.some((f) => CAPTCHA.test(f.url())),
    token: String(await page.evaluate(captchaToken).catch(() => '')),
  };
}

/** Whether the gate is behind you: what changed between the start and now. */
export function passed(start: Gate, now: Gate, popupCameAndWent: boolean): boolean {
  if (start.captcha && now.token && now.token !== start.token) return true;
  const movedOn = now.where !== start.where || popupCameAndWent;
  return movedOn && !now.secret && !now.captcha;
}

/**
 * Watch a handoff's tab and call `done` once the gate is passed and you've
 * paused. Returns how to stop watching; does nothing for a handoff that
 * didn't start at a gate.
 */
export async function watchHandoff(
  tab: Tab,
  done: () => void,
  options: { everyMs?: number; quietMs?: number } = {},
): Promise<() => void> {
  const everyMs = options.everyMs ?? 1_000;
  const quietMs = options.quietMs ?? 2_500;
  const page = tab.current;
  if (!page) return () => undefined;
  const start = await gateOf(page).catch(() => undefined);
  if (!start || !(start.secret || start.captcha)) return () => undefined;
  const tabsAtStart = tab.tabs.length;
  let grew = false;
  let streak = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped || tab.closed || tab.control !== 'user') return;
    if (tab.tabs.length > tabsAtStart) grew = true;
    const current = tab.current;
    const now = current ? await gateOf(current).catch(() => undefined) : undefined;
    const quiet = Date.now() - tab.lastInput >= quietMs;
    const through = now && passed(start, now, grew && tab.tabs.length <= tabsAtStart);
    streak = through ? streak + 1 : 0;
    // Twice in a row (a page mid-redirect isn't there yet), and your hands are off.
    if (streak >= 2 && quiet) {
      stopped = true;
      done();
      return;
    }
    timer = setTimeout(() => void tick(), everyMs);
  };
  timer = setTimeout(() => void tick(), everyMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
