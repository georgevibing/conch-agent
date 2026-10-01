import { BadgeCheck } from 'lucide-react';
import { useId, type ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './SkillTrust.module.css';

export interface TrustedPublisherEntry {
  fingerprint: string;
  name: string;
  trustedAt: number;
  /** It's your own key (`pnpm conch skills sign`). */
  you?: boolean;
}

export interface TrustedPublisherListProps extends Omit<ComponentProps<'section'>, 'title'> {
  publishers: TrustedPublisherEntry[];
  /** Stop trusting one. Your own key can't be forgotten here. */
  onForget?: (publisher: TrustedPublisherEntry) => void;
  /** The one being forgotten. */
  forgetting?: string;
}

const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * Whose signed skills you trust (ADR 0031): each by name and key, with when
 * you said so. Forgetting one turns its skills back into "signed by someone
 * you haven't said you trust": they keep working, but their updates stop.
 */
export function TrustedPublisherList({
  publishers,
  onForget,
  forgetting,
  className,
  ...props
}: TrustedPublisherListProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx(styles.publishers, className)} {...props}>
      <p className={styles.heading} id={titleId}>
        Publishers you trust
      </p>
      {publishers.length === 0 ? (
        <p className={styles.fine}>
          None yet. When a signed skill comes from someone you trust, open it and choose “Trust this
          publisher”.
        </p>
      ) : (
        <ul className={styles.publisherRows}>
          {publishers.map((p) => (
            <li key={p.fingerprint}>
              <BadgeCheck aria-hidden className={styles.canIcon} />
              <span className={styles.publisherName}>
                {p.name}
                {p.you && <span className={styles.fine}> (you)</span>}
              </span>
              <code className={styles.fingerprint}>{p.fingerprint}</code>
              <span className={styles.fine}>since {day.format(p.trustedAt)}</span>
              {onForget && !p.you && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={forgetting === p.fingerprint}
                  onClick={() => onForget(p)}
                  aria-label={`Stop trusting ${p.name}`}
                >
                  Forget
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
