import { ExternalLink } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { copyText } from '../../utils/clipboard';
import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import styles from './SignInCode.module.css';

export interface SignInCodeProps extends Omit<ComponentProps<'section'>, 'children'> {
  /** The code to enter on the sign-in page: "AXC7-NV0ME". */
  code: string;
  /** The sign-in page it's entered on. */
  url: string;
  /** Says where the code goes: “Enter this code on GitHub”. */
  title?: string;
  /** The button, named for the page it opens: “Open GitHub”. */
  openLabel?: string;
  /** The line that says Conch is watching: “Conch carries on by itself when you’re done.” */
  waiting?: string;
}

/**
 * Signing in with a code: the provider's own page asks for a short code that
 * Conch shows. The code is set in tiles, so it reads at a glance and can be
 * typed on another device, and one button does both things a person would
 * otherwise do by hand: copy it, and open the page to paste it on. The line
 * underneath says what just happened, so nobody wonders whether the code is on
 * their clipboard.
 */
export function SignInCode({
  code,
  url,
  title = 'Enter this code on the sign-in page',
  openLabel = 'Copy code and open sign-in page',
  waiting = 'Waiting for you to sign in. This updates by itself.',
  className,
  ...props
}: SignInCodeProps) {
  const titleId = useId();
  // Unset until someone copies; then whether the code reached the clipboard.
  const [copied, setCopied] = useState<boolean>();
  const groups = code.split(/[-\s]+/).filter(Boolean);

  const copy = async () => {
    try {
      await copyText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={cx(styles.root, className)} aria-labelledby={titleId} {...props}>
      <p id={titleId} className={styles.title}>
        {title}
      </p>

      <div className={styles.well} data-lustre="" data-lustre-ambient="">
        <div
          className={styles.code}
          role="group"
          aria-label={`Sign-in code ${[...code].join(' ')}`}
        >
          {groups.map((group, g) => (
            <span key={g} className={styles.group} aria-hidden>
              {[...group].map((character, i) => (
                <span key={i} className={styles.tile}>
                  {character}
                </span>
              ))}
            </span>
          ))}
        </div>
        <CopyButton value={code} label="Copy code" onCopied={() => setCopied(true)} />
      </div>

      <Button asChild size="lg" trailingIcon={<ExternalLink />}>
        {/* A real link, so no browser blocks the new tab; the copy rides along on the click. */}
        <a href={url} target="_blank" rel="noreferrer" onClick={() => void copy()}>
          {openLabel}
        </a>
      </Button>

      <p className={styles.hint} aria-live="polite">
        {copied === undefined
          ? 'The page opens in a new tab. Paste the code there and sign in.'
          : copied
            ? 'Code copied. Paste it on the sign-in page and sign in.'
            : 'The code couldn’t be copied. Type it on the sign-in page and sign in.'}
      </p>

      <p className={styles.status}>
        <span className={styles.dot} aria-hidden />
        {waiting}
      </p>
    </section>
  );
}
