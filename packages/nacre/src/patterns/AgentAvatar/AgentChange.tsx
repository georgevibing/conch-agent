import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { AgentAvatar, type Speaker } from './AgentAvatar';
import styles from './AgentChange.module.css';

export interface AgentChangeProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Who answers from here on. */
  speaker: Speaker;
  /** Who answered before, by name. */
  from?: string;
}

/**
 * Where another agent took over a chat: a hairline across the column with the
 * new face and one quiet sentence in the middle, so it reads as a turn in the
 * chat, not a message. Its replies then carry its own speaker line.
 */
export function AgentChange({ speaker, from, className, ...props }: AgentChangeProps) {
  return (
    <div className={cx(styles.change, className)} {...props}>
      <span className={styles.pill}>
        <AgentAvatar name={speaker.name} avatar={speaker.avatar} size="xs" decorative />
        <span className={styles.words}>
          {from ? `${speaker.name} took over from ${from}` : `${speaker.name} answers from here`}
        </span>
      </span>
    </div>
  );
}
