import { Route, ShieldAlert, X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './SkillOffer.module.css';

export interface SkillOfferProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** How many steps the work took. */
  steps?: number;
  /**
   * Learned in a chat that read something from outside (ADR 0028), in a
   * sentence: “Learned in a chat that read trains.example.”
   */
  untrusted?: string;
  /** Opens New skill with the draft filled in. */
  onSave: () => void;
  /** Not now. */
  onDismiss?: () => void;
}

/**
 * Save how I did this (ADR 0058): one quiet line under a reply that took
 * real work and went well, with one button. Never a dialog, never while the
 * answer is being written, never twice in a chat. The button only opens the
 * draft: nothing is saved until you save it.
 */
export function SkillOffer({
  steps,
  untrusted,
  onSave,
  onDismiss,
  className,
  ...props
}: SkillOfferProps) {
  return (
    <div
      role="group"
      aria-label="Save how this was done as a skill"
      className={cx(styles.offer, className)}
      {...props}
    >
      <div className={styles.line}>
        <Route aria-hidden className={styles.icon} />
        <span className={styles.words}>
          {steps !== undefined ? `That took ${steps} steps, and it worked.` : 'That worked.'}
        </span>
        <Button size="sm" variant="soft" onClick={onSave} className={styles.save}>
          Save how I did this as a skill
        </Button>
        {onDismiss && (
          <IconButton size="sm" label="Not now" onClick={onDismiss}>
            <X />
          </IconButton>
        )}
      </div>
      {untrusted && (
        <p className={styles.untrusted}>
          <ShieldAlert aria-hidden />
          <span>{untrusted} Read the steps before you save it.</span>
        </p>
      )}
    </div>
  );
}
