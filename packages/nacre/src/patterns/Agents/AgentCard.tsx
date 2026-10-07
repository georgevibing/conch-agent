import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { AgentAvatar, type AgentAvatarSize } from '../AgentAvatar/AgentAvatar';
import type { AgentFace } from '../AgentAvatar/presets';
import styles from './Agents.module.css';

export interface AgentCardProps extends Omit<ComponentProps<'div'>, 'children'> {
  name: string;
  /** What it's for, in a line (its `role`). */
  about?: string;
  avatar?: AgentFace | string;
  /** New chats start with it: said quietly under its name. */
  isDefault?: boolean;
  /** `2xl` in a gallery, `3xl` where it's the one being made. */
  size?: Extract<AgentAvatarSize, 'xl' | '2xl' | '3xl'>;
  /** Shown while there's no name yet. */
  placeholder?: string;
  /** Just made, or just given a new face: it lands with a spring and a ring of light. */
  arrived?: boolean;
  /** Something under the name (a hint, a status). */
  children?: ReactNode;
}

/**
 * An agent as a profile: its face large, its name under it, and what it's
 * for in a quiet line. The name follows what's typed, letter by letter, so
 * making one feels like meeting it.
 */
export function AgentCard({
  name,
  about,
  avatar,
  isDefault,
  size = '2xl',
  placeholder = 'Your agent',
  arrived,
  className,
  children,
  ...props
}: AgentCardProps) {
  const shown = name.trim();
  return (
    <div
      className={cx(styles.card, className)}
      data-size={size}
      data-arrived={arrived || undefined}
      {...props}
    >
      <span className={styles.cardFace}>
        <AgentAvatar
          // A new face lands again, so a change is seen.
          key={typeof avatar === 'object' ? JSON.stringify(avatar) : avatar}
          name={shown || placeholder}
          avatar={avatar}
          size={size}
          decorative
        />
      </span>
      <span className={styles.cardName} data-empty={!shown || undefined}>
        {shown || placeholder}
      </span>
      {about?.trim() && <span className={styles.cardRole}>{about.trim()}</span>}
      {isDefault && <span className={styles.cardDefault}>Default</span>}
      {children}
    </div>
  );
}
