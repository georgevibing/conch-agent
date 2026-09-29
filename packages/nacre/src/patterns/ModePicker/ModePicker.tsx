import { Check, ChevronDown, ShieldAlert } from 'lucide-react';
import { Popover as PopoverPrimitive, RadioGroup as RadioPrimitive } from 'radix-ui';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import picker from '../ModelPicker/ModelPicker.module.css';
import styles from './ModePicker.module.css';

export interface ModeOption {
  value: string;
  label: string;
  description: string;
  icon?: ReactNode;
  /** `danger` options ask for confirmation before switching. */
  tone?: 'default' | 'caution' | 'danger';
}

export interface ModePickerProps {
  options: ModeOption[];
  value: string;
  onValueChange(value: string): void;
  isDefault: boolean;
  onMakeDefault?(): void;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  side?: 'top' | 'bottom';
  className?: string;
}

/**
 * How much Claude may do without asking. The chip wears the mode's tone, so
 * a trusting mode always looks armed; switching into a `danger` mode needs a
 * second, deliberate confirmation.
 */
export function ModePicker({
  options,
  value,
  onValueChange,
  isDefault,
  onMakeDefault,
  disabled = false,
  open: openProp,
  onOpenChange,
  side = 'top',
  className,
}: ModePickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const [confirming, setConfirming] = useState<ModeOption | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const listId = useId();

  const setOpen = (next: boolean) => {
    if (!next) setConfirming(null);
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(t);
  }, [justSaved]);

  const current = options.find((o) => o.value === value) ?? options[0];

  const choose = (next: string) => {
    const option = options.find((o) => o.value === next);
    if (!option || option.value === value) return;
    if (option.tone === 'danger') {
      setConfirming(option);
      return;
    }
    onValueChange(option.value);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cx(picker.chip, styles.chip, className)}
          data-lustre=""
          data-tone={current?.tone ?? 'default'}
          aria-label={`Mode: ${current?.label ?? value}`}
        >
          {current?.icon && <span className={styles.chipIcon}>{current.icon}</span>}
          <span className={picker.chipLabel}>{current?.label ?? value}</span>
          <ChevronDown className={picker.chevron} aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>
      <Popover.Content
        side={side}
        align="start"
        padding="none"
        className={cx(picker.panel, styles.panel)}
        aria-label="Mode"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(`${listId}-${value}`)?.focus();
        }}
      >
        {confirming ? (
          <div className={styles.confirm} role="alertdialog" aria-labelledby={`${listId}-confirm`}>
            <span className={styles.confirmIcon} aria-hidden>
              <ShieldAlert />
            </span>
            <p id={`${listId}-confirm`} className={styles.confirmText}>
              <strong>{confirming.label}</strong> lets Claude run anything without asking. Turn it
              on?
            </p>
            <div className={styles.confirmActions}>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                tone="danger"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the one decision on screen
                autoFocus
                onClick={() => {
                  onValueChange(confirming.value);
                  setConfirming(null);
                }}
              >
                Turn on
              </Button>
            </div>
          </div>
        ) : (
          <RadioPrimitive.Root
            value={value}
            onValueChange={choose}
            aria-label="Mode"
            className={picker.list}
            loop
            onKeyDown={(event) => {
              const next = (event.target as HTMLElement).dataset.value;
              if (event.key === 'Enter' && next) {
                event.preventDefault();
                choose(next);
              }
            }}
          >
            {options.map((option) => (
              <RadioPrimitive.Item
                key={option.value}
                id={`${listId}-${option.value}`}
                value={option.value}
                data-value={option.value}
                data-tone={option.tone ?? 'default'}
                className={cx(picker.row, styles.row)}
              >
                <span className={styles.icon} aria-hidden>
                  {option.icon}
                </span>
                <span className={picker.rowText}>
                  <span className={picker.rowLabel}>{option.label}</span>
                  <span className={picker.rowDescription}>{option.description}</span>
                </span>
                <RadioPrimitive.Indicator className={picker.check}>
                  <Check aria-hidden />
                </RadioPrimitive.Indicator>
              </RadioPrimitive.Item>
            ))}
          </RadioPrimitive.Root>
        )}
        {!confirming && (
          <div className={picker.footer}>
            {isDefault ? (
              <span className={picker.defaultNote} data-saved={justSaved || undefined}>
                <Check aria-hidden className={picker.defaultCheck} />
                {justSaved ? 'Saved as your default' : 'Your default'}
              </span>
            ) : (
              onMakeDefault && (
                <button
                  type="button"
                  className={picker.makeDefault}
                  onClick={() => {
                    onMakeDefault();
                    setJustSaved(true);
                  }}
                >
                  Make this my default
                </button>
              )
            )}
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
