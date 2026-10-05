/**
 * Shared by the browser and the gateway: generating passwords, rating them,
 * and the templates each kind of item starts from (ADR 0025).
 */
import { estimateBits, isCommonPassword, isRepetition } from './access';
import type { GeneratorOptions, VaultFieldKind, VaultFieldRole, VaultItemType } from './vault';
import { EFF_SHORT_WORDS } from './words';

/** Web Crypto exists in browsers and Node ≥ 19; the protocol has neither's typings. */
const webCrypto = (globalThis as unknown as { crypto: { getRandomValues(a: Uint32Array): void } })
  .crypto;

/** A uniformly random integer in [0, n), by rejection sampling (no modulo bias). */
export function randomBelow(n: number): number {
  if (n <= 0 || n > 2 ** 32) throw new RangeError('randomBelow: n out of range');
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    webCrypto.getRandomValues(buf);
    const v = buf[0] ?? 0;
    if (v < limit) return v % n;
  }
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*-_=+?';
const AMBIGUOUS = /[O0oIl1|]/g;

function pick(alphabet: string): string {
  return alphabet.charAt(randomBelow(alphabet.length));
}

/** Fisher–Yates with the CSPRNG. */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}

const DEFAULTS: GeneratorOptions = {
  style: 'random',
  length: 20,
  symbols: true,
  digits: true,
  // Proton Pass and KeePassXC leave out look-alikes by default: fewer typos on a phone.
  unambiguous: true,
  separator: '-',
  capitalize: true,
};

/**
 * A new password. `random` uses every class asked for at least once (so a
 * site's "must contain a digit" rule is always met); `words` is an EFF-list
 * passphrase (~10.3 bits a word); `pin` is digits only.
 */
export function generatePassword(options: Partial<GeneratorOptions> = {}): string {
  const o = { ...DEFAULTS, ...options };
  if (o.style === 'pin') {
    const length = Math.min(Math.max(o.length, 4), 32);
    return Array.from({ length }, () => pick(DIGITS)).join('');
  }
  if (o.style === 'words') {
    const count = Math.min(Math.max(o.length, 3), 20);
    const words = Array.from({ length: count }, () => {
      const word = EFF_SHORT_WORDS[randomBelow(EFF_SHORT_WORDS.length)] ?? 'shell';
      return o.capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    });
    // A digit in one word, so sites that insist on one take it as it is.
    if (o.digits) {
      const at = randomBelow(words.length);
      words[at] = `${words[at] ?? ''}${pick(DIGITS)}`;
    }
    return words.join(o.separator);
  }
  const length = Math.min(Math.max(o.length, 8), 128);
  const clean = (alphabet: string) => (o.unambiguous ? alphabet.replace(AMBIGUOUS, '') : alphabet);
  const classes = [clean(LOWER), clean(UPPER)];
  if (o.digits) classes.push(clean(DIGITS));
  if (o.symbols) classes.push(SYMBOLS);
  const all = classes.join('');
  const chars = classes.map(pick);
  while (chars.length < length) chars.push(pick(all));
  return shuffle(chars).join('');
}

/**
 * The passwords people pick most (the top of the public breach-corpus lists:
 * NordPass, SplashData, HIBP's most common). Matched after taking off the
 * digits and symbols people tack on ("Password123!").
 */
const COMMON = new Set(
  (
    'password passw0rd p@ssw0rd qwerty qwertyuiop asdfgh asdfghjkl zxcvbnm azerty letmein welcome ' +
    'admin administrator root login master monkey dragon shadow sunshine princess football ' +
    'baseball soccer hockey superman batman trustno iloveyou starwars whatever freedom secret ' +
    'charlie michael jennifer jordan hunter ranger buster thomas tigger summer winter spring ' +
    'autumn computer internet google facebook instagram changeme default guest test hello ' +
    'abc abcd abcdef qwe qwer 1qaz2wsx 1q2w3e4r zaq12wsx'
  ).split(' '),
);

