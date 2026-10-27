import type { ToolContext } from '../conversations/manager';

/**
 * When Passwords needs no card to read an item or hand it to a command (ADR 0151,
 * 2026-10-26). Full trust is the person saying "don't ask me", so a key is used as any
 * other step is. In Auto, the person's own words naming the item are the answer the card
 * would get ("use the gh pat giotiskl"), except a grave value the model would read itself.
 * Read only and Ask first always ask, and so does a run nobody is watching.
 */
export type ConsentContext = Pick<
  ToolContext,
  'permissionMode' | 'fullTrust' | 'untrusted' | 'said' | 'unattended'
>;

export function consented(
  ctx: ConsentContext,
  title: string,
  { grave = false }: { grave?: boolean } = {},
): boolean {
  if (ctx.unattended) return false;
  const trust = ctx.fullTrust?.() ?? false;
  if (!trust && ctx.permissionMode !== 'auto') return false;
  // A card's PIN, a recovery phrase or a private key read into the model's own words: one
  // slip spends money or empties a wallet, so Auto shows the card even when it was named.
  if (grave && !trust) return false;
  // Only the person's words: empty when someone else is in the chat, so a page or a
  // stranger naming the item never counts.
  if ((ctx.said?.() ?? []).some((message) => names(message, title))) return true;
  // Full trust still asks after someone else's words came in (`untrusted` leaves out
  // what a page said, since the person trusted the chat with that).
  return trust && !ctx.untrusted?.();
}

/** Words that, beside a one-word title, say the person means a saved secret. */
const SECRETS =
  /\b(?:password|passwort|passphrase|pass|pwd|pat|token|key|secret|credential|credentials|login|pin|api)\b/u;

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
