import type { Page } from 'playwright-core';

/**
 * Declines cookie banners before the agent reads a page (ADR 0014,
 * "self-healing"): they cover the content, swallow clicks, and choosing for
 * you is a privacy decision — so Conch always picks the least: reject, or
 * "necessary only". Known consent platforms first, then a careful fallback
 * that only clicks a "Reject all"-style button inside something that looks
 * like a consent banner. Off in Settings › Browser.
 */

/** Runs in each frame; self-contained because it's serialised. Returns what it clicked, if anything. */
export function declineInPage(): string | null {
  interface El {
    click(): void;
    textContent: string | null;
    id: string;
    className: unknown;
    parentElement: El | null;
    shadowRoot?: { querySelector(s: string): El | null } | null;
    getAttribute(name: string): string | null;
    getBoundingClientRect(): { width: number; height: number };
  }
  const doc = (
    globalThis as unknown as {
      document: {
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      };
    }
  ).document;
  const visible = (el: El) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  // Consent platforms, by the button they use for "reject" or "necessary only".
  const known: [string, string][] = [
    ['OneTrust', '#onetrust-reject-all-handler'],
    ['Cookiebot', '#CybotCookiebotDialogBodyButtonDecline'],
    ['Cookiebot', '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll'],
    ['Didomi', '#didomi-notice-disagree-button'],
    ['Quantcast', '.qc-cmp2-summary-buttons button[mode="secondary"]'],
    ['TrustArc', '#truste-consent-required'],
    ['Osano', '.osano-cm-denyAll'],
    ['Complianz', '.cmplz-btn.cmplz-deny'],
    ['CookieYes', '.cky-btn-reject'],
    ['Termly', '[data-tid="banner-decline"]'],
    ['Klaro', '.cm-btn-decline'],
    ['iubenda', '.iubenda-cs-reject-btn'],
    ['Axeptio', '#axeptio_btn_dismiss'],
    ['Google', 'form[action*="consent.google"] button[aria-label^="Reject"]'],
  ];
  for (const [name, selector] of known) {
    const el = doc.querySelector(selector);
    if (el && visible(el)) {
      el.click();
      return name;
    }
  }
  // Usercentrics lives in a shadow root.
  const uc = doc
    .querySelector('#usercentrics-root')
    ?.shadowRoot?.querySelector('button[data-testid="uc-deny-all-button"]');
  if (uc && visible(uc)) {
    uc.click();
    return 'Usercentrics';
  }
  // Fallback: a reject-style button inside a consent-looking container.
  const reject =
    /^(reject( all)?( cookies)?|decline( all)?( cookies)?|refuse( all)?|deny( all)?|(use )?(only )?(strictly )?necessary( cookies)?( only)?|essential( cookies)? only|alle ablehnen|ablehnen|nur notwendige|tout refuser|refuser|continuer sans accepter|rechazar( todo| todas)?|rifiuta( tutto)?|weigeren|alles weigeren)$/i;
  const consent = /cookie|consent|gdpr|cmp|privacy|onetrust|didomi|usercentrics|tarteaucitron/i;
  for (const el of Array.from(doc.querySelectorAll('button, [role="button"], a'))) {
    const words = (el.textContent ?? el.getAttribute('aria-label') ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!reject.test(words) || !visible(el)) continue;
    let node: El | null = el;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      if (consent.test(`${node.id} ${String(node.className)}`)) {
        el.click();
        return 'a cookie banner';
      }
    }
  }
  return null;
}

/** Declines any cookie banner on the page (every frame). Returns what was declined, if anything. */
export async function declineCookies(page: Page): Promise<string | undefined> {
  for (const frame of page.frames()) {
    const clicked = await frame.evaluate(declineInPage).catch(() => null);
    if (clicked) return clicked;
  }
  return undefined;
}
