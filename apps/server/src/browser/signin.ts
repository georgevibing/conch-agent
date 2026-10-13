import {
  SIGN_IN_PROVIDERS,
  signInName,
  type BrowserFillAccount,
  type VaultSignIn,
  type VaultSignInProvider,
} from '@conch/protocol';
import type { Frame, Page } from 'playwright-core';

import { normalHost, registrable } from '../vault/match';
import type { PasswordFiller } from './service';
import type { Tab } from './tab';

/**
 * Signing in some other way than a password, in the browser (ADR 0133 § In
 * the browser): "Continue with Google", a company's single sign-on, a
 * passkey, a link or code by email.
 *
 * - **The page's own buttons.** Read from the accessibility snapshot by their
 *   names ("Continue with Google", "Sign in with SSO"), and kept only when
 *   they're in the page's own origin, or for a provider's button, in a frame
 *   on that provider's own sign-in site (Google draws its button in a frame
 *   from accounts.google.com). Finding one never fills anything: it only
 *   says where to press.
 * - **The chain.** Starting a provider's sign-in for an item (Product Hunt
 *   with Google) is remembered on the chat's tab for as long as one sign-in
 *   takes. On the provider's pages it decides which of the logins *already
 *   saved for that page* to use (the Google account Product Hunt signs in
 *   with) and what the one question says. It never adds a site to anything:
 *   which secret may go where is still `fillPolicy`'s, by the item's own sites.
 * - **Nothing about a value** is here: names, accounts and refs only.
 */

type Known = Exclude<VaultSignInProvider, 'other'>;

/** How long a provider's sign-in, started from a site, counts as that site's (ADR 0130's sign-in). */
export const CHAIN_MS = 10 * 60_000;

/** The words each provider's button goes by. `X` alone is a close button, so it needs a verb. */
const PROVIDER_WORDS: Record<Known, RegExp> = {
  google: /\bgoogle\b/i,
  apple: /\bapple\b/i,
  microsoft: /\b(?:microsoft|outlook|office\s?365)\b/i,
  facebook: /\bfacebook\b/i,
  github: /\bgithub\b/i,
  gitlab: /\bgitlab\b/i,
  x: /\bX\b|\b[Tt]witter\b/,
  linkedin: /\blinked\s?in\b/i,
  amazon: /\bamazon\b/i,
  discord: /\bdiscord\b/i,
  slack: /\bslack\b/i,
  okta: /\bokta\b/i,
};

