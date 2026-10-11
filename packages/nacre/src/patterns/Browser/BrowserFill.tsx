import { KeyRound, Lock, ShieldAlert, Sparkles, X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './Browser.module.css';
import type { BrowserFillAccount } from './BrowserApproval';

/** What you can fill into the box you're in, from Passwords (ADR 0130). */
export interface BrowserFillOffer {
  field: 'username' | 'password' | 'new-password' | 'code' | 'card';
  /** The page's host, as shown. */
  site: string;
  items: BrowserFillAccount[];
  /** The saved site this page only pretends to be. */
  lookalike?: string;
  /** Why it can't be filled here. */
  blocked?: 'insecure' | 'frame';
  /** Passwords is locked. */
  locked?: boolean;
}

export interface BrowserFillProps extends Omit<ComponentProps<'div'>, 'children'> {
  offer: BrowserFillOffer;
  /** Fill this item into the box (and what goes with it). */
  onFill?: (id: string) => void;
  /** Make a strong password, save it, and fill it in. */
  onGenerate?: () => void;
  /** Open Passwords, to unlock it. */
  onUnlock?: () => void;
  onDismiss?: () => void;
}

const WHAT: Record<BrowserFillOffer['field'], string> = {
  username: 'your username',
  password: 'your password',
  'new-password': 'a new password',
  code: 'the code',
  card: 'a card',
};

/**
 * While you drive the browser, the box you're in can be filled from
 * Passwords in one press: the account to sign in with, a strong new password
 * on a sign-up, the code, a card. A page that only looks like one of your
 * sites says so instead, and offers nothing.
 */
export function BrowserFill({
  offer,
  onFill,
  onGenerate,
  onUnlock,
  onDismiss,
  className,
  ...props
}: BrowserFillProps) {
  const warning = Boolean(offer.lookalike);
  const close = onDismiss && (
    <IconButton size="sm" variant="ghost" label="Close" onClick={onDismiss}>
      <X />
    </IconButton>
  );
  let body;
  if (offer.lookalike) {
    body = (
      <span className={styles.fillLabel}>
        <ShieldAlert aria-hidden />
        <span>
          <strong>This isn’t {offer.lookalike}.</strong> It may be a fake site. Don’t sign in here.
        </span>
      </span>
    );
  } else if (offer.blocked) {
    body = (
      <span className={styles.fillLabel}>
        <ShieldAlert aria-hidden />
        <span>
          {offer.blocked === 'frame'
            ? 'This box comes from another site, so Passwords won’t fill it.'
            : 'This page isn’t secure, so Passwords won’t fill it.'}
        </span>
      </span>
    );
  } else if (offer.locked) {
    body = (
      <>
        <span className={styles.fillLabel}>
          <Lock aria-hidden />
          <span>Passwords is locked.</span>
        </span>
        {onUnlock && (
          <Button size="sm" variant="surface" onClick={onUnlock}>
            Unlock
          </Button>
        )}
      </>
    );
  } else if (offer.field === 'new-password') {
    body = (
      <>
        <span className={styles.fillLabel}>
          <KeyRound aria-hidden />
          <span>
            A strong password, saved in Passwords.{' '}
            <span className={styles.fillHint}>For {offer.site}</span>
          </span>
        </span>
        <Button size="sm" leadingIcon={<Sparkles />} onClick={onGenerate}>
          Use a strong password
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <span className={styles.fillLabel}>
          <KeyRound aria-hidden />
          <span>Fill {WHAT[offer.field]} from Passwords</span>
        </span>
        <ul className={styles.fillItems} aria-label="Saved for this site">
          {offer.items.map((item) => (
            <li key={item.id}>
              <Button
                size="sm"
                variant="surface"
                aria-label={`Fill from “${item.title}”${item.account ? `, ${item.account}` : ''}`}
                onClick={() => onFill?.(item.id)}
              >
                {item.account || item.title}
              </Button>
            </li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <div
      role="group"
      aria-label="Passwords"
      className={cx(styles.fillBar, className)}
      data-tone={warning || offer.blocked ? 'warning' : undefined}
      {...props}
    >
      {body}
      {close}
    </div>
  );
}
