import { ShieldAlert } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Safety.module.css';

export interface TaintNoticeProps extends Omit<ComponentProps<'p'>, 'children'> {
  /** What it read: "example.com", "things in Gmail", "a message from Ana". */
  read: ReactNode;
  /** The first time in a chat says what changes; later ones only what was read. */
  first?: boolean;
}

/**
 * A quiet line in the chat when it reads something from outside (ADR 0028):
 * nothing's wrong, but from here on, anything that could send what it read
 * somewhere, or change the computer, asks first.
 */
export function TaintNotice({ read, first = true, className, ...props }: TaintNoticeProps) {
  return (
    <p className={cx(styles.notice, className)} {...props}>
      <ShieldAlert aria-hidden />
      <span>
        Read {read}.
        {first && (
          <span className={styles.after}>
            {' '}
            From here on, I’ll check with you before running commands or sending anything.
          </span>
        )}
      </span>
    </p>
  );
}

export interface GuardNoteProps extends Omit<ComponentProps<'p'>, 'children'> {
  /** Why it's asking: "This chat read example.com, which could be trying to steer me…". */
  children: ReactNode;
}

/** On a permission card: why it's asking even though it wouldn't usually. */
export function GuardNote({ children, className, ...props }: GuardNoteProps) {
  return (
    <p className={cx(styles.guard, className)} {...props}>
      <ShieldAlert aria-hidden />
      <span>{children}</span>
    </p>
  );
}