/** A sign-in verb, in the languages sign-in buttons are most often in. */
const VERB =
  /\b(?:continue|sign[\s-]?(?:in|up|on)|log[\s-]?in|login|connect|join|register|get started|use|weiter|fortfahren|anmelden|registrieren|continuer|connecter|connexion|s'identifier|continuar|iniciar|entrar|accedi|continua|inloggen|doorgaan|aanmelden)\b/i;
/** "with", "using", "via". */
const WITH = /\b(?:with|using|via|through|by|mit|avec|con|com|met|par)\b/i;
const SSO = /\b(?:sso|single[\s-]sign[\s-]on|saml|enterprise\s+sign[\s-]?in)\b/i;
const PASSKEY = /\b(?:passkeys?|security\s+key)\b/i;
const EMAIL_WITH = /\b(?:e-?mail|email\s+address)\b/i;
const LINK =
  /\b(?:magic|sign[\s-]?in|log[\s-]?in|login)\s+link\b|\be-?mail\s+me\b|\bsend\s+(?:me\s+)?(?:a\s+)?(?:magic\s+|sign[\s-]?in\s+|login\s+)?(?:link|code)\b/i;

/** "… with Yahoo": a capitalised name right after "with". */
const OTHER =
  /\b(?:with|using|via|mit|avec|con|com|met|par)\s+(?:your\s+)?[A-Z][\w.-]+(?:\s+(?:ID|Account))?\s*$/;
const PRODUCT =
  /\b(?:pay|play|store|maps|drive|music|podcasts?|tv|wallet|prime|docs|sheets|calendar|photos|share|follow|download)\b/i;
const NOT_OTHER = /\b(?:phone|password|code|sms|text|number|card|PayPal|Apple Pay|Google Pay)\b/i;

export type SignInButtonKind = 'provider' | 'sso' | 'passkey' | 'email';

/** A sign-in button on the page, by its accessible name. */
export interface SignInButton {
  kind: SignInButtonKind;
  /** For `provider`: whose. */
  provider?: Known;
  label: string;
  ref: string;
  role: 'button' | 'link';
}

/**
 * What a button's accessible name says it does, if it starts a sign-in: a
 * provider's ("Continue with Google", "Sign in with Apple", a button named
 * just "Google"), single sign-on, a passkey, or an email link. A provider
 * Conch doesn't know ("Continue with Yahoo") has no `provider`.
 */
export function buttonKind(
  label: string,
  role: 'button' | 'link' = 'button',
): { kind: SignInButtonKind; provider?: Known } | undefined {
  const text = label.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 80) return undefined;
  const verb = VERB.test(text);
  const via = verb && WITH.test(text);
  // "Google Pay", "Get it on Google Play", "Apple Music": the company, not its sign-in.
  const product = PRODUCT.test(text);
  for (const [provider, words] of Object.entries(PROVIDER_WORDS) as [Known, RegExp][]) {
    if (product || !words.test(text)) continue;
    // "Continue with Google"; a button that's only the name (an icon's label) counts too,
    // but never a link ("Facebook" in a footer) and never "X" (a close button).
    if (via || (verb && provider !== 'x')) return { kind: 'provider', provider };
    const alone = text.replace(/\s*(?:account|id)$/i, '');
    if (role === 'button' && provider !== 'x' && words.test(alone) && alone.split(' ').length <= 2)
      return { kind: 'provider', provider };
  }
  if (SSO.test(text) && (verb || text.length <= 30)) return { kind: 'sso' };
  if (PASSKEY.test(text) && (verb || text.length <= 30)) return { kind: 'passkey' };
  if ((via && EMAIL_WITH.test(text)) || LINK.test(text)) return { kind: 'email' };
  // "Continue with Yahoo": a provider Conch doesn't know, by a name written as one.
  if (via && OTHER.test(text) && !NOT_OTHER.test(text)) return { kind: 'provider' };
  return undefined;
}

/** `- button "Continue with Google" [ref=e12]`, with any flags before the ref. */
const LINE = /^\s*-\s+(button|link)\s+"((?:[^"\\]|\\.)*)"((?:\s+\[[^\]]*\])*)/;

/**
 * The sign-in buttons in the page as the agent reads it (Playwright's AI
 * snapshot, iframes included). Not yet checked for where they come from:
 * `ownButtons` does that against the live page.
 */
export function signInButtons(snapshot: string): SignInButton[] {
  const found: SignInButton[] = [];
  for (const line of snapshot.split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    const ref = /\[ref=([a-z0-9]{1,16})\]/i.exec(m[3] ?? '')?.[1];
    if (!ref) continue;
    const role = m[1] as 'button' | 'link';
    const label = (m[2] ?? '').replace(/\\(.)/g, '$1');
    const kind = buttonKind(label, role);
    if (kind) found.push({ ...kind, label, ref, role });
    if (found.length >= 24) break;
  }
  return found;
}

/** The known provider whose own sign-in sites a host is on: never a look-alike. */
export function providerOfHost(host: string): Known | undefined {
  const h = normalHost(host);
  if (!h) return undefined;
  for (const [id, { domains }] of Object.entries(SIGN_IN_PROVIDERS) as [
    Known,
    { domains: string[] },
  ][])
    if (domains.some((d) => h === d || h.endsWith(`.${d}`))) return id;
  return undefined;
}

