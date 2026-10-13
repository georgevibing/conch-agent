/**
 * How an account signs in (ADR 0133), when it isn't (only) a password:
 * through another account ("Sign in with Google"), a passkey, a company's
 * single sign-on, or a link sent by email.
 *
 * Password managers that say so natively are read natively (in `sources.ts`).
 * For the rest, and for imports, `signInFromText` reads what the person wrote
 * on the item — its title, tags, notes, the labels and plain values of its
 * fields — and only ever on a login with **no password**: a phrase has to say
 * it outright ("Sign in with Google", "Google login", "Okta SSO", "magic
 * link"). A word on its own ("google" in a note) is never enough.
 *
 * `pickSignInItem` finds the saved login for the provider's own account (the
 * Google login for `signIn.account`), by the provider's sites only, through
 * `match.ts`: never a look-alike.
 */
import {
  SIGN_IN_PROVIDERS,
  signInName,
  siteOf,
  type VaultItemSummary,
  type VaultSignIn,
  type VaultSignInProvider,
} from '@conch/protocol';

import { bestMatch, byMatch, type SiteMatch } from './match';

type Known = Exclude<VaultSignInProvider, 'other'>;

/** The words each provider goes by. The first is how it's matched in a phrase. */
const WORDS: Record<Known, RegExp> = {
  google: /^(google|gmail|google\s+account|google\s+workspace|g\s?suite)$/i,
  apple: /^(apple|apple\s?id|apple\s+account|icloud)$/i,
  microsoft:
    /^(microsoft|microsoft\s+account|outlook|hotmail|live|azure\s?ad|entra(\s?id)?|office\s?365)$/i,
  facebook: /^(facebook|fb|meta)$/i,
  github: /^github$/i,
  gitlab: /^gitlab$/i,
  x: /^(x|twitter)$/i,
  linkedin: /^linked\s?in$/i,
  amazon: /^amazon$/i,
  discord: /^discord$/i,
  slack: /^slack$/i,
  okta: /^okta$/i,
};

/** Who a name means, when it's one of the providers Conch knows. */
export function providerOf(name: string): Known | undefined {
  const n = name.trim().replace(/\s+/g, ' ');
  for (const [id, words] of Object.entries(WORDS) as [Known, RegExp][])
    if (words.test(n)) return id;
  return undefined;
}

/** Whose sign-in an item's own sites are (accounts.google.com is Google's), never a look-alike. */
export function providerOfSites(urls: readonly string[]): Known | undefined {
  const hosts = urls.map((u) => siteOf(u)).filter((h): h is string => Boolean(h));
  for (const [id, { domains }] of Object.entries(SIGN_IN_PROVIDERS) as [
    Known,
    { domains: string[] },
  ][])
    if (domains.some((d) => bestMatch(hosts, d))) return id;
  return undefined;
}

/**
 * Words after "Sign in with" that aren't another account: the person's own
 * email, a password, a code. Lowercased.
 */
const NOT_A_PROVIDER = new Set([
  'a',
  'an',
  'the',
  'my',
  'your',
  'email',
  'e-mail',
  'mail',
  'username',
  'user',
  'password',
  'pass',
  'phone',
  'number',
  'mobile',
  'sms',
  'text',
  'code',
  'pin',
  'otp',
  'totp',
  'key',
  'touch',
  'face',
  'fingerprint',
  'biometrics',
  'credentials',
  'details',
  'it',
  'this',
  'that',
  'same',
  'new',
  'old',
  'work',
  'personal',
  'company',
  'ease',
]);

const VERB = String.raw`(?:sign(?:s|ed|ing)?[\s-]?(?:in|up|on)|log(?:s|ged|ging)?[\s-]?(?:in|on)|login|continue[sd]?|connect(?:s|ed)?|auth(?:enticate[sd]?|orized?)?|registered|created)`;
/** "Sign in with Google", "Continue with Apple", "logged in via Microsoft account". */
const PHRASE = new RegExp(
  String.raw`\b${VERB}\s+(?:with|via|through|using|by)\s+(?:my\s+|your\s+|the\s+|an?\s+)?([A-Za-z][\w.+-]*(?:\s+(?:id|account|workspace|ad|365|sso))?)`,
  'gi',
);
/** "Google login", "Apple sign-in", "GitHub OAuth", "Okta SSO". */
const NAMED = new RegExp(
  String.raw`\b([A-Za-z][\w.+-]*(?:\s+(?:id|account|workspace|ad|365))?)\s+(?:login|log-?in|sign[\s-]?in|signin|sso|oauth|single[\s-]sign[\s-]on)\b`,
  'gi',
);
const SSO = /\b(?:sso|single[\s-]sign[\s-]on|saml)\b/i;
/** A company's identity provider, named before SSO ("Acme SSO", "OneLogin"). */
const SSO_NAMED =
  /\b([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)?)\s+(?:SSO|[Ss]ingle[\s-][Ss]ign[\s-][Oo]n)\b/;
