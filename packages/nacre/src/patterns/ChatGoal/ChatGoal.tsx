import { Pencil, Target, X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import styles from './ChatGoal.module.css';

export interface ChatGoalProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** What the chat is for, in the person's words. Nothing is drawn without one. */
  goal?: string;
  /** Change it: the app puts `/goal …` in the message box. */
  onEdit?: () => void;
  /** Take it away. */
  onClear?: () => void;
}

/**
 * The chat's goal (`/goal`), one quiet line above the composer: felt more
 * than seen, so it never competes with the conversation. It opens to show
 * the goal whole, what it does, and **Edit** and **Clear goal**.
 */
export function ChatGoal({ goal, onEdit, onClear, className, ...props }: ChatGoalProps) {
  const text = goal?.trim();
  if (!text) return null;
  return (
    <div className={cx(styles.goal, className)} {...props}>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className={styles.label} aria-label={`Goal: ${text}. Change it`}>
            <Target aria-hidden className={styles.icon} />
            <span className={styles.kicker}>Goal</span>
            <span className={styles.text}>{text}</span>
          </button>
        </Popover.Trigger>
        <Popover.Content
          align="start"
          side="top"
          className={styles.popover}
          aria-label="This chat’s goal"
        >
          <p className={styles.full}>{text}</p>
          <p className={styles.fine}>
            Kept in mind in every reply, whichever model answers, and kept when you clear the chat.
          </p>
          {(onEdit || onClear) && (
            <div className={styles.actions}>
              {onEdit && (
                <Popover.Close asChild>
                  <Button size="sm" variant="soft" leadingIcon={<Pencil />} onClick={onEdit}>
                    Edit
                  </Button>
                </Popover.Close>
              )}
              {onClear && (
                <Popover.Close asChild>
                  <Button size="sm" variant="ghost" leadingIcon={<X />} onClick={onClear}>
                    Clear goal
                  </Button>
                </Popover.Close>
              )}
            </div>
          )}
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}

export interface GoalNoteProps extends Omit<ComponentProps<'p'>, 'children'> {
  /** The goal as it was set; absent: it was cleared. */
  goal?: string;
}

/** In the transcript, where the goal was set or cleared: one small line. */
export function GoalNote({ goal, className, ...props }: GoalNoteProps) {
  const text = goal?.trim();
  return (
    <p className={cx(styles.note, className)} {...props}>
      <Target aria-hidden className={styles.noteIcon} />
      {text ? (
        <span>
          Goal set: <span className={styles.noteGoal}>{text}</span>
        </span>
      ) : (
        <span>Goal cleared</span>
      )}
    </p>
  );
}