function originOf(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/**
 * The buttons that really are the page's own: in its own origin, or for a
 * provider's button, in a secure frame on that provider's own sign-in site.
 * A sign-in button another site put in the page is left out.
 */
export async function ownButtons(page: Page, buttons: SignInButton[]): Promise<SignInButton[]> {
  const top = originOf(page.url());
  if (!top) return [];
  const kept: SignInButton[] = [];
  for (const button of buttons.slice(0, 12)) {
    const handle = await page
      .locator(`aria-ref=${button.ref}`)
      .elementHandle({ timeout: 1_000 })
      .catch(() => null);
    const frame = await handle?.ownerFrame().catch(() => null);
    await handle?.dispose().catch(() => undefined);
    if (!frame) continue;
    if (frame === page.mainFrame()) {
      kept.push(button);
      continue;
    }
    const at = originOf(frame.url());
    if (!at) continue;
    if (at.origin === top.origin) kept.push(button);
    else if (
      button.kind === 'provider' &&
      button.provider &&
      at.protocol === 'https:' &&
      providerOfHost(at.hostname) === button.provider
    )
      kept.push(button);
  }
  return kept;
}

/** Of several buttons for one way in: "Sign in with…" before "Sign up with…", buttons before links. */
function preferSignIn<B extends { label: string; role: string }>(all: readonly B[]): B | undefined {
  const up = (b: B) => /sign[\s-]?up|register|join/i.test(b.label);
  return all.find((b) => !up(b) && b.role === 'button') ?? all.find((b) => !up(b)) ?? all[0];
}

/** The page's button for how an item signs in, if it has one. */
export function buttonFor<
  B extends { kind: SignInButtonKind; provider?: Known; label: string; role: string },
>(buttons: readonly B[], signIn: VaultSignIn): B | undefined {
  const pick = (want: (b: B) => boolean) => preferSignIn(buttons.filter(want));
  if (signIn.via === 'provider') {
    if (signIn.provider && signIn.provider !== 'other')
      return pick((b) => b.kind === 'provider' && b.provider === signIn.provider);
    const name = signIn.name?.trim().toLowerCase();
    return name
      ? pick((b) => b.kind === 'provider' && !b.provider && b.label.toLowerCase().includes(name))
      : undefined;
  }
  if (signIn.via === 'sso')
    return (
      pick((b) => b.kind === 'sso') ??
      (signIn.name && /okta/i.test(signIn.name)
        ? pick((b) => b.kind === 'provider' && b.provider === 'okta')
        : undefined)
    );
  if (signIn.via === 'passkey') return pick((b) => b.kind === 'passkey');
  return pick((b) => b.kind === 'email');
}

/** The registrable site a host belongs to, to tell "back on Product Hunt" from "elsewhere". */
export function siteKey(host: string): string {
  return registrable(host) ?? normalHost(host);
}

const REDIRECT_PARAM =
  /^(?:redirect_uri|redirect_url|redirect|redirectto|return_to|returnto|return_url|returnurl|continue|next|callback|callback_url|service|followup|origin|ru)$/i;

/**
 * The sites a provider's sign-in page says it will send you back to:
 * `redirect_uri`, `continue` and the like, followed through the provider's own
 * pages (Google's `continue` holds the OAuth address, which holds the
 * `redirect_uri`). Hosts, lowercased.
 */
export function redirectHosts(url: string, depth = 0): string[] {
  const at = originOf(url);
  if (!at || depth > 3) return [];
  const hosts: string[] = [];
  for (const [key, value] of at.searchParams) {
    if (!REDIRECT_PARAM.test(key)) continue;
    const inner = originOf(value);
    if (!inner || !/^https?:$/.test(inner.protocol)) continue;
    hosts.push(normalHost(inner.hostname));
    hosts.push(...redirectHosts(value, depth + 1));
  }
  return [...new Set(hosts.filter(Boolean))];
}

/** A provider's sign-in under way, for one of the person's sites. */
export interface Chain {
  /** The item it signs in to: "Product Hunt". */
  fromItem: string;
  fromTitle: string;
  /** Its registrable site. */
  fromSite: string;
  provider?: Known;
  /** "Google", or the name an unknown provider goes by. */
  name: string;
  account?: string;
  /** The saved login for the provider's account, when there is one. */
  with?: BrowserFillAccount;
  until: number;
}

const chains = new WeakMap<Tab, Chain>();

export function startChain(tab: Tab, chain: Omit<Chain, 'until'>, now = Date.now()): Chain {
  const started = { ...chain, until: now + CHAIN_MS };
  chains.set(tab, started);
  return started;
}

export function endChain(tab: Tab): void {
  chains.delete(tab);
}

/**
 * The provider's sign-in under way on this page, if this page is part of it:
 * not expired, not the site it started from, on the provider's own site (or
 * the provider item's, for one Conch doesn't know: the caller checks that
 * against what's saved for the page), and not a page that says it will send
 * the sign-in to some other site.
 */
export function chainOn(tab: Tab, url: string, now = Date.now()): Chain | undefined {
  const chain = chains.get(tab);
  if (!chain) return undefined;
  if (chain.until < now) {
    chains.delete(tab);
    return undefined;
  }
  return chainFits(chain, url) ? chain : undefined;
}

/** Whether a page belongs to a chain (pure, for `chainOn`). */
export function chainFits(chain: Chain, url: string): boolean {
  const at = originOf(url);
  if (!at) return false;
  const host = normalHost(at.hostname);
  if (siteKey(host) === chain.fromSite) return false;
  if (chain.provider && providerOfHost(host) !== chain.provider && !chain.with) return false;
  const back = redirectHosts(url).filter(
    (h) =>
      siteKey(h) !== siteKey(host) && (!chain.provider || providerOfHost(h) !== chain.provider),
  );
  return !back.length || back.some((h) => siteKey(h) === chain.fromSite);
}

/** Where a passkey Conch can't use is kept, in the person's words. */
export function keptIn(source: string | undefined): string {
  switch (source) {
    case '1password':
      return '1Password';
    case 'bitwarden':
      return 'Bitwarden';
    case 'keepassxc':
      return 'KeePassXC';
    case 'protonpass':
      return 'Proton Pass';
    case 'dashlane':
      return 'Dashlane';
    case 'keeper':
      return 'Keeper';
    case 'keychain':
      return 'the macOS Keychain';
    default:
      return 'another app';
  }
}

/** What to call the way an item signs in: "Google", "Acme SSO". */
export function viaName(signIn: VaultSignIn): string {
  return signInName(signIn);
}

/** A saved item, as the sign-in words need it. */
export interface SignInItem {
  id: string;
  title: string;
  subtitle?: string;
  source?: string;
  signIn: VaultSignIn;
}

const quote = (b: SignInButton) => `“${b.label}” [ref=${b.ref}]`;

/**
 * What the agent hears about an item that signs in some other way, and what
 * to do: one paragraph it can act on. Names, accounts and refs only.
 */
export function signInSteps(
  item: SignInItem,
  options: {
    button?: SignInButton;
    with?: BrowserFillAccount;
    filledUsername?: boolean;
    /** For an item that doesn't say whose account: the page's provider buttons. */
    choices?: SignInButton[];
  } = {},
): string {
  const { signIn } = item;
  const name = viaName(signIn);
  const account = signIn.account ?? item.subtitle;
  const who = account ? ` (${account})` : '';
  const { button } = options;
  if (unnamed(signIn)) {
    const choices = options.choices ?? [];
    const head = `“${item.title}” signs in with another account${who}, not a password on this site, but Passwords doesn’t say whose (Google, Apple…).`;
    const then =
      'On that provider’s page, call browser_type with an empty text on its boxes: Conch fills them if the user keeps that login in Passwords; otherwise call browser_handoff so they sign in there themselves.';
    const [only] = choices;
    if (choices.length === 1 && only)
      return `${head} The page’s only one is ${quote(only)}: press it, and tell the user that’s the one you used. ${then}`;
    if (choices.length > 1)
      return `${head} The page offers ${choices.map(quote).join(', ')}. Don’t guess: ask the user which one they use (with the ask tool), then press it. ${then}`;
    return `${head} Don’t guess: ask the user which one they use, then press the page’s button for it. ${then}`;
  }
  if (signIn.via === 'provider') {
    const press = button
      ? `Click its ${quote(button)} button.`
      : `Click the page’s “Continue with ${name}” or “Sign in with ${name}” button (open its sign-in page first if it isn’t showing).`;
    const then = options.with
      ? `On ${name}’s page, call browser_type with an empty text on the email box, then on the password box: Conch fills them from “${options.with.title}”${options.with.account ? ` (${options.with.account})` : ''} after the user agrees, and fills the code too if ${name} asks for one.`
      : `On ${name}’s page, call browser_type with an empty text on its boxes: Conch fills them if the user keeps their ${name} login in Passwords. If nothing is saved for it, call browser_handoff so they sign in to ${name} themselves.`;
    return `“${item.title}” signs in with ${name}${who}, not a password on this site. ${press} ${then} If ${name} already shows ${account ?? 'the account'}, just click it: no password needed. It may open in a new tab.`;
  }
  if (signIn.via === 'sso') {
    const press = button
      ? `Click its ${quote(button)} button, or enter the work email and continue.`
      : 'Enter the work email and continue, or click the page’s single sign-on button.';
    return `“${item.title}” signs in through ${name}${who}, the user’s company sign-in, not a password on this site. ${press} The site sends you to the company’s sign-in page: call browser_type with an empty text there, and Conch fills it if that sign-in is saved in Passwords. If nothing is saved for it, call browser_handoff so the user signs in.`;
  }
  if (signIn.via === 'passkey') {
    if (signIn.usable === false)
      return `“${item.title}” signs in with a passkey kept in ${keptIn(item.source)}, which Conch’s browser can’t use, and it has no password. Call browser_handoff so the user signs in themselves (say why in a few words), or sign in another way if the site offers one. Once they’re in, if the site offers to add a passkey, you can suggest making one Conch keeps (browser_passkey with save), so next time Conch signs in by itself.`;
    const press = button ? `click its ${quote(button)} button` : 'click the site’s passkey button';
    return `“${item.title}” signs in with a passkey Conch holds, not a password. Call browser_passkey with sign_in, then ${press}: Conch answers it after the user agrees.`;
  }
  const start = options.filledUsername
    ? 'Conch filled the email. Submit the form'
    : button
      ? `Click its ${quote(button)} button and fill the email (browser_type with an empty text), then submit`
      : 'Fill the email (browser_type with an empty text on the email box) and submit';
  return `“${item.title}” signs in with a link or code sent by email${who}, not a password. ${start}: the site sends a link or a code. If you can read the user’s email (a mail app is connected), find the newest message from the site and type its code into the code box, or open its link with browser_open; never paste it into a reply. Otherwise ask the user to check their email, or call browser_handoff so they finish.`;
}

/** What the agent hears once the person signed in with a passkey Conch can't use. */
export function passkeyHandedNote(item: SignInItem): string {
  return `“${item.title}” signs in with a passkey kept in ${keptIn(item.source)}, which Conch’s browser can’t use, so the user signed in themselves (you never see it). If the site now offers to add a passkey, you can suggest making one Conch keeps (browser_passkey with save), so next time Conch signs in by itself.`;
}

/** The reason a handoff says to the person, when Conch can't use an item's passkey. */
export function passkeyHandoffReason(item: SignInItem): string {
  return `Your passkey for ${item.title} is kept in ${keptIn(item.source)}, which Conch’s browser can’t use. Sign in yourself, then hand the browser back.`;
}

/**
 * The saved login for a provider's account: the vault's own answer
 * (`signInItemFor`), or, before it has one, the login saved for the
 * provider's sign-in site whose account is the one the item names. Only ever
 * an item already saved for the provider's own site.
 */
export async function providerLogin(
  passwords: PasswordFiller,
  listed: Parameters<NonNullable<PasswordFiller['signInItemFor']>>[0],
  /** For an item that doesn't say whose account: the provider whose button was pressed. */
  resolved?: Known,
): Promise<BrowserFillAccount | undefined> {
  const item =
    resolved && listed.signIn && unnamed(listed.signIn)
      ? { ...listed, signIn: { ...listed.signIn, provider: resolved } }
      : listed;
  const signIn = item.signIn;
  if (signIn?.via !== 'provider') return undefined;
  const own = passwords.signInItemFor
    ? await Promise.resolve(passwords.signInItemFor(item)).catch(() => undefined)
    : undefined;
  if (own) return { id: own.id, title: own.title, ...(own.subtitle && { account: own.subtitle }) };
  if (passwords.signInItemFor || !signIn.provider || signIn.provider === 'other') return undefined;
  const [domain] = SIGN_IN_PROVIDERS[signIn.provider].domains;
  if (!domain) return undefined;
  const found = (await passwords.matching(domain).catch(() => [])).filter(
    (i) => i.id !== item.id && i.signIn?.via !== 'provider' && i.signIn?.via !== 'sso',
  );
  const wanted = signIn.account?.trim().toLowerCase();
  const pick = wanted
    ? found.find((i) => i.subtitle.trim().toLowerCase() === wanted)
    : found.length === 1
      ? found[0]
      : undefined;
  return (
    pick && { id: pick.id, title: pick.title, ...(pick.subtitle && { account: pick.subtitle }) }
  );
}

/**
 * Saved as signing in with "another account", without saying whose: 1Password's
 * "Sign in with" often doesn't name the provider. Then Conch never guesses:
 * the page's buttons are offered, and the person (or the agent, asking them) picks.
 */
export function unnamed(signIn: VaultSignIn): boolean {
  return (
    signIn.via === 'provider' && (!signIn.provider || signIn.provider === 'other') && !signIn.name
  );
}

/** The page's buttons for signing in with another account, one per provider, to choose from. */
export function providerChoices<
  B extends Pick<SignInButton, 'kind' | 'provider' | 'label' | 'role'>,
>(buttons: readonly B[]): B[] {
  const groups = new Map<string, B[]>();
  for (const b of buttons) {
    if (b.kind !== 'provider') continue;
    const key = b.provider ?? b.label.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  return [...groups.values()]
    .slice(0, 4)
    .map((group) => preferSignIn(group))
    .filter((b): b is B => Boolean(b));
}

/** The first saved item for a page that signs in some other way, if the closest ones do. */
export function signInItemOf<T extends { match?: string; signIn?: VaultSignIn }>(
  found: readonly T[],
): (T & { signIn: VaultSignIn }) | undefined {
  const best = found[0]?.match;
  const closest = best ? found.filter((f) => f.match === best) : found;
  // Several accounts saved for the site: only when they all sign in the same other way.
  const first = closest[0];
  if (!first?.signIn) return undefined;
  if (closest.some((f) => f.signIn?.via !== first.signIn?.via)) return undefined;
  return first as T & { signIn: VaultSignIn };
}

/** Whether a label shows the account a provider's chooser offers ("Ada Lovelace ada@gmail.com"). */
export function showsAccount(label: string, account: string | undefined): boolean {
  if (!account || !account.includes('@')) return false;
  return label.toLowerCase().includes(account.trim().toLowerCase());
}

/** `- link "Ada Lovelace ada@gmail.com" [ref=e9]`: the account's entry in a chooser. */
export function accountEntry(
  snapshot: string,
  account: string | undefined,
): SignInButton | undefined {
  if (!account) return undefined;
  for (const line of snapshot.split('\n')) {
    const m =
      /^\s*-\s+(button|link|listitem|option)\s+"((?:[^"\\]|\\.)*)"((?:\s+\[[^\]]*\])*)/.exec(line);
    if (!m) continue;
    const ref = /\[ref=([a-z0-9]{1,16})\]/i.exec(m[3] ?? '')?.[1];
    const label = (m[2] ?? '').replace(/\\(.)/g, '$1');
    if (ref && showsAccount(label, account))
      return { kind: 'provider', label, ref, role: m[1] === 'link' ? 'link' : 'button' };
  }
  return undefined;
}

