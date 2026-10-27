import {
  generatePassword,
  SIGN_IN_PROVIDERS,
  type VaultSignInProvider,
  type BrowserSignInOffer,
  type BrowserFillAccount,
  type BrowserFillKind,
  type BrowserFillOffer,
  type BrowserPermission,
  type PermissionMode,
} from '@conch/protocol';
import type { Frame, Locator, Page } from 'playwright-core';

import type { AskRequest } from '../conversations/manager';
import type { PermissionDecision } from '../engines/types';
import type { FillPolicy, FillWant } from '../vault/service';
import { registrable } from '../vault/match';
import { SECRET_ATTR, type SecretKind } from './risk';
import type { PasswordFiller } from './service';
import { armSignIn } from './passkeys';
import {
  accountEntry,
  buttonFor,
  buttonKind,
  chainOn,
  keptIn,
  ownButtons,
  pageButtons,
  passkeyHandedNote,
  passkeyHandoffReason,
  pressButton,
  providerChoices,
  providerLogin,
  providerOfHost,
  signInButtons,
  signInItemOf,
  signInSteps,
  startChain,
  siteKey as chainSite,
  viaName,
  unnamed,
  type Chain,
  type PageButton,
  type SignInButton,
  type SignInItem,
} from './signin';
import { markSecrets } from './snapshot';
import type { Tab } from './tab';

/**
 * Passwords in the browser (ADR 0130): which box is which, which saved item
 * belongs there, one question per sign-in, and the value straight from the
 * gateway into the page. The agent's `browser_type` and your own hands in the
 * live view both come through here, so the same guards hold for both:
 *
 * - https only (or this computer), and the box's frame is the page's own
 *   origin: never a sign-in box from another site inside the page;
 * - only an item saved for this site (`vault/match.ts`), never a look-alike,
 *   which is named and refused instead;
 * - nothing about a value ever reaches the model: it hears that a fill
 *   happened, and from which item.
 */

/** What a box on the page is for. */
export type FieldRole =
  | 'username'
  | 'password'
  | 'new-password'
  | 'totp'
  | 'cardNumber'
  | 'cvv'
  | 'expiry'
  | 'cardholder';

const CARD_ROLES = new Set<FieldRole>(['cardNumber', 'cvv', 'expiry', 'cardholder']);

/** What the page says about one box (no value: only whether it's empty). */
export interface FieldFacts {
  /** The mark it carries for this fill, to find it again. */
  mark: string;
  type: string;
  autocomplete: string;
  /** Its name, id, label, placeholder and aria words, lowercase. */
  words: string;
  /** What `markSecrets` called it, if anything. */
  secret: string | null;
  empty: boolean;
  /** The box the fill is for. */
  target: boolean;
}

/** The attribute a fill marks a form's boxes with, for as long as it takes. */
const FILL_ATTR = 'data-conch-fill';
/** The attribute that finds the box you're in, in the live view. */
const FOCUS_ATTR = 'data-conch-focus';

/** How long a sign-in you agreed to covers its next steps (the password page, the code). */
const SIGN_IN_MS = 10 * 60_000;

/**
 * Runs in the page (serialised, so self-contained): marks every box in the
 * target's form (or its document) and says what each one is.
 */
