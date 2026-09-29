import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { SkillIcon } from './SkillIcon';
import styles from './Skills.module.css';

export interface SkillUsedProps extends Omit<ComponentProps<'div'>, 'title'> {
  name: string;
  title: string;
  /** `user`: you asked for it by name; `assistant`: it matched what you asked. */
  by: 'user' | 'assistant';
  /** Opens the skill. */
  onOpen?: () => void;
}

/** A quiet line in a conversation saying which skill shaped the reply. */
export function SkillUsed({ name, title, by, onOpen, className, ...props }: SkillUsedProps) {
  const label = by === 'user' ? 'Using' : 'Used';
  return (
    <div role="note" className={cx(styles.used, className)} {...props}>
      <SkillIcon name={name} title={title} size="sm" />
      <span>
        {label} the{' '}
        {onOpen ? (
          <button type="button" className={styles.usedLink} onClick={onOpen}>
            {title}
          </button>
        ) : (
          <strong className={styles.usedName}>{title}</strong>
        )}{' '}
        skill
      </span>
    </div>
  );
}
