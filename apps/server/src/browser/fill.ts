import {
  generatePassword,
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
 * Put a value into one marked box. A secret only goes where the masks are
 * (`SECRET_ATTR`), so it can't show in a screenshot the model looks at; a
 * username goes into any box.
 */
async function put(frame: Frame, mark: string, value: string, secret = true): Promise<boolean> {
  const box = frame.locator(`[${FILL_ATTR}="${mark}"]`).first();
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
      if (v && (await put(at.frame, f.mark, v, r !== 'cardholder'))) done.push(r);
    }
    return done;
  }
  const want = WANT[role];
  if (!want) return done;
  const v = await passwords.fillValue({ itemId, host: at.host, want });
  check();
  if (await put(at.frame, at.target.mark, v, role !== 'username')) done.push(role);
  if (role === 'password') {
    const user = at.fields.find((f) => f.empty && !f.target && at.roles.get(f.mark) === 'username');
    if (user) {
      const name = await value('username');
      check();
      if (name && (await put(at.frame, user.mark, name, false))) done.push('username');
    }
  }
  return done;
}

/** A new password into every new-password box, and the old one into an empty "current" box. */
async function fillNew(at: Around, password: string, previous: string | undefined): Promise<void> {
  for (const f of at.fields) {
    const r = at.roles.get(f.mark);
    if (r === 'new-password') await put(at.frame, f.mark, password);
    else if (r === 'password' && f.empty && previous) await put(at.frame, f.mark, previous);
  }
}

/** The account a form already has in its username box, to pick the item that goes with it. */
async function typedAccount(at: Around): Promise<string> {
  const user = at.fields.find((f) => !f.empty && at.roles.get(f.mark) === 'username');
  return user ? (await valueOf(at.frame, user.mark)).trim().toLowerCase() : '';
}

/** Saved items for a box, closest first: logins for this site, or cards. Names only. */
async function candidates(
  passwords: PasswordFiller,
  host: string,
  role: FieldRole,
): Promise<(BrowserFillAccount & { match?: string; totp?: boolean })[]> {
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
    }));
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
}

export type AgentFill =
  /** It went in: the agent hears what, never the value. */
  | { kind: 'filled'; label: string; text: string }
  /** Nothing went in, and the agent should hear why. */
  | { kind: 'said'; label: string; text: string }
  /** Nothing Conch can fill: the person types it (with a reason for them). */
  | { kind: 'handoff'; reason?: string }
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
      (typed ? found.find((f) => f.account?.toLowerCase() === typed)?.id : undefined);
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
    const asking = choices.length > 1 || (policy.ask && !covered) || CARD_ROLES.has(role);
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
    return {
      kind: 'filled',
      label: `Filled ${what} from Passwords`,
      text: `Conch filled ${what}${also.length ? ` (and ${also.join(', ')})` : ''} from the user’s saved item “${policy.title}” (you never see it). Carry on.`,
    };
  } finally {
    await unmark(at.frame);
  }
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
  },
): Promise<PermissionDecision> {
  const { role, policy, accounts } = request;
  const kind = kindOf(role);
  const title = policy?.title ?? '';
  const action =
    kind === 'new-password'
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
              : `Sign in with “${title}”`;
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
  if (!box) return undefined;
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
    const items = found.slice(0, 8).map(({ id, title, account, source }) => ({
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
    return { field, site, items: role === 'new-password' ? [] : items };
  } finally {
    await unmark(at.frame);
  }
}

/**
 * You pressed an item (or "Use a strong password") in the live view. The box
 * is found again here, and every check runs again: the offer you saw is
 * never trusted. Your press is the OK, so nothing asks.
 */
export async function personFill(
  passwords: PasswordFiller | undefined,
  tab: Tab,
  request: { item?: string; generate?: boolean },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!passwords) return { ok: false, message: 'Passwords isn’t available.' };
  if (tab.control !== 'user') return { ok: false, message: 'Take over first, then choose it.' };
  if (await passwords.isLocked?.())
    return { ok: false, message: 'Passwords is locked. Unlock it in Passwords first.' };
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