const IDPS = /\b(onelogin|auth0|jumpcloud|ping\s?identity|ping\s?federate|duo|keycloak|okta)\b/i;
const LINK =
  /\b(?:magic|e-?mail(?:ed)?|login|sign[\s-]?in)\s+link\b|\bpasswordless\b|\b(?:one[\s-]time|login|sign[\s-]?in)\s+code\s+(?:by|via|over|sent\s+to|to\s+my)\s+(?:e-?mail|sms|text|phone)\b/i;
const PASSKEY =
  /\b(?:passkey[\s-]only|only\s+(?:a\s+)?passkey|(?:sign(?:s|ed)?|log(?:s|ged)?)[\s-]?in\s+with\s+(?:a\s+|my\s+)?passkey|uses\s+(?:a\s+)?passkey)\b/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function account(text: string): string | undefined {
  return EMAIL.exec(text)?.[0]?.slice(0, 200);
}

/** What one phrase's provider word means: a known provider, another one by name, or nothing. */
function fromWord(word: string): VaultSignIn | undefined {
  const w = word.trim().replace(/[.+-]+$/, '');
  if (/^(passkey|a passkey)$/i.test(w)) return { via: 'passkey' };
  if (/^(sso|saml)$/i.test(w)) return { via: 'sso' };
  const first = w.split(/\s+/)[0] ?? '';
  const known = providerOf(w) ?? providerOf(first);
  if (known) return { via: 'provider', provider: known };
  if (/\ssso$/i.test(w)) return { via: 'sso' };
  // Someone else by name only when written as a name ("Steam", "Yahoo"), and never a plain word.
  if (!/^[A-Z]/.test(first) || NOT_A_PROVIDER.has(first.toLowerCase())) return undefined;
  if (/^(sso|link|code)$/i.test(first)) return undefined;
  return { via: 'provider', provider: 'other', name: first.slice(0, 80) };
}

/**
 * How a login with no password signs in, from the words on it. Undefined
 * unless one of them says so outright.
 */
export function signInFromText(texts: readonly (string | undefined)[]): VaultSignIn | undefined {
  const found = fromTexts(texts);
  if (!found || found.account || found.via === 'passkey' || found.via === 'link') return found;
  // The account it signs in through is usually the email the item shows ("Email: ada@gmail.com").
  const who = texts.map((t) => account(t ?? '')).find(Boolean);
  return who ? { ...found, account: who } : found;
}

function fromTexts(texts: readonly (string | undefined)[]): VaultSignIn | undefined {
  for (const raw of texts) {
    const text = (raw ?? '').slice(0, 4000);
    if (!text.trim()) continue;
    for (const pattern of [PHRASE, NAMED]) {
      pattern.lastIndex = 0;
      for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
        const found = fromWord(m[1] ?? '');
        // "Sign in with SSO" is SSO; "Acme SSO" falls through to the SSO rule below.
        if (!found || (pattern === NAMED && found.provider === 'other')) continue;
        const who = account(text);
        if (found.via === 'sso') return ssoFrom(text, who);
        return { ...found, ...(who && found.via === 'provider' && { account: who }) };
      }
    }
    if (PASSKEY.test(text)) return { via: 'passkey' };
    if (SSO.test(text)) return ssoFrom(text, account(text));
    if (LINK.test(text)) return { via: 'link' };
  }
  return undefined;
}

/**
 * How a login signs in, from what's known about it: nothing to say while it
 * has a password; a passkey when it holds one and nothing else; otherwise
 * what its own words say outright (`signInFromText`).
 */
export function signInFrom(item: {
  /** It has a password with something in it. Unknown counts as yes. */
  password: boolean | undefined;
  passkeys?: number;
  texts: readonly (string | undefined)[];
}): VaultSignIn | undefined {
  if (item.password !== false) return undefined;
  if (item.passkeys) return { via: 'passkey' };
  return signInFromText(item.texts);
}

function ssoFrom(text: string, who: string | undefined): VaultSignIn {
  const idp = IDPS.exec(text)?.[1];
  if (idp && /^okta$/i.test(idp))
    return { via: 'provider', provider: 'okta', ...(who && { account: who }) };
  const named = SSO_NAMED.exec(text)?.[1];
  const name = idp
    ? idp
    : named && !/^(the|use|via|with|company|work|our|my)$/i.test(named)
      ? `${named} SSO`
      : '';
  return { via: 'sso', ...(name && { name: name.slice(0, 80) }), ...(who && { account: who }) };
}

