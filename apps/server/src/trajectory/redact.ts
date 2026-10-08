/**
 * Taking keys and personal details out of a trajectory before it's saved
 * (ADR 0113). On by default; what it took out is counted by kind with a few
 * places it was, so the person sees what changed without seeing the values.
 *
 * Best effort, on purpose and said so: the shapes catch keys whatever they're
 * next to (the same list as `search/past.ts`), every secret Conch itself
 * knows (the vault's redactor), and the personal details a chat usually
 * carries — email addresses, phone and card numbers, public network
 * addresses, the home folder and the names in About you.
 */
import type { RedactionKind, Removed } from '@conch/protocol';

import { SECRET_SHAPES } from '../search/past';

export interface RedactOptions {
  /** The home folder, written as `~`. */
  home?: string;
  /** Names to take out: yours and the people in About you. */
  names?: readonly string[];
  /** Every secret Conch knows, as ••• (`VaultService.redactor()`). */
  known?: (text: string) => string;
}

const TOKEN: Record<RedactionKind, string> = {
  password: '[password]',
  key: '[key]',
  email: '[email]',
  phone: '[phone]',
  card: '[card]',
  address: '[address]',
  name: '[name]',
  home: '~',
};

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
const PHONE =
  /(?<![\w.:/-])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{2,5}(?:[ .-]\d{2,5}){1,4}(?![\w.:/-])/g;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const PASSWORD = '•••';

/** A card number passes the Luhn check; most long numbers in a log don't. */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

/** An address on the open internet, not this computer's or a home network's. */
function isPublic(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // Tailscale and other carrier-grade NAT
  return true;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One redaction pass over many texts: `text` and `value` take things out and
 * count them; `removed` says what, with up to three places each.
 */
export class Redaction {
  #counts = new Map<RedactionKind, { count: number; examples: string[] }>();
  /** The kinds found in the text at hand: their examples come from it once all is out. */
  #found = new Set<RedactionKind>();
  #names?: RegExp;
  #homes: string[];

  constructor(private readonly options: RedactOptions = {}) {
    const names = [
      ...new Set(
        (options.names ?? [])
          .flatMap((n) => [n.trim(), n.trim().split(/\s+/)[0] ?? ''])
          .filter((n) => n.length >= 3 && n.length <= 60),
      ),
    ].sort((a, b) => b.length - a.length);
    if (names.length)
      this.#names = new RegExp(
        `(?<![\\p{L}\\p{N}])(?:${names.map(escape).join('|')})(?![\\p{L}\\p{N}])`,
        'giu',
      );
    const home = options.home?.replace(/[\\/]+$/, '');
    this.#homes = home && home.length > 1 ? [...new Set([home, home.replace(/\\/g, '/')])] : [];
  }

  #count(kind: RedactionKind, n: number) {
    if (n <= 0) return;
    const entry = this.#counts.get(kind) ?? { count: 0, examples: [] };
    entry.count += n;
    this.#counts.set(kind, entry);
    this.#found.add(kind);
  }

  /** A few words either side of where it was, as it reads now. */
  #remember(kind: RedactionKind, text: string, examples: string[]) {
    const token = kind === 'home' ? '~/' : TOKEN[kind];
    let from = 0;
    while (examples.length < 3) {
      const i = text.indexOf(token, from);
      if (i < 0) break;
      from = i + token.length;
      const start = Math.max(0, i - 40);
      const end = Math.min(text.length, i + token.length + 40);
      const around = `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
      if (!examples.includes(around)) examples.push(around.slice(0, 160));
    }
  }

  #replace(
    text: string,
    kind: RedactionKind,
    shape: RegExp,
    by: (match: string) => string | undefined,
  ): string {
    let n = 0;
    const out = text.replace(shape, (match: string) => {
      const swap = by(match);
      if (swap === undefined) return match;
      n++;
      return swap;
    });
    this.#count(kind, n);
    return out;
  }

  text(input: string): string {
    if (!input) return input;
    let out = input;

    if (this.options.known) {
      const before = out.split(PASSWORD).length;
      const swept = this.options.known(out);
      const found = swept.split(PASSWORD).length - before;
      if (found > 0) {
        out = swept.split(PASSWORD).join(TOKEN.password);
        this.#count('password', found);
      }
    }

    let keys = 0;
    for (const [shape, by] of SECRET_SHAPES) {
      out = out.replace(shape, (match: string, ...groups: unknown[]) => {
        // Already out (a saved password): counted once, as what it was.
        if (match.includes(TOKEN.password)) return match;
        keys++;
        return by
          .replace(/\$(\d)/g, (_, n: string) => {
            const group = groups[Number(n) - 1];
            return typeof group === 'string' ? group : '';
          })
          .split(PASSWORD)
          .join(TOKEN.key);
      });
    }
    this.#count('key', keys);

    out = this.#replace(out, 'email', EMAIL, () => TOKEN.email);
    out = this.#replace(out, 'card', CARD, (m) =>
      luhn(m.replace(/\D/g, '')) ? TOKEN.card : undefined,
    );
    out = this.#replace(out, 'address', IPV4, (m) => (isPublic(m) ? TOKEN.address : undefined));
    out = this.#replace(out, 'phone', PHONE, (m) => {
      const digits = m.replace(/\D/g, '').length;
      // A phone number has 9 to 15 digits and is written with a + or its separators.
      return digits >= 9 && digits <= 15 && (m.startsWith('+') || /[ ().-]/.test(m))
        ? TOKEN.phone
        : undefined;
    });

    for (const home of this.#homes) {
      const n = out.split(home).length - 1;
      if (n > 0) {
        out = out.split(home).join('~');
        this.#count('home', n);
      }
    }
    if (this.#names) out = this.#replace(out, 'name', this.#names, () => TOKEN.name);

    for (const kind of this.#found) {
      const entry = this.#counts.get(kind);
      if (entry && entry.examples.length < 3) this.#remember(kind, out, entry.examples);
    }
    this.#found.clear();
    return out;
  }

  /** Every string in a value (a tool's arguments), taken through `text`. */
  value(input: unknown, depth = 0): unknown {
    if (typeof input === 'string') return this.text(input);
    if (depth > 20 || input === null || typeof input !== 'object') return input;
    if (Array.isArray(input)) return input.map((v) => this.value(v, depth + 1));
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([k, v]) => [
        k,
        this.value(v, depth + 1),
      ]),
    );
  }

  removed(): Removed[] {
    return [...this.#counts.entries()].map(([kind, { count, examples }]) => ({
      kind,
      count,
      examples,
    }));
  }
}

/** Nothing taken out: the same calls, for `redact: false`. */
export class NoRedaction extends Redaction {
  override text(input: string): string {
    return input;
  }
  override value(input: unknown): unknown {
    return input;
  }
}