function collectFields(
  target: unknown,
  { attr, secretAttr }: { attr: string; secretAttr: string },
): { fields: FieldFacts[]; submit: string } {
  interface El {
    id: string;
    value?: string;
    textContent: string | null;
    labels?: ArrayLike<El> | null;
    form?: El | null;
    tagName: string;
    getAttribute(n: string): string | null;
    setAttribute(n: string, v: string): void;
    removeAttribute(n: string): void;
    closest(s: string): El | null;
    querySelectorAll(s: string): ArrayLike<El>;
    getClientRects(): { length: number };
    getRootNode(): El;
    ownerDocument: El;
    getElementById?(id: string): El | null;
  }
  const el = target as El;
  const doc = el.ownerDocument;
  for (const old of Array.from(doc.querySelectorAll(`[${attr}]`))) old.removeAttribute(attr);
  const root = el.form ?? el.closest('form') ?? el.getRootNode();
  const wordsOf = (box: El) => {
    const parts: (string | null | undefined)[] = [
      box.getAttribute('name'),
      box.id,
      box.getAttribute('aria-label'),
      box.getAttribute('placeholder'),
      box.getAttribute('data-testid'),
    ];
    for (const id of (box.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean))
      parts.push(doc.getElementById?.(id)?.textContent);
    for (const label of Array.from(box.labels ?? [])) parts.push(label.textContent);
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').toLowerCase().slice(0, 300);
  };
  const skip = /^(hidden|submit|button|reset|checkbox|radio|file|image|range|color|search)$/i;
  const boxes = Array.from(root.querySelectorAll('input, textarea')).filter(
    (box) =>
      box === el || (!skip.test(box.getAttribute('type') ?? '') && box.getClientRects().length > 0),
  );
  const fields = boxes.slice(0, 40).map((box, i) => {
    box.setAttribute(attr, `f${i}`);
    return {
      mark: `f${i}`,
      type: (box.getAttribute('type') ?? (box.tagName === 'TEXTAREA' ? 'textarea' : 'text'))
        .toLowerCase()
        .slice(0, 20),
      autocomplete: (box.getAttribute('autocomplete') ?? '').toLowerCase().slice(0, 80),
      words: wordsOf(box),
      secret: box.getAttribute(secretAttr),
      empty: !box.value,
      target: box === el,
    };
  });
  const submit = Array.from(root.querySelectorAll('button, input[type=submit], [role=button]'))
    .map((b) => (b.textContent || b.value || '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .slice(0, 300);
  return { fields, submit };
}

const CARD_NUMBER = /card.?number|credit.?card|debit.?card|\bcc.?num|kartennummer/;
const CVV = /\bcvc|\bcvv|\bcsc\b|security code|card code|card verification/;
const EXPIRY = /expir|\bexp\b|mm\s*\/\s*yy|valid (?:thru|until)/;
const CARDHOLDER = /name on (?:the )?card|cardholder|card holder/;
const CODE =
  /one.?time|\botp\b|2fa|two.?factor|verification|verify|authenticat|security code|\bcode\b|totp|\bmfa\b/;
const NEW = /\bnew\b|create|choose|confirm|repeat|re-?enter|retype|again|verify/;
const CURRENT = /current|\bold\b|existing/;
const USERNAME = /user|login|e-?mail|account|identifier|sign.?in|phone|benutzer|courriel|correo/;
const NOT_USERNAME = /search|first|last|full name|company|coupon|promo|captcha|zip|postal|city/;
const SIGN_UP = /sign ?up|register|create (?:an |your )?account|join\b|get started/;
const SIGN_IN = /sign ?in|log ?in/;

/** One box on its own: what it says it is. */
function roleOf(f: FieldFacts): FieldRole | 'password-ish' | undefined {
  const auto = f.autocomplete;
  const w = f.words;
  if (/\bcc-number\b/.test(auto) || (f.secret === 'payment' && CARD_NUMBER.test(w)))
    return 'cardNumber';
  if (/\bcc-csc\b/.test(auto) || (f.secret === 'payment' && CVV.test(w))) return 'cvv';
  if (/\bcc-exp/.test(auto) || (f.secret === 'payment' && EXPIRY.test(w))) return 'expiry';
  if (/\bcc-(?:name|given-name|family-name)\b/.test(auto) || CARDHOLDER.test(w))
    return 'cardholder';
  if (f.secret === 'payment') return CARD_NUMBER.test(w) ? 'cardNumber' : undefined;
  if (/\bone-time-code\b/.test(auto)) return 'totp';
  const secretish = f.type === 'password' || f.secret === 'password';
  if (secretish && !/password/.test(auto) && CODE.test(w) && !/password/.test(w)) return 'totp';
  if (secretish) return 'password-ish';
  if (f.secret) return undefined;
  const typed = /^(text|email|tel|)$/.test(f.type);
  if (
    typed &&
    (/\b(username|email)\b/.test(auto) ||
      f.type === 'email' ||
      (USERNAME.test(w) && !NOT_USERNAME.test(w)))
  )
    return 'username';
  return undefined;
}

/**
 * What every box in a form is for (ADR 0130 § Which box is which): sign in,
 * sign up or change a password, a code, a card. A form's shape decides what
 * one box can't say alone: two password boxes and no "current" one are a
 * sign-up with its confirmation, and one with a "new" beside it is the
 * current password.
 */
export function classify(fields: FieldFacts[], submit = ''): Map<string, FieldRole> {
  const roles = new Map<string, FieldRole>();
  const secretish: FieldFacts[] = [];
  for (const f of fields) {
    const role = roleOf(f);
    if (role === 'password-ish') secretish.push(f);
    else if (role) roles.set(f.mark, role);
  }
  const isNew = (f: FieldFacts) =>
    /\bnew-password\b/.test(f.autocomplete) ||
    (!/current-password/.test(f.autocomplete) && NEW.test(f.words));
  const isCurrent = (f: FieldFacts) =>
    /\bcurrent-password\b/.test(f.autocomplete) || CURRENT.test(f.words);
  const anyNew = secretish.some(isNew);
  const anyCurrent = secretish.some((f) => isCurrent(f) && !isNew(f));
  const signUp = SIGN_UP.test(submit) && !SIGN_IN.test(submit);
  secretish.forEach((f, i) => {
    let role: FieldRole;
    if (isCurrent(f) && !isNew(f)) role = 'password';
    else if (isNew(f)) role = 'new-password';
    else if (anyNew || anyCurrent)
      // Beside a "current" box, an unlabelled one is new. Beside only "new" ones, the first
      // of three is the current password; otherwise it's the new one's twin.
      role = !anyCurrent && secretish.length >= 3 && i === 0 ? 'password' : 'new-password';
    else if (secretish.length >= 2) role = 'new-password';
    else role = signUp ? 'new-password' : 'password';
    roles.set(f.mark, role);
  });
  return roles;
}

/** Where a fill may happen: the page's host, if the box's frame is the page's own and it's secure. */
export function fillHost(
  pageUrl: string,
  frameUrl: string | undefined,
): { host: string } | { blocked: 'insecure' | 'frame' } {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return { blocked: 'insecure' };
  }
  const local = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i.test(page.hostname);
  if (page.protocol !== 'https:' && !(local && page.protocol === 'http:'))
    return { blocked: 'insecure' };
  if (frameUrl !== undefined) {
    let frame: URL;
    try {
      frame = new URL(frameUrl);
    } catch {
      return { blocked: 'frame' };
    }
    // The same origin: scheme, host and port. A same-site frame is still another origin.
    if (frame.origin !== page.origin) return { blocked: 'frame' };
  }
  return { host: page.hostname.toLowerCase() };
}

/** A sign-in the person agreed to (or did themselves): its next steps don't ask again. */
interface SignIn {
  itemId: string;
  site: string;
  until: number;
}
const signIns = new WeakMap<Tab, SignIn>();

function siteKey(host: string): string {
  return registrable(host) ?? host;
}

function signInFor(tab: Tab, host: string): SignIn | undefined {
  const grant = signIns.get(tab);
  if (!grant || grant.until < Date.now() || grant.site !== siteKey(host)) return undefined;
  return grant;
}

export function rememberSignIn(tab: Tab, itemId: string, host: string): void {
  signIns.set(tab, { itemId, site: siteKey(host), until: Date.now() + SIGN_IN_MS });
}

/** The marked boxes of a fill, read from the page around one box. */
interface Around {
  frame: Frame;
  host: string;
  origin: string;
  fields: FieldFacts[];
  roles: Map<string, FieldRole>;
  target: FieldFacts;
  role: FieldRole | undefined;
}

async function around(
  page: Page,
  target: Locator,
): Promise<Around | { blocked: 'insecure' | 'frame' } | undefined> {
  const handle = await target.elementHandle({ timeout: 2_000 }).catch(() => null);
  const frame = await handle?.ownerFrame().catch(() => null);
  if (!handle || !frame) return undefined;
  const where = fillHost(page.url(), frame === page.mainFrame() ? undefined : frame.url());
  if ('blocked' in where) {
    await handle.dispose().catch(() => undefined);
    return where;
  }
  const read = await handle
    .evaluate(collectFields, { attr: FILL_ATTR, secretAttr: SECRET_ATTR })
    .catch(() => undefined);
  await handle.dispose().catch(() => undefined);
  const facts = read?.fields.find((f) => f.target);
  if (!read || !facts) return undefined;
  const roles = classify(read.fields, read.submit);
  return {
    frame,
    host: where.host,
    origin: new URL(page.url()).origin,
    fields: read.fields,
    roles,
    target: facts,
    role: roles.get(facts.mark),
  };
}

/**
 * Whether the boxes are still on the page they were read from: the person may
 * have been asked for a while, and a page that went elsewhere in the meantime
 * (or a frame that did) could have planted boxes with the same marks.
 */
function stillThere(at: Around): boolean {
  const { frame } = at;
  if (frame.isDetached()) return false;
  const page = frame.page();
  const where = fillHost(page.url(), frame === page.mainFrame() ? undefined : frame.url());
  if ('blocked' in where || where.host !== at.host) return false;
  try {
    return new URL(page.url()).origin === at.origin;
  } catch {
    return false;
  }
}

/**
 * Put a value into one marked box, if it's still on the site it was read from.
 * A secret only goes where the masks are (`SECRET_ATTR`), so it can't show in a
 * screenshot the model looks at; a username goes into any box.
 */
async function put(at: Around, mark: string, value: string, secret = true): Promise<boolean> {
  if (!stillThere(at)) return false;
  const box = at.frame.locator(`[${FILL_ATTR}="${mark}"]`).first();
  if (secret) {
    const masked = await box.getAttribute(SECRET_ATTR, { timeout: 1_000 }).catch(() => null);
    if (masked !== 'password' && masked !== 'payment') return false;
  }
  return box.fill(value, { timeout: 4_000 }).then(
    () => true,
    () => false,
  );
}

async function unmark(frame: Frame): Promise<void> {
  await frame
    .evaluate(
      (attrs: string[]) => {
        const doc = (
          globalThis as unknown as {
            document: {
              querySelectorAll(s: string): ArrayLike<{ removeAttribute(n: string): void }>;
            };
          }
        ).document;
        for (const attr of attrs)
          for (const el of Array.from(doc.querySelectorAll(`[${attr}]`))) el.removeAttribute(attr);
      },
      [FILL_ATTR, FOCUS_ATTR],
    )
    .catch(() => undefined);
}

async function valueOf(frame: Frame, mark: string): Promise<string> {
  return frame
    .locator(`[${FILL_ATTR}="${mark}"]`)
    .first()
    .inputValue({ timeout: 1_000 })
    .catch(() => '');
}

const WANT: Partial<Record<FieldRole, FillWant>> = {
  username: 'username',
  password: 'password',
  totp: 'totp',
  cardNumber: 'cardNumber',
  cvv: 'cvv',
  expiry: 'expiry',
  cardholder: 'cardholder',
};

/** What filled, said to the agent: never a value. */
function filledWords(role: FieldRole): string {
  switch (role) {
    case 'username':
      return 'the username';
    case 'totp':
      return 'the one-time code';
    case 'cvv':
      return 'the security code';
    case 'cardNumber':
      return 'the card number';
    case 'expiry':
      return 'the expiry date';
    case 'cardholder':
      return 'the name on the card';
    default:
      return 'the password';
  }
}

function kindOf(role: FieldRole): BrowserFillKind {
  if (CARD_ROLES.has(role)) return 'card';
  if (role === 'totp') return 'code';
  if (role === 'new-password') return 'new-password';
  return 'sign-in';
}

/**
 * Fill the chosen item into the boxes around the target: the target itself,
 * and what belongs with it (the username beside a password, every new
 * password box and the current one, every box of a card). Returns what went in.
 */
async function fillAround(
  passwords: PasswordFiller,
  at: Around,
  itemId: string,
  role: FieldRole,
  check: () => void,
): Promise<FieldRole[]> {
  const done: FieldRole[] = [];
  const value = (want: FillWant) =>
    passwords.fillValue({ itemId, host: at.host, want }).catch(() => undefined);
  if (CARD_ROLES.has(role)) {
    for (const f of at.fields) {
      const r = at.roles.get(f.mark);
      if (!r || !CARD_ROLES.has(r) || (!f.empty && !f.target)) continue;
      const v = await value(WANT[r] as FillWant);
      check();
      if (v && (await put(at, f.mark, v, r !== 'cardholder'))) done.push(r);
    }
    return done;
  }
  const want = WANT[role];
  if (!want) return done;
  const v = await passwords.fillValue({ itemId, host: at.host, want });
  check();
  if (await put(at, at.target.mark, v, role !== 'username')) done.push(role);
  if (role === 'password') {
    const user = at.fields.find((f) => f.empty && !f.target && at.roles.get(f.mark) === 'username');
    if (user) {
      const name = await value('username');
      check();
      if (name && (await put(at, user.mark, name, false))) done.push('username');
    }
  }
  return done;
}

/** A new password into every new-password box, and the old one into an empty "current" box. */
async function fillNew(at: Around, password: string, previous: string | undefined): Promise<void> {
  for (const f of at.fields) {
    const r = at.roles.get(f.mark);
    if (r === 'new-password') await put(at, f.mark, password);
    else if (r === 'password' && f.empty && previous) await put(at, f.mark, previous);
  }
}

/** The account a form already has in its username box, to pick the item that goes with it. */
async function typedAccount(at: Around): Promise<string> {
  const user = at.fields.find((f) => !f.empty && at.roles.get(f.mark) === 'username');
  return user ? (await valueOf(at.frame, user.mark)).trim().toLowerCase() : '';
}

type Matched = Awaited<ReturnType<PasswordFiller['matching']>>[number];

/** A saved item a box could take, by name: never a value. */
type Candidate = BrowserFillAccount & {
  match?: string;
  totp?: boolean;
  /** How it signs in, when it isn't a password (ADR 0133). */
  signIn?: Matched['signIn'];
  /** The item as the vault listed it, for `signInItemFor`. */
  item?: Matched;
};

/** Saved items for a box, closest first: logins for this site, or cards. Names only. */
async function candidates(
  passwords: PasswordFiller,
  host: string,
  role: FieldRole,
): Promise<Candidate[]> {
  if (CARD_ROLES.has(role))
    return (await passwords.cards().catch(() => [])).map((c) => ({
      id: c.id,
      title: c.title,
      ...(c.subtitle && { account: c.subtitle }),
    }));
  const found = await passwords.matching(host).catch(() => []);
  return found
    .filter((i) => (role === 'totp' ? i.totp : true))
    .map((i) => ({
      id: i.id,
      title: i.title,
      ...(i.subtitle && { account: i.subtitle }),
      ...(i.source && i.source !== 'conch' && { source: i.source }),
      ...(i.match && { match: i.match }),
      totp: i.totp,
      ...(i.signIn && { signIn: i.signIn }),
      item: i,
    }));
}

/** An item that signs in some other way, as the words about it need it. */
function signInItem(c: Candidate & { signIn: NonNullable<Candidate['signIn']> }): SignInItem {
  return {
    id: c.id,
    title: c.title,
    ...(c.account && { subtitle: c.account }),
    ...(c.source && { source: c.source }),
    signIn: c.signIn,
  };
}

/**
 * The provider's sign-in under way on this page (ADR 0133), if the page is
 * part of it: on the provider's own site, or where its saved login belongs.
 * Only ever chooses among what's already saved for this page.
 */
function chainHere(tab: Tab, host: string, found: readonly Candidate[]): Chain | undefined {
  const chain = chainOn(tab, tab.page.url());
  if (!chain) return undefined;
  if (chain.provider && providerOfHost(host) === chain.provider) return chain;
  if (chain.with && found.some((f) => f.id === chain.with?.id)) return chain;
  return undefined;
}

/** In a chain: the saved login for the provider's account, if it's one of this page's. */
function chainedItem(chain: Chain | undefined, found: readonly Candidate[]): string | undefined {
  if (!chain) return undefined;
  if (chain.with && found.some((f) => f.id === chain.with?.id)) return chain.with.id;
  const account = chain.account?.trim().toLowerCase();
  return account ? found.find((f) => f.account?.trim().toLowerCase() === account)?.id : undefined;
}

/**
 * The page's own button for how an item signs in, with its ref for the agent,
 * or for an item that doesn't say whose account, the provider buttons to ask about.
 */
async function agentButtons(
  tab: Tab,
  item: SignInItem,
  snapshot?: string,
): Promise<{ button?: SignInButton; choices?: SignInButton[] }> {
  const text =
    snapshot ??
    (await tab.page
      .locator('body')
      .ariaSnapshot({ mode: 'ai', timeout: 4_000 })
      .catch(() => ''));
  const own = await ownButtons(tab.page, signInButtons(text)).catch(() => []);
  if (unnamed(item.signIn)) return { choices: providerChoices(own) };
  const button = buttonFor(own, item.signIn);
  return button ? { button } : {};
}

/** Remember that a provider's sign-in starts here for an item, so its pages fill the right account. */
async function beginChain(
  passwords: PasswordFiller,
  tab: Tab,
  host: string,
  item: SignInItem,
  listed: Matched | undefined,
  /** For an item that doesn't say whose account: the provider whose button was pressed. */
  resolved?: Exclude<VaultSignInProvider, 'other'>,
): Promise<BrowserFillAccount | undefined> {
  if (item.signIn.via !== 'provider') return undefined;
  const known =
    item.signIn.provider && item.signIn.provider !== 'other' ? item.signIn.provider : undefined;
  const provider = known ?? (unnamed(item.signIn) ? resolved : undefined);
  // Saved as "another account" and no provider pressed yet: nothing to follow.
  if (unnamed(item.signIn) && !provider) return undefined;
  const login = listed
    ? await providerLogin(passwords, listed, provider).catch(() => undefined)
    : undefined;
  startChain(tab, {
    fromItem: item.id,
    fromTitle: item.title,
    fromSite: chainSite(host),
    ...(provider && { provider }),
    name: provider ? SIGN_IN_PROVIDERS[provider].name : viaName(item.signIn),
    ...(item.signIn.account && { account: item.signIn.account }),
    ...(login && { with: login }),
  });
  return login;
}

/**
 * What the agent should hear about signing in on the page it just read (ADR
 * 0133), in Conch's words beside the page: how the item saved for this site
 * signs in and which of the page's own buttons to press, or, on a provider's
 * page during a site's sign-in, the account to pick in its chooser. Nothing
 * when the page has no sign-in buttons, or nothing saved signs in another way.
 */
export async function pageSignInNote(
  passwords: PasswordFiller | undefined,
  tab: Tab,
  snapshot: string,
): Promise<string | undefined> {
  if (!passwords) return undefined;
  const where = fillHost(tab.page.url(), undefined);
  if ('blocked' in where) return undefined;
  const chain = chainOn(tab, tab.page.url());
  if (chain) {
    const account = chain.with?.account ?? chain.account;
    const entry = accountEntry(snapshot, account);
    if (!entry) return undefined;
    if (!chain.provider || providerOfHost(where.host) !== chain.provider) {
      // A provider Conch doesn't know: only where its saved login belongs.
      const found = await candidates(passwords, where.host, 'password').catch(() => []);
      if (!chain.with || !found.some((f) => f.id === chain.with?.id)) return undefined;
    }
    return `${chain.name} shows ${account}, the account “${chain.fromTitle}” signs in with: click “${entry.label}” [ref=${entry.ref}] to carry on, no password needed. If it asks for the password instead, browser_type with an empty text on the box fills it.`;
  }
  const buttons = signInButtons(snapshot);
  if (!buttons.length) return undefined;
  if (await passwords.isLocked?.()) return undefined;
  const found = await candidates(passwords, where.host, 'password').catch(() => []);
  const other = signInItemOf(found);
  if (!other) return undefined;
  const item = signInItem(other);
  const { button, choices } = await agentButtons(tab, item, snapshot);
  const login =
    item.signIn.via === 'provider' && other.item
      ? await providerLogin(passwords, other.item).catch(() => undefined)
      : undefined;
  return `Passwords: ${signInSteps(item, {
    ...(button && { button }),
    ...(choices && { choices }),
    ...(login && { with: login }),
  })}`;
}

/** Start a provider's sign-in for an item, if one of its buttons was just clicked (`browser_click`). */
export async function chainFromClick(
  passwords: PasswordFiller | undefined,
  tab: Tab,
  words: string,
): Promise<string | undefined> {
  if (!passwords) return undefined;
  const kind = buttonKind(words);
  if (kind?.kind !== 'provider') return undefined;
  const where = fillHost(tab.page.url(), undefined);
  if ('blocked' in where) return undefined;
  const found = await candidates(passwords, where.host, 'password').catch(() => []);
  const other = signInItemOf(found);
  if (other?.signIn.via !== 'provider') return undefined;
  const item = signInItem(other);
  // Saved without saying whose account: the button pressed says it.
  const open = unnamed(item.signIn);
  if (open && !kind.provider) return undefined;
  const wanted = other.signIn.provider;
  if (!open && (kind.provider ? wanted !== kind.provider : wanted !== 'other')) return undefined;
  const login = await beginChain(passwords, tab, where.host, item, other.item, kind.provider);
  const name = kind.provider ? SIGN_IN_PROVIDERS[kind.provider].name : viaName(item.signIn);
  return login
    ? `(That’s “${item.title}”’s sign-in with ${name}. On ${name}’s page, browser_type with an empty text on the email and password boxes fills them from “${login.title}”${login.account ? ` (${login.account})` : ''} after the user agrees; if ${name} already shows ${login.account ?? 'the account'}, just click it.)`
    : `(That’s “${item.title}”’s sign-in with ${name}. On ${name}’s page, browser_type with an empty text fills its boxes if the user keeps that login in Passwords; otherwise call browser_handoff.)`;
}

/** The ones to offer first: the closest match, all of them if it's a tie. */
function closest<T extends { match?: string }>(items: T[]): T[] {
  const best = items[0]?.match;
  return best ? items.filter((i) => i.match === best) : items;
}

// ── The agent's fill (browser_type) ─────────────────────────────────────────

export interface AgentFillDeps {
  passwords: PasswordFiller;
  permissionMode: PermissionMode;
  ask: (request: AskRequest) => Promise<PermissionDecision>;
  /** The chat read something untrusted: why, for the card (no "Always" then). */
  untrusted?: () => string | undefined;
  /** Show the Unlock card and wait (false: it stayed locked). */
  unlock: () => Promise<boolean>;
  /** A thumbnail of the page with the box marked, for the card. */
  picture: (target: Locator) => Promise<{ box?: BrowserPermission['box']; shot?: string }>;
  check: () => void;
  /**
   * What the person already settled (ADR 0131, 2026-10-27): a sign-in their own words asked
   * for on this site or item, and a payment here they already said yes to, or that sits
   * inside a limit they named. Absent: every fill asks as before.
   */
  consent?: {
    signIn: (title: string, host: string) => boolean;
    payment: (host: string) => Promise<boolean>;
    paid: (host: string) => void;
  };
}

export type AgentFill =
  /** It went in: the agent hears what, never the value. */
  | { kind: 'filled'; label: string; text: string }
  /** Nothing went in, and the agent should hear why. */
  | { kind: 'said'; label: string; text: string }
  /** Nothing Conch can fill: the person types it (with a reason for them, and what the agent hears after). */
  | { kind: 'handoff'; reason?: string; note?: string }
  /** Not a box Passwords fills: type as usual. */
  | { kind: 'type' };

/**
 * `browser_type` on a box Passwords may fill (ADR 0130): a password, a code,
 * a card, a new password on a sign-up or a change, or (with nothing to type)
 * the username of a sign-in.
 */
export async function agentFill(
  deps: AgentFillDeps,
  tab: Tab,
  target: Locator,
  options: { secret?: SecretKind; text: string; item?: string; element: string },
): Promise<AgentFill> {
  const { passwords, check } = deps;
  if (options.secret === 'identity') return { kind: 'handoff' };
  // Only an empty username box is Conch's: anything the agent types goes in as usual.
  if (!options.secret && options.text) return { kind: 'type' };
  const at = await around(tab.page, target);
  if (!at) return options.secret ? { kind: 'handoff' } : { kind: 'type' };
  if ('blocked' in at) {
    if (!options.secret) return { kind: 'type' };
    return {
      kind: 'handoff',
      reason:
        at.blocked === 'frame'
          ? `This sign-in box comes from another site inside the page, so Conch won’t fill it. Type it yourself only if you trust it, then hand the browser back.`
          : `This page isn’t secure (no https), so Conch won’t fill a password here. Type it yourself only if you trust it, then hand the browser back.`,
    };
  }
  try {
    const role =
      at.role ??
      (options.secret === 'payment' ? 'cardNumber' : options.secret ? 'password' : undefined);
    if (!role || (!options.secret && role !== 'username')) return { kind: 'type' };
    if (deps.permissionMode === 'plan')
      return {
        kind: 'said',
        label: 'Read only',
        text: 'This chat is in Read only mode, so you can read pages but not fill them. Tell the user what you’d do instead.',
      };
    if (!(await deps.unlock()))
      return {
        kind: 'said',
        label: 'Passwords stayed locked',
        text: 'The user’s Passwords is locked and wasn’t unlocked. Ask them to unlock it, or hand the field to them.',
      };
    check();
    const found = await candidates(passwords, at.host, role);
    // On a provider's page, in the sign-in a site started (ADR 0133): that site's account.
    const chain = CARD_ROLES.has(role) ? undefined : chainHere(tab, at.host, found);
    if (!found.length && !options.item) {
      if (!CARD_ROLES.has(role)) {
        const fake = await passwords.lookalike?.(at.host).catch(() => undefined);
        if (fake)
          return {
            kind: 'said',
            label: `Didn’t fill: this isn’t ${fake}`,
            text: `This page is on ${at.host}, which looks like ${fake} but isn’t it: it may be a fake site made to steal passwords. Conch won’t fill anything here, and you must not ask the user to type a password here. Tell them plainly, and don’t sign in.`,
          };
      }
      if (role === 'new-password') return await newPassword(deps, tab, target, at, undefined);
      if (chain)
        return {
          kind: 'handoff',
          reason: `Sign in to ${chain.name} for ${chain.fromTitle} yourself, then hand the browser back.`,
          note: `Nothing is saved in Passwords for ${chain.name}’s sign-in, so the user signed in to ${chain.name} themselves (you never see it).`,
        };
      if (role === 'totp') {
        // A site that sends its code by email: say where the code is.
        const linked = signInItemOf(await candidates(passwords, at.host, 'password'));
        if (linked?.signIn.via === 'link') {
          const to = linked.signIn.account ?? linked.account;
          return {
            kind: 'handoff',
            reason: `Type the code ${linked.title} sent ${to ? `to ${to}` : 'you by email'} into “${options.element}”, then hand the browser back.`,
            note: `“${linked.title}” sends its code by email, so the user typed it themselves (you never see it).`,
          };
        }
      }
      if (role === 'username')
        return {
          kind: 'said',
          label: `Nothing saved for ${at.host}`,
          text: `The user has nothing saved in Passwords for ${at.host}. Ask them which account to use, or call browser_handoff so they sign in themselves.`,
        };
      return {
        kind: 'handoff',
        ...(role === 'totp' && {
          reason: `Type the code from your authenticator app or text message into “${options.element}”, then hand the browser back.`,
        }),
      };
    }
    // The item saved here signs in some other way (ADR 0133): say how, and go that way.
    let after = '';
    if (!chain && (role === 'username' || role === 'password')) {
      const pool = options.item ? found.filter((f) => f.id === options.item) : found;
      const other = signInItemOf(pool);
      if (other) {
        const item = signInItem(other);
        const way = await otherWay(deps, tab, at, item, other.item, role);
        if (way) return way;
        after = signInSteps(item, { filledUsername: true });
      }
    }
    if (role === 'new-password') {
      const grant = signInFor(tab, at.host);
      const item =
        options.item ??
        (grant && found.some((f) => f.id === grant.itemId) ? grant.itemId : undefined) ??
        (closest(found).length === 1 ? closest(found)[0]?.id : undefined);
      return await newPassword(deps, tab, target, at, item);
    }
    // Which item: the agent's, the sign-in already under way, the account typed, or the closest.
    const grant = signInFor(tab, at.host);
    const typed = role === 'password' || role === 'totp' ? await typedAccount(at) : '';
    let chosen =
      options.item ??
      (grant && found.some((f) => f.id === grant.itemId) ? grant.itemId : undefined) ??
      (typed ? found.find((f) => f.account?.toLowerCase() === typed)?.id : undefined) ??
      chainedItem(chain, found);
    const choices = chosen ? [] : closest(found);
    if (!chosen && choices.length === 1) chosen = choices[0]?.id;
    const first = chosen ?? choices[0]?.id;
    if (!first) return { kind: 'handoff' };
    let policy: FillPolicy;
    try {
      policy = await passwords.fillPolicy({
        itemId: first,
        host: at.host,
        want: WANT[role] ?? 'password',
      });
    } catch (error) {
      return {
        kind: 'said',
        label: `Didn’t fill “${options.element}”`,
        text: `${(error as Error).message} Hand the field to the user instead, or ask them.`,
      };
    }
    const want = WANT[role];
    if (chosen && want && policy.has && !policy.has.includes(want)) {
      if (role === 'totp')
        return {
          kind: 'handoff',
          reason: `Type the code from your authenticator app or text message into “${options.element}”, then hand the browser back.`,
        };
      if (role === 'username')
        return {
          kind: 'said',
          label: `No username saved in “${policy.title}”`,
          text: `“${policy.title}” has no username saved. Ask the user which account to use.`,
        };
    }
    const covered = grant && chosen === grant.itemId;
    const card = CARD_ROLES.has(role);
    // The person's words asked for this sign-in, or already settled this payment: no card.
    // Several accounts still ask which one.
    const settled =
      choices.length <= 1 &&
      (card
        ? Boolean(await deps.consent?.payment(at.host))
        : Boolean(deps.consent?.signIn(policy.title, at.host)));
    const asking = !settled && (choices.length > 1 || (policy.ask && !covered) || card);
    if (asking) {
      let picked = chosen;
      const accounts =
        choices.length > 1
          ? choices.slice(0, 8).map(({ id, title, account, source }) => ({
              id,
              title,
              ...(account && { account }),
              ...(source && { source }),
            }))
          : undefined;
      const decision = await askFill(deps, tab, target, {
        site: CARD_ROLES.has(role) ? at.host : policy.site,
        host: at.host,
        role,
        policy,
        ...(chain && { chain }),
        ...(accounts && { accounts }),
        choose: (id) => {
          if (!accounts?.some((a) => a.id === id)) throw new Error('Not one of the choices.');
          picked = id;
        },
      });
      if (decision === 'deny')
        return {
          kind: 'said',
          label: `You didn’t fill “${options.element}”`,
          text: 'The user doesn’t want Conch to fill that from their passwords. Ask them how they’d like to continue.',
        };
      // Allowed without picking (a chat app's Allow): the closest, most recently used one.
      chosen = picked ?? first;
      // A yes to the card here carries the order click on this site (one card per payment).
      if (card) deps.consent?.paid(at.host);
      if (decision === 'allow-always' && !CARD_ROLES.has(role))
        await passwords.allowAgent(chosen, at.host).catch(() => undefined);
      if (chosen !== first)
        policy = await passwords.fillPolicy({
          itemId: chosen,
          host: at.host,
          want: want ?? 'password',
        });
    }
    chosen ??= first;
    check();
    let done: FieldRole[];
    try {
      done = await fillAround(passwords, at, chosen, role, check);
    } catch (error) {
      return {
        kind: 'said',
        label: `Couldn’t fill “${options.element}”`,
        text: `${(error as Error).message} Hand the field to the user instead.`,
      };
    }
    if (!done.length)
      return {
        kind: 'said',
        label: `Couldn’t fill “${options.element}”`,
        text: 'Conch couldn’t put it into that box. Hand the field to the user instead.',
      };
    if (!CARD_ROLES.has(role)) rememberSignIn(tab, chosen, at.host);
    const what = done.includes(role) ? filledWords(role) : filledWords(done[0] ?? role);
    const also = done.filter((r) => r !== role).map(filledWords);
    const through = chain
      ? ` This is “${chain.fromTitle}”’s sign-in with ${chain.name}: carry on through ${chain.name}’s pages, and it sends you back to ${chain.fromTitle}.`
      : '';
    return {
      kind: 'filled',
      label: `Filled ${what} from Passwords`,
      text: `Conch filled ${what}${also.length ? ` (and ${also.join(', ')})` : ''} from the user’s saved item “${policy.title}” (you never see it). Carry on.${through}${after ? ` ${after}` : ''}`,
    };
  } finally {
    await unmark(at.frame);
  }
}

/**
 * A box on a site whose item signs in some other way (ADR 0133): instead of a
 * password, what to press and what happens next. A passkey Conch can't use
 * goes to the person, said plainly. Undefined: fill the box as usual (the
 * email for a company sign-in or an emailed link).
 */
async function otherWay(
  deps: AgentFillDeps,
  tab: Tab,
  at: Around,
  item: SignInItem,
  listed: Matched | undefined,
  role: FieldRole,
): Promise<AgentFill | undefined> {
  const { signIn } = item;
  if ((signIn.via === 'sso' || signIn.via === 'link') && role === 'username') return undefined;
  if (signIn.via === 'passkey' && signIn.usable === false)
    return { kind: 'handoff', reason: passkeyHandoffReason(item), note: passkeyHandedNote(item) };
  const { button, choices } = await agentButtons(tab, item);
  const login = await beginChain(deps.passwords, tab, at.host, item, listed);
  const label =
    signIn.via === 'passkey'
      ? `${item.title} signs in with a passkey`
      : signIn.via === 'link'
        ? `${item.title} signs in with an emailed link`
        : `${item.title} signs in with ${viaName(signIn)}`;
  return {
    kind: 'said',
    label,
    text: signInSteps(item, {
      ...(button && { button }),
      ...(choices && { choices }),
      ...(login && { with: login }),
    }),
  };
}

/** A strong password for a sign-up or a change: asked every time, saved, then typed in. */
async function newPassword(
  deps: AgentFillDeps,
  tab: Tab,
  target: Locator,
  at: Around,
  itemId: string | undefined,
): Promise<AgentFill> {
  const { passwords } = deps;
  if (!passwords.saveNewPassword) return { kind: 'handoff' };
  let policy: FillPolicy | undefined;
  if (itemId)
    policy = await passwords
      .fillPolicy({ itemId, host: at.host, want: 'password' })
      .catch(() => undefined);
  const decision = await askFill(deps, tab, target, {
    site: policy?.site ?? at.host,
    host: at.host,
    role: 'new-password',
    ...(policy && { policy }),
  });
  if (decision === 'deny')
    return {
      kind: 'said',
      label: 'You didn’t make a new password',
      text: 'The user doesn’t want Conch to make a password here. Ask them how they’d like to continue, or call browser_handoff so they type one.',
    };
  deps.check();
  const user = at.fields.find((f) => !f.empty && at.roles.get(f.mark) === 'username');
  const username = user ? (await valueOf(at.frame, user.mark)).trim().slice(0, 200) : undefined;
  const password = generatePassword();
  let saved: Awaited<ReturnType<NonNullable<PasswordFiller['saveNewPassword']>>>;
  try {
    saved = await passwords.saveNewPassword({
      origin: at.origin,
      host: at.host,
      password,
      ...(username && { username }),
      ...(policy && itemId && { itemId }),
    });
  } catch (error) {
    return {
      kind: 'said',
      label: 'Couldn’t save a new password',
      text: `${(error as Error).message} Hand the field to the user instead.`,
    };
  }
  deps.check();
  await fillNew(at, password, saved.previous);
  rememberSignIn(tab, saved.itemId, at.host);
  return {
    kind: 'filled',
    label: saved.created
      ? `Saved a new password for ${at.host}`
      : `Changed the password in “${saved.title}”`,
    text: saved.created
      ? `Conch made a strong password, saved it in the user’s Passwords as “${saved.title}” and filled it in, the confirmation box too (you never see it). Submit the form now. If the site refuses it, tell the user.`
      : `Conch made a strong new password, saved it in “${saved.title}” (the old one is kept in its history) and filled it in (you never see it). Submit the form now. If the site refuses it, tell the user: the old password is still in the item’s history.`,
  };
}

/** The one question a fill asks: calm, with the account (or the accounts to choose from). */
async function askFill(
  deps: AgentFillDeps,
  tab: Tab,
  target: Locator,
  request: {
    site: string;
    host: string;
    role: FieldRole;
    policy?: FillPolicy;
    accounts?: BrowserFillAccount[];
    choose?: (id: string) => void;
    /** A provider's sign-in for one of the person's sites (ADR 0133): the card says which. */
    chain?: Chain;
  },
): Promise<PermissionDecision> {
  const { role, policy, accounts, chain } = request;
  const kind = kindOf(role);
  const title = policy?.title ?? '';
  const through =
    chain && (kind === 'sign-in' || kind === 'code')
      ? `Sign in to “${chain.fromTitle}” with ${chain.name}${!accounts && policy?.account ? ` as ${policy.account}` : ''}`
      : undefined;
  const action =
    through ??
    (kind === 'new-password'
      ? policy
        ? `Make a new password for “${title}”`
        : `Make a strong password for ${request.host}`
      : kind === 'card'
        ? accounts
          ? 'Fill in a saved card'
          : `Fill in “${title}”`
        : kind === 'code'
          ? `Fill the code for “${title}”`
          : accounts
            ? 'Sign in'
            : policy?.account
              ? `Sign in as ${policy.account}`
              : `Sign in with “${title}”`);
  const picture = await deps.picture(target);
  const untrusted = deps.untrusted?.();
  return deps.ask({
    toolName: 'browser_fill',
    input: { site: request.site, item: title, field: role },
    summary: `${action.charAt(0).toLowerCase()}${action.slice(1)} on ${request.site}`,
    browser: {
      kind: 'fill',
      site: request.site,
      url: tab.page.url(),
      title: await tab.page.title().catch(() => ''),
      action,
      fill: kind,
      ...(picture.box && { box: picture.box }),
      ...(picture.shot && { shot: picture.shot }),
      ...(accounts && { accounts }),
      ...(policy?.match === 'related' && { savedFor: policy.site }),
      ...(through && chain && { for: chain.fromTitle }),
    },
    ...(untrusted && { taint: `${untrusted} So I’m checking before I fill it.` }),
    ...(accounts && request.choose && { choose: request.choose }),
  });
}

// ── Your own hands (the live view) ──────────────────────────────────────────

/** Marks the box you're in (in whichever frame) and returns it. */
async function focusedBox(page: Page): Promise<Locator | undefined> {
  for (const frame of page.frames()) {
    const found = await frame
      .evaluate((attr: string) => {
        interface El {
          tagName: string;
          shadowRoot?: { activeElement: El | null } | null;
          setAttribute(n: string, v: string): void;
          removeAttribute(n: string): void;
        }
        const doc = (
          globalThis as unknown as {
            document: {
              hasFocus(): boolean;
              activeElement: El | null;
              querySelectorAll(s: string): ArrayLike<El>;
            };
          }
        ).document;
        for (const old of Array.from(doc.querySelectorAll(`[${attr}]`))) old.removeAttribute(attr);
        let el = doc.activeElement;
        while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
        if (!doc.hasFocus() || !el || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return false;
        el.setAttribute(attr, '1');
        return true;
      }, FOCUS_ATTR)
      .catch(() => false);
    if (found) return frame.locator(`[${FOCUS_ATTR}]`).first();
  }
  return undefined;
}

/** What the live view says about an item that signs in some other way (names only). */
async function signInOfferOf(
  passwords: PasswordFiller,
  item: SignInItem,
  listed: Matched | undefined,
  buttons: readonly PageButton[],
): Promise<BrowserSignInOffer> {
  const open = unnamed(item.signIn);
  const button = open ? undefined : buttonFor(buttons, item.signIn)?.label;
  const choices = open ? providerChoices(buttons).map((b) => b.label.slice(0, 120)) : [];
  const { signIn } = item;
  const login =
    signIn.via === 'provider' && listed
      ? await providerLogin(passwords, listed).catch(() => undefined)
      : undefined;
  const account = signIn.account ?? item.subtitle;
  const known = signIn.provider && signIn.provider !== 'other' ? signIn.provider : undefined;
  return {
    via: signIn.via,
    ...(signIn.via === 'provider' && known && { provider: known }),
    name: (signIn.via === 'passkey' || signIn.via === 'link' ? item.title : viaName(signIn)).slice(
      0,
      80,
    ),
    ...(account && { account: account.slice(0, 200) }),
    ...(button && { button: button.slice(0, 120) }),
    ...(choices.length && { buttons: choices }),
    ...(login && { with: login }),
    ...(signIn.via === 'passkey' && { usable: signIn.usable !== false }),
    ...(signIn.via === 'passkey' &&
      signIn.usable === false && { keptIn: keptIn(item.source).slice(0, 40) }),
  };
}

/**
 * Not in a box: if the page's item signs in some other way (ADR 0133) and
 * the page shows a way to sign in, what the live view offers: "Product Hunt
 * signs in with Google", with the page's own button to press.
 */
async function signInOffer(
  passwords: PasswordFiller,
  tab: Tab,
): Promise<BrowserFillOffer | undefined> {
  const where = fillHost(tab.page.url(), undefined);
  if ('blocked' in where) return undefined;
  // The page's own sign-in buttons first: most pages have none, and then nothing is asked of Passwords.
  const buttons = await pageButtons(tab.page).catch(() => []);
  if (!buttons.length) return undefined;
  if (await passwords.isLocked?.()) return undefined;
  const found = await candidates(passwords, where.host, 'password').catch(() => []);
  const other = signInItemOf(found);
  if (!other) return undefined;
  const item = signInItem(other);
  return {
    field: 'sign-in',
    site: where.host.replace(/^www\./, ''),
    items: [{ id: item.id, title: item.title, ...(other.account && { account: other.account }) }],
    signIn: await signInOfferOf(passwords, item, other.item, buttons),
  };
}

function offerField(role: FieldRole): BrowserFillOffer['field'] {
  if (CARD_ROLES.has(role)) return 'card';
  if (role === 'totp') return 'code';
  return role === 'new-password' ? 'new-password' : role === 'username' ? 'username' : 'password';
}

/**
 * After your click in the live view: if you're in a box Passwords can fill,
 * what it can fill there (names only), or why not.
 */
export async function offerFor(
  passwords: PasswordFiller | undefined,
  tab: Tab,
): Promise<BrowserFillOffer | undefined> {
  if (!passwords) return undefined;
  await markSecrets(tab.page);
  const box = await focusedBox(tab.page);
  if (!box) return signInOffer(passwords, tab);
  const secret = await box.getAttribute(SECRET_ATTR, { timeout: 1_000 }).catch(() => null);
  const at = await around(tab.page, box);
  if (!at) return undefined;
  let site = '';
  try {
    site = new URL(tab.page.url()).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
  if ('blocked' in at)
    return secret === 'password' || secret === 'payment'
      ? { field: secret === 'payment' ? 'card' : 'password', site, items: [], blocked: at.blocked }
      : undefined;
  try {
    const role = at.role;
    if (!role) return undefined;
    const field = offerField(role);
    if (await passwords.isLocked?.()) return { field, site, items: [], locked: true };
    const found = await candidates(passwords, at.host, role);
    // On a provider's page in a site's sign-in (ADR 0133): that site's account first.
    const chain = CARD_ROLES.has(role) ? undefined : chainHere(tab, at.host, found);
    const first = chainedItem(chain, found);
    const ordered = first
      ? [...found.filter((f) => f.id === first), ...found.filter((f) => f.id !== first)]
      : found;
    const items = ordered.slice(0, 8).map(({ id, title, account, source }) => ({
      id,
      title,
      ...(account && { account }),
      ...(source && { source }),
    }));
    if (!items.length && !CARD_ROLES.has(role)) {
      const fake = await passwords.lookalike?.(at.host).catch(() => undefined);
      if (fake) return { field, site, items: [], lookalike: fake };
      if (role !== 'new-password') return undefined;
    }
    // The site's own item signs in some other way: say so, with its button.
    const other = !chain && (role === 'username' || role === 'password') && signInItemOf(found);
    if (other) {
      const item = signInItem(other);
      const buttons = await pageButtons(tab.page).catch(() => []);
      const signIn = await signInOfferOf(passwords, item, other.item, buttons);
      // The email for a company sign-in or a link is still the box's to fill.
      const fills =
        role === 'username' && (item.signIn.via === 'sso' || item.signIn.via === 'link');
      return fills
        ? { field, site, items, signIn }
        : { field: 'sign-in', site, items: items.filter((i) => i.id === item.id), signIn };
    }
    return {
      field,
      site,
      items: role === 'new-password' ? [] : items,
      ...(chain && first && { for: chain.fromTitle.slice(0, 200) }),
    };
  } finally {
    await unmark(at.frame);
  }
}

/**
 * You pressed "Continue with Google" (or the passkey, or the company sign-in)
 * on the live view's offer (ADR 0133). Everything is found again here: the
 * item saved for this page, how it signs in, and the page's own button for
 * it. A provider's sign-in is remembered, so Google's pages offer the right
 * account; a passkey Conch holds is put in for this site only.
 */
async function personSignIn(
  passwords: PasswordFiller,
  tab: Tab,
  itemId: string | undefined,
  chosen: string | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const where = fillHost(tab.page.url(), undefined);
  if ('blocked' in where)
    return { ok: false, message: 'This page isn’t secure, so Conch won’t sign in here.' };
  const found = await candidates(passwords, where.host, 'password').catch(() => []);
  const other = signInItemOf(found.filter((f) => f.id === itemId));
  if (!itemId || !other) return { ok: false, message: 'That item isn’t saved for this site.' };
  const item = signInItem(other);
  const { signIn } = item;
  const buttons = await pageButtons(tab.page).catch(() => []);
  // Saved without saying whose account: the provider button the person chose, by its words.
  const button = unnamed(signIn)
    ? providerChoices(buttons).find((b) => b.label === chosen)
    : buttonFor(buttons, signIn);
  if (signIn.via === 'passkey') {
    if (signIn.usable === false)
      return {
        ok: false,
        message: `This passkey is kept in ${keptIn(item.source)}, which Conch’s browser can’t use.`,
      };
    const saved = (await passwords.passkeysFor?.(where.host).catch(() => [])) ?? [];
    const pick = saved.find((p) => p.itemId === item.id);
    if (!pick || !passwords.passkeyCredential)
      return { ok: false, message: 'There’s no passkey saved for this site.' };
    const credential = await passwords
      .passkeyCredential(pick.itemId, pick.passkeyId, where.host)
      .catch((e: Error) => e);
    if (credential instanceof Error) return { ok: false, message: credential.message };
    await armSignIn(tab.page, credential, (signCount) => {
      void passwords
        .passkeyUsed?.(pick.itemId, credential.credentialId, signCount)
        .catch(() => undefined);
    });
    tab.touched = true;
    if (button && !(await pressButton(button)))
      return { ok: false, message: 'Your passkey is ready. Press the site’s passkey button.' };
    return { ok: true };
  }
  if (signIn.via === 'link')
    return {
      ok: false,
      message: 'Enter your email on the page: the site sends you a link or a code.',
    };
  if (!button)
    return {
      ok: false,
      message:
        signIn.via === 'provider'
          ? unnamed(signIn)
            ? 'Press the page’s button for the account you sign in with.'
            : `Press the page’s “Continue with ${viaName(signIn)}” button.`
          : 'Press the page’s single sign-on button, or enter your work email.',
    };
  if (signIn.via === 'provider')
    await beginChain(passwords, tab, where.host, item, other.item, button.provider);
  tab.touched = true;
  if (!(await pressButton(button)))
    return { ok: false, message: `Couldn’t press “${button.label}”. Press it on the page.` };
  return { ok: true };
}

/**
 * You pressed an item (or "Use a strong password") in the live view. The box
 * is found again here, and every check runs again: the offer you saw is
 * never trusted. Your press is the OK, so nothing asks.
 */
export async function personFill(
  passwords: PasswordFiller | undefined,
  tab: Tab,
  request: { item?: string; generate?: boolean; signIn?: boolean; button?: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!passwords) return { ok: false, message: 'Passwords isn’t available.' };
  if (tab.control !== 'user') return { ok: false, message: 'Take over first, then choose it.' };
  if (await passwords.isLocked?.())
    return { ok: false, message: 'Passwords is locked. Unlock it in Passwords first.' };
  if (request.signIn) return personSignIn(passwords, tab, request.item, request.button);
  await markSecrets(tab.page);
  const box = await focusedBox(tab.page);
  if (!box) return { ok: false, message: 'Click the box to fill first.' };
  const at = await around(tab.page, box);
  if (!at) return { ok: false, message: 'Click the box to fill first.' };
  if ('blocked' in at)
    return {
      ok: false,
      message:
        at.blocked === 'frame'
          ? 'That box comes from another site inside the page, so Conch won’t fill it.'
          : 'This page isn’t secure, so Conch won’t fill a password here.',
    };
  try {
    const role = at.role;
    if (!role) return { ok: false, message: 'Passwords doesn’t fill that box.' };
    const found = await candidates(passwords, at.host, role);
    if (request.generate) {
      if (role !== 'new-password' || !passwords.saveNewPassword)
        return { ok: false, message: 'That box isn’t for a new password.' };
      const grant = signInFor(tab, at.host);
      const itemId =
        request.item ??
        (grant && found.some((f) => f.id === grant.itemId) ? grant.itemId : undefined) ??
        (closest(found).length === 1 ? closest(found)[0]?.id : undefined);
      const user = at.fields.find((f) => !f.empty && at.roles.get(f.mark) === 'username');
      const username = user ? (await valueOf(at.frame, user.mark)).trim().slice(0, 200) : undefined;
      const password = generatePassword();
      const saved = await passwords.saveNewPassword({
        origin: at.origin,
        host: at.host,
        password,
        ...(username && { username }),
        ...(itemId && { itemId }),
      });
      await fillNew(at, password, saved.previous);
      rememberSignIn(tab, saved.itemId, at.host);
      tab.touched = true;
      return { ok: true };
    }
    if (!request.item || !found.some((f) => f.id === request.item))
      return { ok: false, message: 'That item isn’t saved for this site.' };
    // The site check again, in the vault's own words.
    await passwords.fillPolicy({
      itemId: request.item,
      host: at.host,
      want: WANT[role] ?? 'password',
    });
    // A "new password" box filled from an item is its current password, as the person chose.
    const done = await fillAround(
      passwords,
      at,
      request.item,
      role === 'new-password' ? 'password' : role,
      () => undefined,
    );
    if (!done.length) return { ok: false, message: 'Conch couldn’t put it into that box.' };
    if (!CARD_ROLES.has(role)) rememberSignIn(tab, request.item, at.host);
    tab.touched = true;
    return { ok: true };
  } catch (error) {
    return { ok: false, message: (error as Error).message.split('\n')[0] ?? 'That didn’t fill.' };
  } finally {
    await unmark(at.frame);
  }
}
