import { toast } from '@conch/nacre';

/** The longest address a page may ask to open. */
const MAX = 2048;

/**
 * A sealed page asked to open a link (ADR 0034, ADR 0061). It never goes by
 * itself: the person sees the whole address first, and it opens in a tab of
 * its own that knows nothing about Conch. Only web addresses are asked
 * about; anything else (`javascript:`, `data:`, a file) is dropped, whatever
 * the frame already filtered.
 */
export function askToOpen(url: string): boolean {
  if (typeof url !== 'string' || url.length > MAX) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const href = parsed.href;
  const shown = href.replace(/^https?:\/\//, '');
  toast(`Open ${shown.length > 60 ? `${shown.slice(0, 60)}…` : shown}?`, {
    description: href,
    action: {
      label: 'Open',
      onClick: () => void window.open(href, '_blank', 'noopener,noreferrer'),
    },
  });
  return true;
}
