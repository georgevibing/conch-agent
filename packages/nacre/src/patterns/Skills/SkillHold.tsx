import { ShieldCheck } from 'lucide-react';
import { useState, type ComponentProps } from 'react';

import { AlertDialog } from '../../components/AlertDialog';
import { Button } from '../../components/Button';
import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import { SkillPermissionList, type SkillCapabilityName } from './SkillPermissionList';
import styles from './SkillHold.module.css';

export interface SkillHoldEntry {
  skillId: string;
  title: string;
  /** What it may do, as `SkillPermissionList` shows it. */
  capabilities: SkillCapabilityName[];
  words: string[];
  declared: boolean;
}

export interface SkillHoldProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The skills this chat is held to, oldest first. */
  holds: SkillHoldEntry[];
  /** Stop holding the chat to one. Resolves when that's done; throws to keep the dialog open. */
  onStop?: (skillId: string) => Promise<void> | void;
  /** An answer is being written: stopping waits until it's done. */
  busy?: boolean;
  /** Asking about this one right now (⌘K opens the question). Controlled with `onAskingChange`. */
  asking?: string;
  onAskingChange?: (skillId: string | undefined) => void;
}

/**
 * What this chat is held to (ADR 0040): once a skill's instructions are in a
 * chat, anything it tries that isn't on its list asks first, in every later
 * turn, until you stop holding it. One quiet line above the composer per
 * skill: its name opens the list; **Stop holding** asks once, in words, and
 * is a person's choice only.
 */
export function SkillHold({
  holds,
  onStop,
  busy = false,
  asking: askingProp,
  onAskingChange,
  className,
  ...props
}: SkillHoldProps) {
  const [askingOwn, setAskingOwn] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const asking = askingProp ?? askingOwn;
  const setAsking = (skillId: string | undefined) => {
    setAskingOwn(skillId);
    onAskingChange?.(skillId);
  };
  const askingAbout = holds.find((h) => h.skillId === asking);
  if (!holds.length) return null;

  const stop = async () => {
    if (!askingAbout || !onStop) return;
    setStopping(true);
    try {
      await onStop(askingAbout.skillId);
      setAsking(undefined);
    } catch {
      // The caller said why; the question stays so it can be tried again.
    } finally {
      setStopping(false);
    }
  };

  return (
    <div
      role="group"
      aria-label="Skills this chat is held to"
      className={cx(styles.holds, className)}
      {...props}
    >
      {holds.map((hold) => (
        <div key={hold.skillId} className={styles.hold} data-busy={busy || undefined}>
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                className={styles.label}
                aria-label={`Held to ${hold.title}’s list. See what it can do`}
              >
                <ShieldCheck aria-hidden className={styles.icon} />
                <span className={styles.text}>
                  Held to <strong className={styles.name}>{hold.title}</strong>’s list
                </span>
              </button>
            </Popover.Trigger>
            <Popover.Content
              align="start"
              side="top"
              className={styles.popover}
              aria-label={`What ${hold.title} can do`}
            >
              <SkillPermissionList
                variant="compact"
                capabilities={hold.capabilities}
                words={hold.words}
                declared={hold.declared}
              />
              <p className={styles.fine}>
                Its instructions are in this chat, so this holds in every turn until you stop it.
              </p>
            </Popover.Content>
          </Popover.Root>
          {onStop && (
            <Button
              size="sm"
              variant="ghost"
              className={styles.stop}
              disabled={busy}
              aria-label={`Stop holding this chat to ${hold.title}’s list`}
              title={busy ? 'After this answer' : undefined}
              onClick={() => setAsking(hold.skillId)}
            >
              Stop holding
            </Button>
          )}
        </div>
      ))}
      <AlertDialog.Root
        open={Boolean(askingAbout)}
        onOpenChange={(open) => !open && setAsking(undefined)}
      >
        {askingAbout && (
          <AlertDialog.Content icon={<ShieldCheck />} tone="accent">
            <AlertDialog.Header>
              <AlertDialog.Title>
                Stop holding this chat to {askingAbout.title}’s list?
              </AlertDialog.Title>
              <AlertDialog.Description>
                Its instructions are still in this chat. From now on it can do what this chat’s mode
                allows without checking with you first. Activity keeps a note that you did this.
              </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <AlertDialog.Cancel>Keep holding</AlertDialog.Cancel>
              <AlertDialog.Action
                tone="danger"
                loading={stopping}
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  void stop();
                }}
              >
                Stop holding
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        )}
      </AlertDialog.Root>
    </div>
  );
}

export interface SkillHoldEndedProps extends Omit<ComponentProps<'p'>, 'children'> {
  title: string;
}

/** A quiet line in the chat where you stopped holding it to a skill's list. */
export function SkillHoldEnded({ title, className, ...props }: SkillHoldEndedProps) {
  return (
    <p className={cx(styles.ended, className)} {...props}>
      <ShieldCheck aria-hidden />
      <span>You stopped holding this chat to {title}’s list.</span>
    </p>
  );
}
