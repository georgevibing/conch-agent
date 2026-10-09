import { Check, ChevronDown, ShieldAlert } from 'lucide-react';
import { Popover as PopoverPrimitive, RadioGroup as RadioPrimitive } from 'radix-ui';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import { PickerDefault } from '../ModelPicker/ModelPicker';
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
  /** Who the modes are about, in the confirmation: the assistant's name. */
  name?: string;
}

export interface ModeListProps {
  options: ModeOption[];
  value: string;
  onValueChange(value: string): void;
  /** A `danger` mode waiting for its second, deliberate yes; `null` shows the list. */
  confirming: ModeOption | null;
  onConfirmingChange(option: ModeOption | null): void;
  /** Prefix of every row's id, so the chosen one can be focused. */
  listId: string;
  /** Who the modes are about, in the confirmation: the assistant's name. */
  name?: string;
}

/**
 * The modes as a list, each with what it lets happen; switching into a
 * `danger` one asks again, in place of the list. The body of the mode chip's
 * panel, and the Mode section of the composer's one settings panel.
 */
export function ModeList({
  options,
  value,
  onValueChange,
  confirming,
  onConfirmingChange,
  listId,
  name = 'the assistant',
}: ModeListProps) {
  const choose = (next: string) => {
    const option = options.find((o) => o.value === next);
    if (!option || option.value === value) return;
    if (option.tone === 'danger') {
      onConfirmingChange(option);
      return;
    }
    onValueChange(option.value);
  };

  if (confirming)
    return (
      <div className={styles.confirm} role="alertdialog" aria-labelledby={`${listId}-confirm`}>
        <span className={styles.confirmIcon} aria-hidden>
          <ShieldAlert />
        </span>
        <p id={`${listId}-confirm`} className={styles.confirmText}>
          <strong>{confirming.label}</strong> lets {name} run anything without asking. Turn it on?
        </p>
        <div className={styles.confirmActions}>
          <Button variant="ghost" size="sm" onClick={() => onConfirmingChange(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            tone="danger"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the one decision on screen
            autoFocus
            onClick={() => {
              onValueChange(confirming.value);
              onConfirmingChange(null);
            }}
          >
            Turn on
          </Button>
        </div>
      </div>
    );

  return (
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
  );
}

/**
 * How much the assistant may do without asking. The chip wears the mode's tone, so
 * a trusting mode always looks armed; switching into a `danger` mode needs a
 * second, deliberate confirmation. The composer itself uses `ComposerSettings`,
 * which holds this list with the model and the rest.
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
  name = 'the assistant',
}: ModePickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const [confirming, setConfirming] = useState<ModeOption | null>(null);
  const listId = useId();

  const setOpen = (next: boolean) => {
    if (!next) setConfirming(null);
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const current = options.find((o) => o.value === value) ?? options[0];

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
        <ModeList
          options={options}
          value={value}
          onValueChange={onValueChange}
          confirming={confirming}
          onConfirmingChange={setConfirming}
          listId={listId}
          name={name}
        />
        {!confirming && (
          <PickerDefault isDefault={isDefault} {...(onMakeDefault && { onMakeDefault })} />
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
