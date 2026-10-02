import { useId, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import styles from './AppAbilities.module.css';

export interface AppAbility {
  id: string;
  /** What it does, in two or three words: "Read & search", "Talk to me here". */
  title: string;
  /** One plain sentence about it. */
  description?: ReactNode;
  /** A small icon before the title. */
  icon?: ReactNode;
  /** On or off. Ignored while it still needs setting up (`setup`). */
  on: boolean;
  onChange?: (on: boolean) => void;
  /** Can't be changed right now (the app is off). */
  disabled?: boolean;
  /** Being changed: the switch waits, with a spinner beside it. */
  busy?: boolean;
  /**
   * Turning it on takes a step first (a key to paste, a page to visit): a
   * button that starts it, instead of a switch that would only pretend.
   */
  setup?: { label: string; onClick: () => void; loading?: boolean };
  /** A quiet line under the description: who it talks as, what it can't do. */
  note?: ReactNode;
  /** The note needs looking at (a key stopped working): said in words and colour. */
  attention?: boolean;
  /** One more thing to do with it when on ("Who can talk to it"). */
  action?: { label: string; onClick: () => void };
}

export interface AppAbilitiesProps extends Omit<ComponentProps<'ul'>, 'children'> {
  /** Names the list: "What Slack does". */
  label: string;
  abilities: AppAbility[];
}

/**
 * What an app does, as plain switches (ADR 0052): "Read & search", "Draft",
 * "Send (asks first)", "Talk to me here". One row each, the switch at the
 * end like a phone's settings. A row whose half isn't set up yet has the one
 * button that sets it up instead, so nothing ever looks on when it isn't.
 */
export function AppAbilities({ label, abilities, className, ...props }: AppAbilitiesProps) {
  return (
    <ul aria-label={label} className={cx(styles.root, className)} {...props}>
      {abilities.map((ability) => (
        <AbilityRow key={ability.id} ability={ability} />
      ))}
    </ul>
  );
}

function AbilityRow({ ability }: { ability: AppAbility }) {
  const titleId = useId();
  const aboutId = useId();
  const noteId = useId();
  const { title, description, icon, on, setup, note, attention, action, busy } = ability;
  const shownOn = on && !setup;
  const describedBy = [description && aboutId, note && noteId].filter(Boolean).join(' ');
  return (
    <li
      className={styles.row}
      data-on={shownOn || undefined}
      data-attention={attention || undefined}
      aria-busy={busy || undefined}
    >
      {icon && (
        <span className={styles.icon} aria-hidden>
          {icon}
        </span>
      )}
      <div className={styles.about}>
        <p id={titleId} className={styles.title}>
          {title}
        </p>
        {description && (
          <p id={aboutId} className={styles.description}>
            {description}
          </p>
        )}
        {note && (
          <p id={noteId} className={styles.note}>
            {note}
          </p>
        )}
        {action && shownOn && (
          <Button
            variant="ghost"
            tone="accent"
            size="sm"
            className={styles.link}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        )}
      </div>
      <div className={styles.control}>
        {busy && <Spinner size="xs" label={null} />}
        {setup ? (
          <Button
            size="sm"
            variant="surface"
            onClick={setup.onClick}
            loading={setup.loading}
            disabled={ability.disabled}
            aria-describedby={describedBy || undefined}
          >
            {setup.label}
          </Button>
        ) : (
          <Switch
            checked={on}
            onCheckedChange={ability.onChange}
            disabled={ability.disabled || busy}
            aria-labelledby={titleId}
            aria-describedby={describedBy || undefined}
          />
        )}
      </div>
    </li>
  );
}