function isTooCommon(password: string): boolean {
  if (isCommonPassword(password)) return true;
  const lower = password.toLowerCase();
  // Walk from each edge once; a trailing-suffix regexp retries each digit
  // in a long run before a letter, freezing the password meter and checkup.
  let start = 0;
  let end = lower.length;
  while (start < end && !/[a-z]/.test(lower.charAt(start))) start++;
  while (end > start && !/[a-z]/.test(lower.charAt(end - 1))) end--;
  const core = lower.slice(start, end);
  if (COMMON.has(lower) || COMMON.has(core)) return true;
  // Digits only, and short: a PIN-like password is guessed at once.
  return /^\d{1,10}$/.test(password);
}

/** Labels for `passwordScore`, worst first. */
export const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;

/**
 * How hard a password is to guess, 0–4. Unlike Conch's own sign-in rule this
 * accepts anything (a site's password is whatever the site took); it only
 * says how it stands. Common passwords and repeats are 0 whatever their length.
 */
export function passwordScore(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  if (isTooCommon(password) || isRepetition(password)) return 0;
  const bits = estimateBits(password);
  if (bits < 28) return 0;
  if (bits < 40) return 1;
  if (bits < 60) return 2;
  if (bits < 80) return 3;
  return 4;
}

/** Weak enough to flag in the Security check. */
export const isWeakPassword = (password: string) => passwordScore(password) < 2;

// ── Templates ───────────────────────────────────────────────────────────────

export interface FieldTemplate {
  label: string;
  kind: VaultFieldKind;
  role?: VaultFieldRole;
}

export interface ItemTemplate {
  type: VaultItemType;
  /** "Login", shown in the picker. */
  name: string;
  /** One line under the name in the picker. */
  hint: string;
  fields: FieldTemplate[];
  /** Whether it has web addresses (logins, servers). */
  urls: boolean;
}

const f = (label: string, kind: VaultFieldKind, role?: VaultFieldRole): FieldTemplate => ({
  label,
  kind,
  ...(role && { role }),
});

/** What each kind of item starts with. Empty fields are left out when it's saved. */
export const VAULT_TEMPLATES: readonly ItemTemplate[] = [
  {
    type: 'login',
    name: 'Login',
    hint: 'A website or app you sign in to',
    urls: true,
    fields: [
      f('Username', 'text', 'username'),
      f('Password', 'secret', 'password'),
      f('One-time code', 'totp', 'totp'),
    ],
  },
  {
    type: 'card',
    name: 'Payment card',
    hint: 'Credit, debit or gift card',
    urls: false,
    fields: [
      f('Name on card', 'text', 'cardholder'),
      f('Number', 'secret', 'cardNumber'),
      f('Expires', 'monthYear', 'expiry'),
      f('Security code', 'pin', 'cvv'),
      f('PIN', 'pin', 'cardPin'),
    ],
  },
  {
    type: 'identity',
    name: 'Identity',
    hint: 'Your name, address and contact details, for forms',
    urls: false,
    fields: [
      f('First name', 'text', 'firstName'),
      f('Last name', 'text', 'lastName'),
      f('Email', 'email', 'email'),
      f('Phone', 'phone', 'phone'),
      f('Address', 'multiline', 'address'),
      f('Birthday', 'date', 'birthday'),
    ],
  },
  {
    type: 'note',
    name: 'Secure note',
    hint: 'Anything private, in your own words',
    urls: false,
    fields: [f('Note', 'secretText')],
  },
  {
    type: 'apiKey',
    name: 'API key',
    hint: 'A key or token for a service',
    urls: true,
    fields: [f('Key', 'secret', 'apiKey'), f('Secret', 'secret', 'secretKey')],
  },
  {
    type: 'wifi',
    name: 'Wi-Fi',
    hint: 'A network name and its password',
    urls: false,
    fields: [f('Network name', 'text', 'networkName'), f('Password', 'secret', 'password')],
  },
  {
    type: 'bank',
    name: 'Bank account',
    hint: 'Account and routing numbers',
    urls: true,
    fields: [
      f('Account holder', 'text', 'fullName'),
      f('Account number', 'secret', 'accountNumber'),
      f('Routing / sort code', 'text', 'routingNumber'),
      f('IBAN', 'secret', 'iban'),
      f('SWIFT / BIC', 'text', 'swift'),
      f('PIN', 'pin', 'cardPin'),
    ],
  },
  {
    type: 'sshKey',
    name: 'SSH key',
    hint: 'A private key and its passphrase',
    urls: false,
    fields: [
      f('Private key', 'secretText', 'privateKey'),
      f('Public key', 'multiline', 'publicKey'),
      f('Passphrase', 'secret', 'passphrase'),
    ],
  },
  {
    type: 'server',
    name: 'Server',
    hint: 'A machine you log in to',
    urls: true,
    fields: [
      f('Host', 'text', 'host'),
      f('Username', 'text', 'username'),
      f('Password', 'secret', 'password'),
    ],
  },
  {
    type: 'database',
    name: 'Database',
    hint: 'Where it is and how to connect',
    urls: false,
    fields: [
      f('Host', 'text', 'host'),
      f('Port', 'number', 'port'),
      f('Database', 'text', 'database'),
      f('Username', 'text', 'username'),
      f('Password', 'secret', 'password'),
    ],
  },
  {
    type: 'document',
    name: 'ID document',
    hint: 'Passport, driving licence, ID card',
    urls: false,
    fields: [
      f('Full name', 'text', 'fullName'),
      f('Number', 'secret', 'documentNumber'),
      f('Issued', 'date', 'issuedOn'),
      f('Expires', 'date', 'expiresOn'),
    ],
  },
  {
    type: 'license',
    name: 'Software licence',
    hint: 'A product key and who it’s for',
    urls: true,
    fields: [
      f('Licensed to', 'text', 'fullName'),
      f('Email', 'email', 'email'),
      f('Licence key', 'secret', 'licenseKey'),
    ],
  },
  {
    type: 'wallet',
    name: 'Crypto wallet',
    hint: 'Recovery phrase and wallet password',
    urls: false,
    fields: [
      f('Recovery phrase', 'secretText', 'recoveryPhrase'),
      f('Wallet password', 'secret', 'password'),
      f('Address', 'text', 'publicKey'),
    ],
  },
];

