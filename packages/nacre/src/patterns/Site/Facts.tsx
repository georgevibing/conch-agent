import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { Reveal } from './Reveal';
import styles from './Facts.module.css';

export interface FactsProps extends ComponentProps<'dl'> {
  /** What the numbers are about, read out with them. */
  label?: string;
}

/**
 * A few numbers that are simply true, set large: how many of a thing there
 * are, or that there are none. For counts read from the product itself, never
 * for claims about how many people use it.
 */
function FactsRoot({ label, className, ...props }: FactsProps) {
  return <dl aria-label={label} className={cx(styles.facts, className)} {...props} />;
}

export interface FactProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The number, or a word standing in for one. */
  value: ReactNode;
  /** What it counts. */
  label: ReactNode;
  /** Its place in the row, so the facts surface one after another. */
  index?: number;
}

function Fact({ value, label, index = 0, className, ...props }: FactProps) {
  return (
    <Reveal index={index} className={cx(styles.fact, className)} {...props}>
      {/* The number comes first to the eye; a definition list wants the name first. */}
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{value}</dd>
    </Reveal>
  );
}

export const Facts = Object.assign(FactsRoot, { Item: Fact });
