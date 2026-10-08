/**
 * A picture the chat already holds (the gateway fetched it and keeps it as
 * the chat's own file), so `src` is Conch's own address, never a remote one.
 */
export interface CardPicture {
  src: string;
  width?: number;
  height?: number;
}

/** How a picture is shaped, from its pixel size: tall, wide or about square. */
export function pictureShape(
  picture: CardPicture | undefined,
): 'portrait' | 'landscape' | 'square' {
  if (!picture?.width || !picture.height) return 'landscape';
  const ratio = picture.width / picture.height;
  return ratio < 0.9 ? 'portrait' : ratio > 1.15 ? 'landscape' : 'square';
}

/** Only secure web links leave the chat: anything else isn't a link at all. */
export function secureLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** `www.theguardian.com` → `theguardian.com`. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Links out open in a tab of their own that knows nothing about Conch. */
export const outside = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** "8 Oct 2026", in the reader's own way of writing dates. */
export function shortDate(iso: string | undefined, locale?: string): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(/^\d{4}-\d{2}-\d{2}$/.test(iso) && { timeZone: 'UTC' }),
  }).format(at);
}

/** A colour of its own for a name, from Nacre's app colours: the same name, the same colour. */
const TINTS = [
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
];
export function tintOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return `var(--nc-app-${TINTS[h % TINTS.length]})`;
}