export function templateFor(type: VaultItemType): ItemTemplate {
  return VAULT_TEMPLATES.find((t) => t.type === type) ?? (VAULT_TEMPLATES[0] as ItemTemplate);
}

// ── Sites ───────────────────────────────────────────────────────────────────

/** WHATWG URL exists in browsers and Node; the protocol has neither's typings. */
const URLParser = (
  globalThis as unknown as {
    URL: new (input: string) => { protocol: string; hostname: string };
  }
).URL;

/**
 * The hostname a saved address stands for, lowercased, without `www.`.
 * Accepts what people type ("netflix.com", "https://accounts.google.com/x").
 */
export function siteOf(url: string): string | undefined {
  const raw = url.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URLParser(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    const host = parsed.hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
    return host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The same account in two places (Conch and 1Password, say), by names only:
 * no password is compared. A login is its site (or title, without one) and
 * its account; anything else is its kind and title. Copy to leaves out what
 * the other place already holds by this key, and an item's page links to
 * its twin by it (ADR 0062).
 */
export function sameAccountKey(item: {
  type: VaultItemType;
  title: string;
  /** A website it's for: a URL or a bare hostname. */
  site?: string;
  /** The account: a username or an email. */
  account?: string;
}): string {
  const tidy = (text: string) => text.trim().toLowerCase();
  if (item.type !== 'login') return `${item.type}\0${tidy(item.title)}`;
  const site = (item.site && siteOf(item.site)) ?? tidy(item.title);
  return `login\0${site}\0${tidy(item.account ?? '')}`;
}

/**
 * Whether a page on `host` may use an item saved for `site`: the same host,
 * or a subdomain of it (accounts.google.com for google.com). Never the other
 * way round, and never a lookalike (`google.com.evil.io`).
 */
export function siteMatches(site: string, host: string): boolean {
  const s = site.toLowerCase().replace(/^www\./, '');
  const h = host
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  if (!s || !h) return false;
  return h === s || h.endsWith(`.${s}`);
}