// ── The live view: the page's buttons, found and pressed by Conch ───────────

/** The attribute a sign-in button carries while Conch may press it for you. */
const BUTTON_ATTR = 'data-conch-signin';

/** A sign-in button found in one of the page's frames, to press for the person. */
export interface PageButton {
  kind: SignInButtonKind;
  provider?: Known;
  label: string;
  role: 'button' | 'link';
  frame: Frame;
  mark: string;
}

/**
 * Runs in a frame (serialised, so self-contained): the names of its buttons
 * and links, each marked so one can be pressed. Names only.
 */
function collectButtons(attr: string): { label: string; role: 'button' | 'link'; mark: string }[] {
  interface El {
    tagName: string;
    innerText?: string;
    value?: string;
    getAttribute(n: string): string | null;
    setAttribute(n: string, v: string): void;
    removeAttribute(n: string): void;
    querySelector(s: string): El | null;
    getClientRects(): { length: number };
  }
  const doc = (
    globalThis as unknown as {
      document: {
        querySelectorAll(s: string): ArrayLike<El>;
        getElementById(id: string): El | null;
      };
    }
  ).document;
  for (const old of Array.from(doc.querySelectorAll(`[${attr}]`))) old.removeAttribute(attr);
  const out: { label: string; role: 'button' | 'link'; mark: string }[] = [];
  const all = Array.from(
    doc.querySelectorAll(
      'button, a[href], [role=button], [role=link], input[type=submit], input[type=button]',
    ),
  );
  for (const el of all) {
    if (out.length >= 200) break;
    if (!el.getClientRects().length) continue;
    const labelled = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => doc.getElementById(id)?.innerText ?? '')
      .join(' ');
    const label = (
      el.getAttribute('aria-label') ||
      labelled ||
      el.innerText ||
      el.value ||
      el.getAttribute('title') ||
      el.querySelector('img[alt]')?.getAttribute('alt') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!label || label.length > 80) continue;
    const role =
      el.getAttribute('role') === 'link' || (el.tagName === 'A' && !el.getAttribute('role'))
        ? 'link'
        : 'button';
    const mark = `b${out.length}`;
    el.setAttribute(attr, mark);
    out.push({ label, role, mark });
  }
  return out;
}

