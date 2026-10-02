/**
 * Reading an email the way the email channel needs it (ADR 0044): who
 * really sent it, what they wrote above the quoted thread, and whether it
 * carries someone else's words (a forward).
 *
 * Every function here is total: an odd message comes out as "not verified"
 * or as plain text, never an exception.
 */
import { convert } from 'html-to-text';
import type { Email, Header } from 'postal-mime';
import { getDomain } from 'tldts';

// ── Who sent it ───────────────────────────────────────────────────────────

/** One method's result in an `Authentication-Results` header (RFC 8601). */
interface AuthResult {
  method: string;
  result: string;
  props: Record<string, string>;
}

/** An `Authentication-Results` header, read: who wrote it and what it found. */
export interface AuthResults {
  /** The server that checked (`mx.google.com`); empty when it doesn't say (Outlook). */
  authserv: string;
  results: AuthResult[];
}

/** Comments in parentheses (which may nest) say nothing a machine should trust: drop them. */
function uncomment(value: string): string {
  let out = '';
  let depth = 0;
  let quoted = false;
  for (const ch of value) {
    if (ch === '"' && depth === 0) quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    else if (!quoted && ch === ')' && depth > 0) depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

export function parseAuthResults(value: string): AuthResults {
  const parts = uncomment(value.replace(/\r?\n[ \t]+/g, ' '))
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const first = parts[0] ?? '';
  // `authserv-id [version]`, unless the header leaves it out and starts with a result.
  const hasId = !first.includes('=');
  const authserv = hasId ? (first.split(/\s+/)[0] ?? '').toLowerCase() : '';
  const results: AuthResult[] = [];
  for (const part of hasId ? parts.slice(1) : parts) {
    const tokens = part.split(/\s+/).filter(Boolean);
    const head = /^([a-z0-9-]+)=([a-z0-9-]+)$/i.exec(tokens[0] ?? '');
    if (!head?.[1] || !head[2]) continue;
    const props: Record<string, string> = {};
    for (const token of tokens.slice(1)) {
      const prop = /^([a-z0-9-]+\.[a-z0-9-]+)=(.+)$/i.exec(token);
      if (prop?.[1] && prop[2]) props[prop[1].toLowerCase()] = prop[2].replace(/^"|"$/g, '');
    }
    results.push({ method: head[1].toLowerCase(), result: head[2].toLowerCase(), props });
  }
  return { authserv, results };
}

const orgDomain = (domain: string) =>
  getDomain(domain.toLowerCase(), { allowPrivateDomains: false }) ?? domain.toLowerCase();

/** DMARC's relaxed alignment: the same organisational domain. */
function aligned(domain: string | undefined, fromDomain: string): boolean {
  if (!domain) return false;
  const d = domain.replace(/^.*@/, '').toLowerCase();
  return orgDomain(d) === orgDomain(fromDomain);
}

/**
 * Whether the provider's own check says `from` really sent this.
 *
 * Anyone can write an `Authentication-Results` header into a message they
 * send, so only those stamped by the receiving provider count (`trusted`
 * says which server names those are), and of those only the topmost for
 * each server: the provider adds its own above everything the sender wrote.
 *
 * - `pass`: DMARC passed for the From domain, or DKIM or SPF passed for a
 *   domain aligned with it;
 * - `fail`: the provider says DMARC failed, or nothing aligned and something failed;
 * - `none`: the provider didn't say (mail you sent yourself often isn't checked).
 */
export function senderVerdict(
  headers: Header[],
  from: string,
  trusted: (authserv: string) => boolean,
): 'pass' | 'fail' | 'none' {
  const fromDomain = from.split('@')[1]?.toLowerCase();
  if (!fromDomain) return 'fail';
  // Two From lines: which one was checked is anyone's guess.
  if (headers.filter((h) => h.key === 'from').length !== 1) return 'fail';
  const used = new Set<string>();
  const reports: AuthResults[] = [];
  for (const header of headers) {
    if (header.key !== 'authentication-results') continue;
    const report = parseAuthResults(header.value);
    if (!trusted(report.authserv) || used.has(report.authserv)) continue;
    used.add(report.authserv);
    reports.push(report);
  }
  const results = reports.flatMap((r) => r.results);
  if (!results.length) return 'none';
  if (results.some((r) => r.method === 'dmarc' && r.result === 'fail')) return 'fail';
  const pass = results.some(
    (r) =>
      (r.method === 'dmarc' &&
        r.result === 'pass' &&
        aligned(r.props['header.from'] ?? fromDomain, fromDomain)) ||
      (r.method === 'dkim' &&
        r.result === 'pass' &&
        aligned(r.props['header.d'] ?? r.props['header.i'], fromDomain)) ||
      (r.method === 'spf' && r.result === 'pass' && aligned(r.props['smtp.mailfrom'], fromDomain)),
  );
  if (pass) return 'pass';
  return results.some((r) => ['fail', 'softfail', 'permerror'].includes(r.result))
    ? 'fail'
    : 'none';
}

/**
 * Mail that answers itself: auto-replies, mailing lists, bounces. Answering
 * those is how mail loops start, so they're never read (RFC 3834).
 */
export function automatic(email: Email): boolean {
  const header = (key: string) =>
    email.headers
      .find((h) => h.key === key)
      ?.value.trim()
      .toLowerCase();
  const auto = header('auto-submitted');
  if (auto && auto !== 'no') return true;
  if (/^(bulk|list|junk|auto_reply)$/.test(header('precedence') ?? '')) return true;
  if (header('list-id') || header('list-unsubscribe')) return true;
  if (header('x-autoreply') || header('x-autorespond')) return true;
  const from = email.from?.address?.toLowerCase() ?? '';
  return /^(mailer-daemon|postmaster|no-?reply)@/.test(from);
}

// ── What they wrote ───────────────────────────────────────────────────────

/** Where a reply's quoted thread starts, in the languages mail apps write it in. */
const QUOTE_STARTS = [
  /^On\b.{3,300}\bwrote:\s*$/,
  /^Am\b.{3,300}\bschrieb\b.*:\s*$/,
  /^Le\b.{3,300}\ba écrit\s*:\s*$/,
  /^El\b.{3,300}\bescribió:\s*$/,
  /^Il\b.{3,300}\bha scritto:\s*$/,
  /^Op\b.{3,300}\bschreef\b.*:\s*$/,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
];

const FORWARDS = [
  /^-{2,}\s*Forwarded message\s*-{2,}/im,
  /^Begin forwarded message:/im,
  /^-{2,}\s*Weitergeleitete Nachricht\s*-{2,}/im,
  /^-{2,}\s*Message transféré\s*-{2,}/im,
];

/** HTML as text, without loading anything it points at. */
export function htmlText(html: string): string {
  return convert(html, {
    wordwrap: false,
    limits: { maxInputLength: 500_000, maxDepth: 30, maxChildNodes: 5000 },
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
      // Gmail, Apple Mail and Outlook wrap the quoted thread in these.
      { selector: 'div.gmail_quote', format: 'skip' },
      { selector: 'blockquote[type=cite]', format: 'skip' },
      { selector: 'div#appendonsend', format: 'skip' },
      { selector: 'div#divRplyFwdMsg', format: 'skip' },
    ],
  });
}

/**
 * The new words of an email: above the quoted thread, without the
 * signature. A forward is kept whole (it's what the person wants read),
 * and says so, because those words are someone else's.
 */
export function newWords(email: Email): { text: string; forwarded: boolean } {
  const plainText = email.text?.trim();
  const raw = (plainText || htmlText(email.html ?? '')).replace(/\r\n?/g, '\n');
  const forwarded =
    FORWARDS.some((pattern) => pattern.test(raw)) ||
    email.attachments.some((a) => a.mimeType === 'message/rfc822');
  if (forwarded) return { text: tidy(raw), forwarded };
  const lines = raw.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const two = `${line} ${lines[i + 1] ?? ''}`.trim();
    if (QUOTE_STARTS.some((p) => p.test(line.trim()) || p.test(two))) break;
    // Outlook: "From: …" then "Sent: …" or "Date: …" starts the old message.
    if (/^From:\s.+/.test(line) && lines.slice(i + 1, i + 5).some((l) => /^(Sent|Date):\s/.test(l)))
      break;
    // The signature marker ("-- ") ends what was written.
    if (/^-- ?$/.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  // "Sent from my iPhone" says nothing to the assistant.
  while (kept.length && /^(\s*|Sent from my .+|Get Outlook for .+)$/i.test(kept.at(-1) ?? ''))
    kept.pop();
  return { text: tidy(kept.join('\n')), forwarded: false };
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 40_000);
}

/** "Re: Re: Fwd: Plans" → "Plans". */
export function bareSubject(subject: string | undefined): string {
  return (subject ?? '').replace(/^\s*((re|fwd?|aw|wg|sv|tr)\s*:\s*)+/i, '').trim();
}

/** Message ids, as `<…>` tokens, from In-Reply-To or References. */
export function messageIds(value: string | undefined): string[] {
  return [...(value ?? '').matchAll(/<[^<>\s]{1,500}>/g)].map((m) => m[0]);
}
