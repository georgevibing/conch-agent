import { KeyRound } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import styles from './Security.module.css';

export interface SecretRevealProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** The secret itself — shown in full, once. */
  secret: string;
  title?: ReactNode;
  /** What to do with it. Defaults to the "won't be shown again" warning. */
  description?: ReactNode;
  onCopied?: () => void;
}

/**
 * Shows a newly created secret exactly once: large, monospaced, selectable
 * with one click, with a copy button and a clear "you won't see this again".
 */
export function SecretReveal({
  secret,
  title = 'Your new access key',
  description = 'Copy it now and keep it somewhere safe, like your password manager. For your security it won’t be shown again.',
  onCopied,
  className,
  ...props
}: SecretRevealProps) {
  return (
    <div className={cx(styles.reveal, className)} {...props}>
      <div className={styles.revealHead}>
        <span className={styles.revealIcon} aria-hidden>
          <KeyRound />
        </span>
        <p className={styles.revealTitle}>{title}</p>
      </div>
      <div className={styles.secretRow}>
        <code className={styles.secret} aria-label="Secret">
          {secret}
        </code>
        <CopyButton value={secret} label="Copy" size="md" onCopied={onCopied} />
      </div>
      <p className={styles.revealNote}>{description}</p>
    </div>
  );
}
