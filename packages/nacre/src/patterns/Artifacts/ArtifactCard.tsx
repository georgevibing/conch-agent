import { ChevronRight, Pin } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Artifacts.module.css';
import { ARTIFACT_KINDS, type ArtifactKindName } from './kinds';

export interface ArtifactCardProps extends Omit<ComponentProps<'button'>, 'title'> {
  title: ReactNode;
  kind: ArtifactKindName;
  version: number;
  action?: 'created' | 'updated';
  /** What changed in this version: "Darker, with a total row". */
  note?: ReactNode;
  /** It's the one showing in the panel now. */
  active?: boolean;
  pinned?: boolean;
}

/**
 * Where something the assistant made sits in the chat: what it is, which
 * version, what changed. One press opens it beside the chat.
 */
export function ArtifactCard({
  title,
  kind,
  version,
  action = 'created',
  note,
  active,
  pinned,
  className,
  ...props
}: ArtifactCardProps) {
  const k = ARTIFACT_KINDS[kind];
  return (
    <button
      type="button"
      className={cx(styles.card, className)}
      data-active={active || undefined}
      data-lustre
      aria-current={active || undefined}
      {...props}
    >
      <span className={styles.cardIcon} aria-hidden>
        {k.icon}
      </span>
      <span className={styles.cardText}>
        <span className={styles.cardTitle}>
          {title}
          {pinned && (
            <>
              <Pin aria-hidden className={styles.cardPin} />
              <span className="nc-visually-hidden">, pinned</span>
            </>
          )}
        </span>
        <span className={styles.cardMeta}>
          {k.label} ·{' '}
          {action === 'updated'
            ? `version ${version}`
            : version > 1
              ? `version ${version}`
              : 'made for you'}
          {note && <> · {note}</>}
        </span>
      </span>
      <span className={styles.cardOpen}>
        {active ? 'Showing' : 'Open'}
        <ChevronRight aria-hidden />
      </span>
    </button>
  );
}
