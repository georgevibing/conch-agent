import { UserX, X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './ChannelPeople.module.css';

export interface PersonRowProps extends ComponentProps<'li'> {
  name: string;
  username?: string;
  /** "You", for the owner. */
  badge?: string;
  /** Quiet facts: "Last message 5 minutes ago". */
  meta?: ReactNode;
  onRemove?: () => void;
  /** "Stop Grace talking to Conch". */
  removeLabel?: string;
}

/** Someone who may talk to your assistant through a channel. */
export function PersonRow({
  name,
  username,
  badge,
  meta,
  onRemove,
  removeLabel,
  className,
  ...props
}: PersonRowProps) {
  return (
    <li className={cx(styles.person, className)} {...props}>
      <Avatar name={name} size="sm" />
      <div className={styles.text}>
        <span className={styles.name}>
          {name}
          {username && <span className={styles.handle}>@{username}</span>}
          {badge && (
            <Badge tone="neutral" size="sm">
              {badge}
            </Badge>
          )}
        </span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </div>
      {onRemove && (
        <IconButton size="sm" label={removeLabel ?? `Remove ${name}`} onClick={onRemove}>
          <UserX />
        </IconButton>
      )}
    </li>
  );
}

export interface ChannelRequestProps extends Omit<ComponentProps<'article'>, 'title'> {
  name: string;
  username?: string;
  /** The start of what they wrote. */
  preview: string;
  count?: number;
  /** When they wrote, already in words ("3 minutes ago"). */
  when?: ReactNode;
  /**
   * Nobody is let in yet: this is probably you, saying hello to finish
   * connecting. The card asks "Is this you?" instead.
   */
  hello?: boolean;
  onAllow: () => void;
  onBlock?: () => void;
  onDismiss?: () => void;
  allowing?: boolean;
}

/**
 * Someone wrote to your bot and isn't let in. You decide here, never the bot:
 * let them in (they can then use your assistant as you do), turn them away for
 * good, or just clear it.
 */
export function ChannelRequest({
  name,
  username,
  preview,
  count = 1,
  when,
  hello,
  onAllow,
  onBlock,
  onDismiss,
  allowing,
  className,
  ...props
}: ChannelRequestProps) {
  return (
    <article
      className={cx(styles.request, className)}
      data-hello={hello || undefined}
      data-lustre={hello ? '' : undefined}
      data-lustre-ambient={hello || undefined}
      aria-label={hello ? `Is this you? ${name}` : `${name} wants to talk`}
      {...props}
    >
      {hello && <p className={styles.ask}>Is this you?</p>}
      <div className={styles.who}>
        <Avatar name={name} size={hello ? 'md' : 'sm'} />
        <div className={styles.text}>
          <span className={styles.name}>
            {name}
            {username && <span className={styles.handle}>@{username}</span>}
          </span>
          <span className={styles.meta}>
            {count > 1 ? `${count} messages${when ? ', the last' : ''}` : 'Wrote'}
            {when && <> {when}</>}
          </span>
        </div>
        {onDismiss && !hello && (
          <IconButton
            size="sm"
            label={`Clear ${name}’s request`}
            onClick={onDismiss}
            className={styles.dismiss}
          >
            <X />
          </IconButton>
        )}
      </div>
      {preview && <blockquote className={styles.preview}>{preview}</blockquote>}
      <div className={styles.actions}>
        <Button size="sm" variant="solid" onClick={onAllow} loading={allowing}>
          {hello ? 'That’s me' : 'Let them in'}
        </Button>
        {onBlock && (
          <Button size="sm" variant="ghost" tone="neutral" onClick={onBlock}>
            {hello ? 'Not me' : 'Block'}
          </Button>
        )}
      </div>
      {!hello && (
        <p className={styles.note}>
          Once in, they can use your assistant the way you do, and it asks them before anything
          important.
        </p>
      )}
    </article>
  );
}