/**
 * The sign-in buttons the person could press, in the page's own origin or,
 * for a provider's, in a secure frame on that provider's own site.
 */
export async function pageButtons(page: Page): Promise<PageButton[]> {
  const top = originOf(page.url());
  if (!top) return [];
  const found: PageButton[] = [];
  for (const frame of page.frames().slice(0, 12)) {
    const main = frame === page.mainFrame();
    const at = main ? top : originOf(frame.url());
    if (!at) continue;
    const own = at.origin === top.origin;
    const providerFrame = at.protocol === 'https:' ? providerOfHost(at.hostname) : undefined;
    if (!own && !providerFrame) continue;
    const listed = await frame.evaluate(collectButtons, BUTTON_ATTR).catch(() => []);
    for (const b of listed) {
      const kind = buttonKind(b.label, b.role);
      if (!kind) continue;
      // Another site's frame only counts for its own provider's button.
      if (!own && !(kind.kind === 'provider' && kind.provider === providerFrame)) continue;
      found.push({ ...kind, label: b.label, role: b.role, frame, mark: b.mark });
    }
  }
  return found;
}

/** Press one of `pageButtons` for the person, if it's still where it was. */
export async function pressButton(button: PageButton): Promise<boolean> {
  if (button.frame.isDetached()) return false;
  return button.frame
    .locator(`[${BUTTON_ATTR}="${button.mark}"]`)
    .first()
    .click({ timeout: 4_000 })
    .then(
      () => true,
      () => false,
    );
}
