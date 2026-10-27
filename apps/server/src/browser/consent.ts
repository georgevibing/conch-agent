/**
 * What the person's own words already settle on a site, so Auto needs no card (ADR 0131,
 * 2026-10-27): a sign-in they asked for, a booking or a reply that Auto's review can weigh
 * against what they said, and an order within a limit they named. Money keeps its card
 * unless the total on the page is inside that limit. Only the person's words count
 * (`said`, empty when someone else is in the chat); a page can't write them.
 */

/** A control whose click Auto's review may weigh: communication, bookings, subscriptions, invites. */
const REVIEWABLE =
  /^(?:send(?: (?:it|now|message|email|reply|invite|invitation))?|post(?: (?:it|now|comment|reply))?|publish(?: (?:now|post))?|reply(?: all)?|comment|submit(?: (?:comment|reply|form|request|rsvp))?|book(?: (?:it|now|(?:a |this )?(?:table|slot|appointment|room|seat)))?|reserve(?: (?:now|(?:a |this )?(?:table|slot|seat|spot)))?|confirm(?: (?:booking|reservation|appointment|rsvp|attendance|subscription|cancellation))?|subscribe(?: now)?|unsubscribe(?: (?:me|from (?:this|all)(?: emails?| lists?)?))?|cancel(?: (?:subscription|membership|plan|booking|reservation|appointment))?|rsvp|accept(?: (?:invite|invitation|meeting))?|yes,? i'?m going|going|join(?: (?:now|meeting|call|waitlist|the waitlist))?)$/i;

/** Money on a control or in its words: these keep their card (or a limit the person named). */
const MONEY =
  /\b(?:buy|purchase|pay|payment|checkout|check out|order|donate|donation|transfer|withdraw|tip|deposit|top up|add funds|renew|renewal|upgrade|activate (?:plan|subscription|membership)|start (?:plan|my plan|subscription|membership)|kaufen|bestellen|bezahlen|zahlen|spenden|verlängern|acheter|payer|commander|renouveler|comprar|pagar|renovar|acquista|paga|rinnova|kopen|betalen|afrekenen|verlengen)\b|[$€£¥₹]|\d[.,]\d{2}\b/i;

/** Is clicking this resolved label something Auto's review may decide, rather than a card? */
export function reviewableClick(label: string): boolean {
  const name = label.replace(/\s+/g, ' ').trim();
  return Boolean(name) && !MONEY.test(name) && REVIEWABLE.test(name);
}

/** A control that spends money: placing an order, paying, donating. */
export function spendsMoney(label: string): boolean {
  return MONEY.test(label.replace(/\s+/g, ' ').trim());
}

const CURRENCIES: Record<string, string> = {
  $: 'USD',
  usd: 'USD',
  dollar: 'USD',
  dollars: 'USD',
  '€': 'EUR',
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
  '£': 'GBP',
  gbp: 'GBP',
  pound: 'GBP',
  pounds: 'GBP',
  '¥': 'JPY',
  jpy: 'JPY',
  yen: 'JPY',
  '₹': 'INR',
  inr: 'INR',
  chf: 'CHF',
};

const SYMBOL = '[$€£¥₹]';
const CODE = '(?:usd|eur|gbp|jpy|inr|chf|dollars?|euros?|pounds?|yen)';
const AMOUNT = '(\\d{1,7}(?:[.,]\\d{3})*(?:[.,]\\d{1,2})?)';

/** "1,234.50", "1.234,50", "49" as a number. */
function amountOf(text: string): number | undefined {
  let digits = text.trim();
  // The last separator followed by one or two digits is the decimal point.
  const decimal = /[.,](\d{1,2})$/.exec(digits);
  let cents = '';
  if (decimal) {
    cents = decimal[1] ?? '';
    digits = digits.slice(0, decimal.index);
  }
  const whole = digits.replace(/[.,]/g, '');
  if (!/^\d+$/.test(whole)) return undefined;
  const value = Number(`${whole}.${cents || '0'}`);
  return Number.isFinite(value) ? value : undefined;
}

function currencyOf(token: string | undefined): string | undefined {
  return token ? CURRENCIES[token.toLowerCase()] : undefined;
}

export interface Cap {
  amount: number;
  currency: string;
  /** "under $50": strictly less. "up to $50": at most. */
  strict: boolean;
}

const CAP = new RegExp(
  `\\b(under|below|less than|cheaper than|up to|at most|max(?:imum)?|no more than|not more than|within|unter|bis|moins de|jusqu'?à|menos de|hasta)\\s*(?:(${SYMBOL})\\s*${AMOUNT}|${AMOUNT}\\s*(${SYMBOL}|${CODE})(?![\\p{L}\\p{N}])|(${CODE})\\s*${AMOUNT})`,
  'iu',
);

/**
 * The spending limit the person named for this job, from their latest message that names one:
 * "buy it if under $50", "up to €30", "no more than 40 euros". None without a currency.
 */
export function capFrom(said: readonly string[]): Cap | undefined {
  for (let i = said.length - 1; i >= 0; i--) {
    const match = CAP.exec(said[i] ?? '');
    if (!match) continue;
    const [, word = '', sym1, amt1, amt2, unit2, code3, amt3] = match;
    const raw = amt1 ?? amt2 ?? amt3;
    const currency = currencyOf(sym1 ?? unit2 ?? code3);
    const amount = raw ? amountOf(raw) : undefined;
    if (amount === undefined || !currency || amount <= 0) continue;
    const strict = /^(?:under|below|less than|cheaper than|unter|moins de|menos de)$/i.test(
      word.toLowerCase(),
    );
    return { amount, currency, strict };
  }
  return undefined;
}

const TOTAL = new RegExp(
  `\\b(?:order total|grand total|total due|amount due|total to pay|total|you pay|to pay|gesamtsumme|gesamt|summe|montant total|total à payer|importe total|totale)\\b[^\\n\\d$€£¥₹]{0,40}?(?:(${SYMBOL})\\s*${AMOUNT}|${AMOUNT}\\s*(${SYMBOL}|${CODE})(?![\\p{L}\\p{N}])|(${CODE})\\s*${AMOUNT})`,
  'giu',
);

/** The same, with the word after the amount: "€384 total", "$42.10 in total". */
const TOTAL_AFTER = new RegExp(
  `(?:(${SYMBOL})\\s*${AMOUNT}|${AMOUNT}\\s*(${SYMBOL}|${CODE})(?![\\p{L}\\p{N}])|(${CODE})\\s*${AMOUNT})\\s*(?:in )?(?:total|gesamt|au total|en total)\\b`,
  'giu',
);

/** Every amount the page labels as a total. */
function totals(text: string): { amount: number; currency: string }[] {
  const found: { amount: number; currency: string }[] = [];
  for (const match of [...text.matchAll(TOTAL), ...text.matchAll(TOTAL_AFTER)]) {
    const [, sym1, amt1, amt2, unit2, code3, amt3] = match;
    const currency = currencyOf(sym1 ?? unit2 ?? code3);
    const raw = amt1 ?? amt2 ?? amt3;
    const amount = raw ? amountOf(raw) : undefined;
    if (currency && amount !== undefined) found.push({ amount, currency });
  }
  return found;
}

/**
 * The order's total as the page itself shows it, never as the model says: the largest
 * amount labelled as a total, in one currency. Undefined when there's none, or the page
 * shows totals in more than one currency.
 */
export function totalOnPage(text: string): { amount: number; currency: string } | undefined {
  const found = totals(text);
  if (new Set(found.map((t) => t.currency)).size !== 1) return undefined;
  return found.reduce((best, t) => (t.amount > best.amount ? t : best));
}

/** The page shows a total to pay, in any currency: a "Book now" there is paying. */
export function showsTotal(text: string): boolean {
  return totals(text).length > 0;
}

const PRICE = `(?:${SYMBOL}\\s*${AMOUNT}|${AMOUNT}\\s*(?:${SYMBOL}|${CODE})(?![\\p{L}\\p{N}])|${CODE}\\s*${AMOUNT})`;

/** A price that recurs or is taken now: "$9.99/month", "€120 per year", "€20 deposit". */
const CHARGE_AFTER = new RegExp(
  `${PRICE}\\s*(?:\\/\\s*(?:mo|mth|month|yr|year|wk|week|user|seat)\\b|(?:per|a|an|each)\\s+(?:month|year|week|user|seat)\\b|(?:monthly|yearly|annually|weekly|deposit|due today|billed|today)\\b|pro (?:monat|jahr)\\b|par mois\\b|al mes\\b|im monat\\b)`,
  'iu',
);

/** The same, the words first: "deposit of €20", "billed $99", "free for 7 days, then $9.99". */
const CHARGE_BEFORE = new RegExp(
  `\\b(?:deposit(?: of)?|due today|billed(?: (?:monthly|yearly|annually|today))?|then|renews? (?:at|for)|charged|you(?:'ll| will) be charged|anzahlung|acompte|depósito)\\b[^\\n\\d$€£¥₹]{0,24}?${PRICE}`,
  'iu',
);

/**
 * The page asks for money for this click, though no line says "total": a plan's price per
 * month, a deposit, what's billed after a trial. A "Subscribe" or "Book now" there is paying.
 */
export function showsCharge(text: string): boolean {
  return showsTotal(text) || CHARGE_AFTER.test(text) || CHARGE_BEFORE.test(text);
}

/** The page's total is inside the person's limit, in the same currency. */
export function withinCap(cap: Cap, total: { amount: number; currency: string }): boolean {
  if (cap.currency !== total.currency) return false;
  return cap.strict ? total.amount < cap.amount : total.amount <= cap.amount;
}

/** Words for signing in (the person asking for exactly that on a site). */
const SIGN_IN =
  /\b(?:sign(?:ing)?[ -]?in|log(?:ging)?[ -]?in|login|signin|anmelden|einloggen|connecte[rz]|iniciar sesi[oó]n|entrar|accedi|inloggen|account|dashboard|console|portal)\b/iu;

/** The brand in a host: `console.hetzner.cloud` → `hetzner`, `accounts.google.com` → `google`. */
export function brandOf(site: string): string | undefined {
  const label = site.toLowerCase().split('.')[0];
  return label && label.length >= 3 ? label : undefined;
}

/** Labels too plain to be anyone's brand: naming them names no site. */
const PLAIN = new Set([
  'www',
  'app',
  'apps',
  'web',
  'my',
  'login',
  'signin',
  'account',
  'accounts',
  'auth',
  'secure',
  'portal',
  'mail',
  'email',
  'online',
  'shop',
  'store',
  'home',
  'bank',
  'pay',
  'cloud',
]);

/**
 * Brands that are everyday words, and banks (2026-10-27): "chase down the invoice" isn't
 * "sign in to Chase". Naming one lifts a sign-in only beside a word for signing in (or the
 * saved item's own title, which the caller checks).
 */
const EVERYDAY = new Set([
  'chase',
  'target',
  'discover',
  'square',
  'apple',
  'box',
  'notion',
  'ally',
  'capital',
  'citizens',
  'wise',
  'chime',
  'current',
  'monzo',
  'revolut',
  'schwab',
  'fidelity',
  'vanguard',
  'citi',
  'wells',
  'barclays',
  'hsbc',
  'santander',
  'paypal',
  'venmo',
  'coinbase',
  'kraken',
  'robinhood',
]);

/**
 * The person's message names this site, by its brand as a word or by its address: "order the
 * ink on Amazon", "post this on LinkedIn", "cancel my Netflix". Signing in there is part of
 * what they asked for; the fill still only goes to the item's own site. A brand that's an
 * everyday word, or a bank's, also needs a word for signing in.
 */
export function namesSite(message: string, site: string): boolean {
  const folded = message
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
  if (folded.includes(site.toLowerCase())) return true;
  const brand = brandOf(site);
  if (!brand || PLAIN.has(brand)) return false;
  if (!new Set(folded.split(/[^\p{L}\p{N}]+/u)).has(brand)) return false;
  return !EVERYDAY.has(brand) || SIGN_IN.test(folded);
}

/**
 * The person's message asks to sign in to this site: it names the site's brand as a word
 * ("sign in to the Hetzner console", "log into my github account").
 */
export function asksSignIn(message: string, site: string): boolean {
  const brand = brandOf(site);
  if (!brand) return false;
  const folded = message
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
  const words = new Set(folded.split(/[^\p{L}\p{N}]+/u));
  return (words.has(brand) || folded.includes(site.toLowerCase())) && SIGN_IN.test(folded);
}

/** How long one yes about paying on a site carries the other half of that checkout. */
export const PAYMENT_WINDOW_MS = 10 * 60_000;

/**
 * One card for a payment: a yes to the order click, or to filling the saved card, on one
 * site covers the other half of that checkout there, for a few minutes, in this chat.
 */
export class PaymentYes {
  readonly #at = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  agreed(site: string): void {
    this.#at.set(site, this.now());
  }

  /** Covered once: the other half uses it up. */
  take(site: string): boolean {
    const at = this.#at.get(site);
    if (at === undefined) return false;
    this.#at.delete(site);
    return this.now() - at <= PAYMENT_WINDOW_MS;
  }
}
