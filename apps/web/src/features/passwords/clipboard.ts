import { toast } from '@conch/nacre';

/** How long a copied secret stays on the clipboard (Bitwarden and KeePassXC clear theirs too). */
export const CLEAR_AFTER_MS = 60_000;

let pending: ReturnType<typeof setTimeout> | undefined;

/**
 * Copy a secret, then take it off the clipboard a minute later — but only if
 * it's still what's there, so nothing you copied since is lost. Where the
 * browser won't let Conch look (most do once the page is focused), it's left
 * alone rather than guessed at.
 */
export async function copySecret(value: string, what = 'Password'): Promise<void> {
  await navigator.clipboard.writeText(value);
  toast.success(`${what} copied`, { description: 'It’s cleared from the clipboard in a minute.' });
  clearTimeout(pending);
  pending = setTimeout(() => {
    void navigator.clipboard
      .readText()
      .then((current) => (current === value ? navigator.clipboard.writeText('') : undefined))
      .catch(() => undefined);
  }, CLEAR_AFTER_MS);
}

/** Copy something that isn't secret. */
export async function copyPlain(value: string, what: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  toast(`${what} copied`);
}
