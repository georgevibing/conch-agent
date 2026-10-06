import { Check, ShieldAlert } from 'lucide-react';
import { RadioGroup as RadioPrimitive } from 'radix-ui';
import { useId, useState } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import type { ModeOption } from './ModePicker';
import styles from './ModeChoice.module.css';

export interface ModeChoiceProps {
  /** The same options as the chat's `ModePicker`: one definition, the same icons and words. */
  options: ModeOption[];
  value: string;
  onValueChange(value: string): void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Who the modes are about, in the confirmation: the assistant's name. */
  name?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The default mode, chosen on a settings page: every mode as a calm card with
 * its icon, name and one line, in the tone the chat's chip wears. Choosing a
 * `danger` mode asks once, right under it, before it's saved.
 */
export function ModeChoice({
  options,
  value,
  onValueChange,
  name = 'the assistant',
  disabled = false,
  className,
  ...labels
}: ModeChoiceProps) {
  const [confirming, setConfirming] = useState<ModeOption | null>(null);
  const id = useId();

  const choose = (next: string) => {
    const option = options.find((o) => o.value === next);
    if (!option || option.value === value) return;
    if (option.tone === 'danger') {
      setConfirming(option);
      return;
    }
    setConfirming(null);
    onValueChange(option.value);
  };

  return (
    <div className={cx(styles.choice, className)}>
      <RadioPrimitive.Root
        value={value}
        onValueChange={choose}
        disabled={disabled}
        className={styles.list}
        {...labels}
      >
        {options.map((option) => (
          <RadioPrimitive.Item
            key={option.value}
            value={option.value}
            data-tone={option.tone ?? 'default'}
            data-lustre=""
            aria-describedby={`${id}-${option.value}-about`}
            className={styles.option}
          >
            <span className={styles.icon} aria-hidden>
              {option.icon}
            </span>
            <span className={styles.text}>
              <span className={styles.label}>{option.label}</span>
              <span id={`${id}-${option.value}-about`} className={styles.description}>
                {option.description}
              </span>
            </span>
            <span className={styles.check} aria-hidden>
              <RadioPrimitive.Indicator>
                <Check />
              </RadioPrimitive.Indicator>
            </span>
          </RadioPrimitive.Item>
        ))}
      </RadioPrimitive.Root>
      {confirming && (
        <div className={styles.confirm} role="alertdialog" aria-labelledby={`${id}-confirm`}>
          <span className={styles.confirmIcon} aria-hidden>
            <ShieldAlert />
          </span>
          <p id={`${id}-confirm`} className={styles.confirmText}>
            <strong>{confirming.label}</strong> lets {name} run anything without asking, in every
            new chat. Turn it on?
          </p>
          <div className={styles.confirmActions}>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
              Keep asking
            </Button>
            <Button
              size="sm"
              tone="danger"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the one decision on screen
              autoFocus
              onClick={() => {
                setConfirming(null);
                onValueChange(confirming.value);
              }}
            >
              Turn on {confirming.label}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
