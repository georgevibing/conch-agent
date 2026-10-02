import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { SkillIcon } from './SkillIcon';
import styles from './Skills.module.css';

export interface SkillUsedProps extends Omit<ComponentProps<'div'>, 'title'> {
  name: string;
  title: string;
  /**
   * `user`: you asked for it by name; `assistant`: it matched what you asked;
   * `carried`: work brought it from another chat (ADR 0047).
   */
  by: 'user' | 'assistant' | 'carried';
  /** For `carried`: from the chat this one was started in, or from a helper it started. */
  carriedFrom?: 'chat' | 'helper';
  /** Opens the skill. */
  onOpen?: () => void;
}

/** A quiet line in a conversation saying which skill shaped the reply. */
export function SkillUsed({
  name,
  title,
  by,
  carriedFrom = 'chat',
  onOpen,
  className,
  ...props
}: SkillUsedProps) {
  const named = onOpen ? (
    <button type="button" className={styles.usedLink} onClick={onOpen}>
      {title}
    </button>
  ) : (
    <strong className={styles.usedName}>{title}</strong>
  );
  return (
    <div role="note" className={cx(styles.used, className)} {...props}>
      <SkillIcon name={name} title={title} size="sm" />
      {by === 'carried' ? (
        <span>
          {carriedFrom === 'helper' ? 'A helper used the ' : 'Held to the '}
          {named} skill
          {carriedFrom === 'helper'
            ? ', so this chat is held to it too'
            : ', like the chat it came from'}
        </span>
      ) : (
        <span>
          {by === 'user' ? 'Using' : 'Used'} the {named} skill
        </span>
      )}
    </div>
  );
}
