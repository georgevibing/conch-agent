import { ShieldCheck, ShieldHalf, ShieldOff, Shield } from 'lucide-react';
import { useId, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './SealCoverage.module.css';

export interface SealCoverageRow {
  id: string;
  label: string;
  state: 'sealed' | 'partly' | 'not-sealed' | 'no-commands';
  /** What it means for this provider, in a sentence. */
  note: string;
}

export interface SealCoverageProps extends Omit<ComponentProps<'section'>, 'title'> {
  providers: SealCoverageRow[];
}

const ICONS = {
  sealed: ShieldCheck,
  partly: ShieldHalf,
  'not-sealed': ShieldOff,
  'no-commands': Shield,
} as const;

const WORDS = {
  sealed: 'Sealed',
  partly: 'Partly sealed',
  'not-sealed': 'Not sealed',
  'no-commands': 'No commands',
} as const;

/**
 * What "Seal commands" means for each provider you use (ADR 0031). Honest by
 * design: a provider that isn't sealed says so, and one that's only partly
 * sealed says what's still in reach.
 */
export function SealCoverage({ providers, className, ...props }: SealCoverageProps) {
  const titleId = useId();
  if (!providers.length) return null;
  return (
    <section aria-labelledby={titleId} className={cx(styles.coverage, className)} {...props}>
      <p className={styles.title} id={titleId}>
        For the providers you use
      </p>
      <ul className={styles.rows}>
        {providers.map((p) => {
          const Icon = ICONS[p.state];
          return (
            <li key={p.id} data-state={p.state}>
              <Icon aria-hidden className={styles.icon} />
              <span className={styles.label}>{p.label}</span>
              <span className={styles.state}>{WORDS[p.state]}</span>
              <span className={styles.note}>{p.note}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
