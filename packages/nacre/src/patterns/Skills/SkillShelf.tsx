import { Archive } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { SkillIcon } from './SkillIcon';
import styles from './SkillShelf.module.css';

export interface SkillShelfEntry {
  id: string;
  name: string;
  title: string;
  /** When it was last used, in words: “Last used 3 August”, “Never used”. */
  idle: string;
}

export interface SkillShelfProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** Skills Conch put here that have sat unused. */
  skills: SkillShelfEntry[];
  /** How long, in words: “two months”. */
  period?: string;
  /** Turn them off · Keep them. */
  actions?: ReactNode;
}

/**
 * A tidy shelf (ADR 0058): skills Conch suggested or brought in that haven't
 * been used in a long while, offered to turn off together. Only an offer:
 * nothing changes until you press, a skill you wrote yourself is never on
 * it, and off keeps everything — the list, the backups, one switch back.
 */
export function SkillShelf({
  skills,
  period = 'two months',
  actions,
  className,
  ...props
}: SkillShelfProps) {
  const titleId = useId();
  const one = skills.length === 1;
  return (
    <section aria-labelledby={titleId} className={cx(styles.shelf, className)} {...props}>
      <div className={styles.head}>
        <Archive aria-hidden className={styles.icon} />
        <div className={styles.words}>
          <p className={styles.title} id={titleId}>
            You haven’t used {one ? 'this' : 'these'} in {period}
          </p>
          <p className={styles.note}>
            Conch suggested or brought {one ? 'it' : 'them'} in. Turned off,{' '}
            {one ? 'it stays' : 'they stay'} in your list and in every backup, and one switch brings{' '}
            {one ? 'it' : 'each'} back.
          </p>
        </div>
      </div>
      <ul className={styles.list} aria-label="Skills you haven’t used">
        {skills.map((skill) => (
          <li key={skill.id} className={styles.item}>
            <SkillIcon name={skill.name} title={skill.title} size="sm" />
            <span className={styles.name}>{skill.title}</span>
            <span className={styles.idle}>{skill.idle}</span>
          </li>
        ))}
      </ul>
      {actions && <div className={styles.actions}>{actions}</div>}
    </section>
  );
}