/** "Sign in with Google (ada@gmail.com)." on its own line, unless the notes already say it. */
export function signInLine(signIn: VaultSignIn): string {
  const who = signInName(signIn);
  const how =
    signIn.via === 'provider' || signIn.via === 'sso'
      ? `Sign in with ${who}`
      : signIn.via === 'passkey'
        ? 'Sign in with a passkey'
        : 'Sign in with an emailed link or code';
  return `${how}${signIn.account ? ` (${signIn.account})` : ''}.`;
}

/** Notes with the sign-in line on top, for a place that has nowhere else to keep it. */
export function withSignIn(notes: string, signIn: VaultSignIn | undefined): string {
  if (!signIn) return notes;
  const line = signInLine(signIn);
  if (notes.toLowerCase().includes(line.slice(0, -1).toLowerCase())) return notes;
  return notes ? `${line}\n${notes}` : line;
}

/** The words a search for it should find: "google", "sign in with google", "passkey", "sso". */
export function signInWords(signIn: VaultSignIn | undefined): string {
  if (!signIn) return '';
  const who =
    signIn.provider && signIn.provider !== 'other'
      ? SIGN_IN_PROVIDERS[signIn.provider].name
      : (signIn.name ?? '');
  const how =
    signIn.via === 'provider'
      ? `sign in with ${who}`
      : signIn.via === 'sso'
        ? `sso single sign-on ${who}`
        : signIn.via === 'passkey'
          ? 'passkey'
          : 'link code email';
  return `${how} ${signIn.account ?? ''}`.toLowerCase();
}

const tidy = (s: string) => s.trim().toLowerCase();

/** Whether a saved account is the one asked for: the same, or the same mailbox written short. */
function sameAccount(saved: string, wanted: string): 'exact' | 'short' | undefined {
  const a = tidy(saved);
  const b = tidy(wanted);
  if (!a || !b) return undefined;
  if (a === b) return 'exact';
  // "ada" for ada@gmail.com: only when one side has no domain at all.
  const local = (s: string) => s.split('@')[0];
  if (a.includes('@') !== b.includes('@') && local(a) === local(b)) return 'short';
  // Gmail ignores dots and the googlemail.com spelling.
  const gmail = (s: string) =>
    /@(gmail|googlemail)\.com$/.test(s) ? `${(local(s) ?? '').replace(/\./g, '')}@gmail.com` : s;
  return gmail(a) === gmail(b) ? 'exact' : undefined;
}

/**
 * The saved login for the account an item signs in through: on the
 * provider's own sites (never a look-alike: `match.ts` decides), whose
 * account is `signIn.account`. When the account isn't known, the one login
 * for that provider, if there's exactly one. Closest site first, then the one
 * used last.
 */
export function pickSignInItem(
  item: Pick<VaultItemSummary, 'id' | 'signIn'>,
  items: readonly VaultItemSummary[],
): VaultItemSummary | undefined {
  const signIn = item.signIn;
  if (signIn?.via !== 'provider' || !signIn.provider || signIn.provider === 'other')
    return undefined;
  const domains = SIGN_IN_PROVIDERS[signIn.provider].domains;
  const candidates: (VaultItemSummary & { match: SiteMatch })[] = [];
  for (const other of items) {
    if (other.id === item.id || other.deletedAt || other.type !== 'login') continue;
    if (other.source === 'system') continue;
    // A login that itself signs in through someone else isn't the provider's own account.
    if (other.signIn?.via === 'provider' || other.signIn?.via === 'sso') continue;
    let match: SiteMatch | undefined;
    for (const domain of domains) {
      const m = bestMatch(other.domains, domain);
      if (m && (!match || rank(m) < rank(match))) match = m;
    }
    if (match) candidates.push({ ...other, match });
  }
  if (!candidates.length) return undefined;
  const ordered = byMatch(candidates);
  const strip = ({ match: _, ...rest }: VaultItemSummary & { match: SiteMatch }) =>
    rest as VaultItemSummary;
  if (!signIn.account) return ordered.length === 1 && ordered[0] ? strip(ordered[0]) : undefined;
  const wanted = signIn.account;
  const exact = ordered.find((c) => sameAccount(c.subtitle, wanted) === 'exact');
  if (exact) return strip(exact);
  const short = ordered.filter((c) => sameAccount(c.subtitle, wanted) === 'short');
  return short.length === 1 && short[0] ? strip(short[0]) : undefined;
}

function rank(m: SiteMatch): number {
  return m === 'exact' ? 0 : m === 'within' ? 1 : 2;
}
