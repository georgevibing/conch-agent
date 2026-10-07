import { useId, type ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { SkillIcon } from './SkillIcon';
import styles from './SkillOffer.module.css';

export interface SkillOfferProps extends Omit<ComponentProps<'div'>, 'children'> {
  /**
   * What the skill would do, in a few words: “Log a meal in Yazio”. Its tile
   * takes its colour and letter from it.
   */
  title?: string;
  /** How many steps the work took. */
  steps?: number;
  /**
   * Learned in a chat that read something from outside (ADR 0028), in a
   * sentence: “Learned from trains.example.”
   */
  untrusted?: string;
  /** Opens New skill with the draft filled in. */
  onSave: () => void;
  /** Not now. */
  onDismiss?: () => void;
}

/**
 * Save how I did this (ADR 0058): a small card under a reply that took real
 * work and went well. What the skill would do, one quiet line on how it went
 * (and, after reading something from outside, where it was learned), and one
 * button. Never a dialog, never while the answer is being written, never
 * twice in a chat. The button only opens the draft: nothing is saved until
 * you save it.
 */
export function SkillOffer({
  title,
  steps,
  untrusted,
  onSave,
  onDismiss,
  className,
  ...props
}: SkillOfferProps) {
  const titleId = useId();
  const detailId = useId();
  const name = title?.trim() || 'Save how I did this';
  const how = steps !== undefined ? `That took ${steps} steps, and it worked.` : 'That worked.';
  return (
    <div
      role="group"
      aria-label="Save how this was done as a skill"
      aria-describedby={`${titleId} ${detailId}`}
      className={cx(styles.offer, className)}
      data-lustre
      {...props}
    >
      <span className={styles.mark}>
        <SkillIcon name={name} title={name} size="sm" className={styles.tile} />
      </span>
      <div className={styles.body}>
        <div className={styles.text}>
          <p id={titleId} className={styles.title}>
            {name}
          </p>
          <p id={detailId} className={styles.detail}>
            {how}
            {untrusted && (
              <span className={styles.source} data-untrusted>
                {' '}
                {untrusted} Check the steps before saving.
              </span>
            )}
          </p>
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="soft" onClick={onSave}>
            Save as skill
          </Button>
          {onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Not now
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
