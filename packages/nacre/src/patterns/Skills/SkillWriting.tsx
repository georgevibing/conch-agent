import { RotateCw, Sparkles, Undo2 } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import styles from './SkillWriting.module.css';

export interface SkillWritingProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** `writing` while the steps are on their way; `written` once they're in, yours to change. */
  state: 'writing' | 'written';
  /** The assistant's name: “Conch wrote these from your words.” */
  by: string;
  /** Write them again, from the same words. */
  onAgain?: () => void;
  /** Put back what you had typed. */
  onUndo?: () => void;
}

/**
 * Write it for me: the quiet line under a skill's steps while the assistant
 * writes them from your idea, then once it has. It never claims the result is
 * finished: the steps are yours to read and change, and your own words are one
 * press away.
 */
export function SkillWriting({
  state,
  by,
  onAgain,
  onUndo,
  className,
  ...props
}: SkillWritingProps) {
  const writing = state === 'writing';
  return (
    <div
      role="status"
      aria-live="polite"
      data-state={state}
      className={cx(styles.note, className)}
      {...props}
    >
      {writing ? (
        <Pearl size="sm" state="thinking" label={null} className={styles.pearl} />
      ) : (
        <Sparkles aria-hidden className={styles.icon} />
      )}
      <span className={styles.words}>
        {writing
          ? `${by} is writing the steps from your words…`
          : `${by} wrote these from your words. Read them, and change anything.`}
      </span>
      {!writing && (onAgain || onUndo) && (
        <span className={styles.actions}>
          {onAgain && (
            <Button size="sm" variant="ghost" leadingIcon={<RotateCw />} onClick={onAgain}>
              Write it again
            </Button>
          )}
          {onUndo && (
            <Button size="sm" variant="ghost" leadingIcon={<Undo2 />} onClick={onUndo}>
              Back to my words
            </Button>
          )}
        </span>
      )}
    </div>
  );
}
