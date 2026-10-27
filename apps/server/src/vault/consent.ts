import type { ToolContext } from '../conversations/manager';

/**
 * When Passwords needs no card to read an item or hand it to a command (ADR 0151,
 * 2026-10-26). Full trust is the person saying "don't ask me", so a key is used as any
 * other step is. In Auto, the person's own words naming the item are the answer the card
 * would get ("use the gh pat giotiskl"), except a grave value the model would read itself.
 * Read only and Ask first always ask, and so does a run nobody answers for: a task from a
 * watched chat, or your own chat app, counts as answered (`attended`), a routine doesn't.
 */
export type ConsentContext = Pick<
  ToolContext,
  'permissionMode' | 'fullTrust' | 'untrusted' | 'said' | 'unattended' | 'attended'
>;

export function consented(
  ctx: ConsentContext,
  title: string,
  {
    grave = false,
    loose = false,
  }: {
    grave?: boolean;
    /**
     * Into a command, unseen: "the PAT I saved" or "my Stripe key" names it too (`named`),
     * given the item's sites and the titles of the person's other items.
     */
    loose?: boolean | Kept;
  } = {},
): boolean {
  if (ctx.unattended && !ctx.attended) return false;
  const trust = ctx.fullTrust?.() ?? false;
  if (!trust && ctx.permissionMode !== 'auto') return false;
  // A card's PIN, a recovery phrase or a private key read into the model's own words: one
  // slip spends money or empties a wallet, so Auto shows the card even when it was named.
  if (grave && !trust) return false;
  // Only the person's words: empty when someone else is in the chat, so a page or a
  // stranger naming the item never counts.
  const kept = loose === true ? {} : loose || undefined;
  const match = (message: string) => (kept ? named(message, title, kept) : names(message, title));
  if ((ctx.said?.() ?? []).some(match)) return true;
  // Full trust still asks after someone else's words came in (`untrusted` leaves out
  // what a page said, since the person trusted the chat with that).
  return trust && !ctx.untrusted?.();
}

/** Words that, beside a one-word title, say the person means a saved secret. */
const SECRETS =
  /\b(?:password|passwort|passphrase|pass|pwd|pat|token|key|secret|credential|credentials|login|pin|api)\b/u;

/** The same words, one at a time, plurals too. */
const SECRET_WORD =
  /^(?:passwords?|passwort|passphrases?|pass|pwd|pats?|tokens?|keys?|secrets?|credentials?|login|pin|api)$/u;

/** Words that say it's one they keep: "the PAT I saved", "the token in Passwords". */
const KEPT = /^(?:saved|save|stored|kept|passwords|vault|1password|bitwarden|keychain)$/u;

/** Lower case, accents off, everything but letters and digits a space. */
function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);
}

/**
 * The message names the item: every word of its title is in it ("a gh pat giotiskl" names
 * "Gh pat giotiskl"). A title of one word ("GitHub") also needs a word for a secret, so
 * "check github" isn't taken as "use my GitHub password".
 */
export function names(message: string, title: string): boolean {
  const wanted = words(title);
  if (!wanted.length) return false;
  const said = new Set(words(message));
  if (!wanted.every((word) => said.has(word))) return false;
  return wanted.length > 1 || SECRETS.test([...said].join(' '));
}

/** What else Passwords knows about an item, for `named`. */
export interface Kept {
  /** The item's own sites ("github.com"): "my github token" names it. */
  sites?: readonly string[];
  /** The titles of the person's other items: a word shared with one of them names neither. */
  others?: readonly string[];
}

/** The part of a site people say: "github" for github.com, "cloudflare" for dash.cloudflare.com. */
function brand(site: string): string | undefined {
  const labels =
    site
      .toLowerCase()
      .replace(/^\w+:\/\//, '')
      .split('/')[0]
      ?.split('.') ?? [];
  // The label before the suffix, two labels back for a short country one ("bbc.co.uk").
  const tail = labels.length > 2 && (labels.at(-2)?.length ?? 0) <= 3 ? 3 : 2;
  const name = labels.at(-tail);
  return name && name.length >= 3 ? name : undefined;
}

/**
 * Named for a command that never shows it to the model (ADR 0151, 2026-10-27): as `names`
 * does, or a distinctive word of the title or of its site beside a word for a secret ("my
 * Stripe key" for "Stripe live key", "my github token" for an item at github.com), or a
 * secret word of the title beside one that says they keep it ("the PAT I saved" for "Gh pat
 * giotiskl"), but only when no other item's title has that secret word: "my saved key" is
 * no one key when "House key code" and "Stripe live key" are both saved (2026-10-27).
 */
export function named(
  message: string,
  title: string,
  { sites = [], others = [] }: Kept = {},
): boolean {
  if (names(message, title)) return true;
  const wanted = words(title);
  const said = new Set(words(message));
  const secret = [...said].some((word) => SECRET_WORD.test(word));
  const own = [
    ...wanted.filter((word) => word.length >= 3 && !SECRET_WORD.test(word)),
    ...sites.map(brand).filter((word): word is string => Boolean(word)),
  ];
  if (secret && own.some((word) => said.has(word))) return true;
  if (![...said].some((word) => KEPT.test(word))) return false;
  const elsewhere = new Set(others.flatMap(words));
  return wanted.some((word) => SECRET_WORD.test(word) && said.has(word) && !elsewhere.has(word));
}
