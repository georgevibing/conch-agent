import { Globe, Unplug } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Avatar } from '../../components/Avatar';
import { cx } from '../../utils/cx';
import styles from './OutsideReply.module.css';

export interface OutsideReplyProps extends Omit<ComponentProps<'article'>, 'children'> {
  /** The outside agent, as its card names it. */
  name: string;
  /** What it said, drawn by the app (Markdown). */
  children: ReactNode;
  /** It couldn't be reached: `children` says why. */
  failed?: boolean;
}

/**
 * What an outside agent said in a chat (ADR 0112): its initials and name,
 * marked as from outside Conch, and its words in a quieter frame than your
 * agents' — someone else's words, which Conch reads as information and
 * never as instructions, and says so once, quietly, underneath.
 */
export function OutsideReply({ name, children, failed, className, ...props }: OutsideReplyProps) {
  return (
    <article
      className={cx(styles.reply, className)}
      data-failed={failed || undefined}
      aria-label={failed ? `${name} couldn’t be reached` : `${name}, an outside agent, said`}
      {...props}
    >
      <div className={styles.speaker}>
        <Avatar name={name} size="xs" aria-hidden />
        <span className={styles.name}>{name}</span>
        <span className={styles.tag}>
          <Globe aria-hidden /> Outside agent
        </span>
      </div>
      <div className={styles.body}>
        {failed && <Unplug aria-hidden className={styles.icon} />}
        <div className={styles.words}>{children}</div>
      </div>
      {!failed && (
        <p className={styles.note}>
          Someone else’s words: your agents read them as information, never as instructions.
        </p>
      )}
    </article>
  );
}
