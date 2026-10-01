import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Definitions.module.css';

export interface DefinitionsProps extends ComponentProps<'dl'> {
  /** What is being defined, read out with the list ("Commands"). */
  label?: string;
}

/**
 * A reference list: the thing on one side, what it means on the other. For
 * commands, settings and messages, where a table would cramp the words. The
 * two sides sit beside each other when there's room and stack when there isn't.
 */
function DefinitionsRoot({ label, className, ...props }: DefinitionsProps) {
  return <dl aria-label={label} className={cx(styles.list, className)} {...props} />;
}

export interface DefinitionsItemProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** The thing itself, as you'd type it. Set in the monospace face. */
  term: ReactNode;
  /** A quiet fact under the term: its default, its aliases. */
  meta?: ReactNode;
}

function DefinitionsItem({ term, meta, className, children, ...props }: DefinitionsItemProps) {
  return (
    <div className={cx(styles.item, className)} {...props}>
      <dt className={styles.term}>
        <span className={styles.name}>{term}</span>
        {meta != null && <span className={styles.meta}>{meta}</span>}
      </dt>
      <dd className={styles.body}>{children}</dd>
    </div>
  );
}

export const Definitions = Object.assign(DefinitionsRoot, { Item: DefinitionsItem });
