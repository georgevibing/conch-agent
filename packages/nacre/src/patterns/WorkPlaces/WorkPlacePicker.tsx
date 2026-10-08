import { ArrowRight, Check, ChevronDown, Info } from 'lucide-react';
import { Popover as PopoverPrimitive, RadioGroup as RadioPrimitive } from 'radix-ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import picker from '../ModelPicker/ModelPicker.module.css';
import { PlaceGlyph, type WorkPlaceKind } from './WorkedAt';
import styles from './WorkPlaces.module.css';

export type WorkPlaceState = 'ready' | 'preparing' | 'needs-setup' | 'unavailable';

export interface WorkPlaceOption {
  value: string;
  kind: WorkPlaceKind;
  label: string;
  description: string;
  state?: WorkPlaceState;
  /** What's wrong or going on, in one sentence, when it isn't ready. */
  message?: string;
  /**
   * A place that needs setting up first. Its row isn't chosen: pressing it
   * closes the list and takes the person to where it's set up (Settings,
   * with the key's box ready to type in). `label` is the few words said
   * after the message ("Add a key"); `where` is read out after it.
   */
  setup?: WorkPlaceSetup;
}

export interface WorkPlaceSetup {
  /** "Add a key", "Set it up". */
  label: string;
  /** Read after the label, for a screen reader: "opens Settings". */
  where?: string;
  onSetup(): void;
}

export interface WorkPlacePickerProps {
  options: WorkPlaceOption[];
  value: string;
  onValueChange(value: string): void;
  isDefault: boolean;
  onMakeDefault?(): void;
  /**
   * Said plainly above the list when the chat's provider runs its own
   * commands on this computer whatever is chosen ("Codex CLI runs…").
   */
  note?: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  side?: 'top' | 'bottom';
  className?: string;
}

const STATE_WORDS: Record<WorkPlaceState, string> = {
  ready: 'Ready',
  preparing: 'Getting ready',
  'needs-setup': 'Needs setting up',
  unavailable: 'Not answering',
};

/**
 * Where the chat's work runs (ADR 0106): this computer, a container, a
 * machine of yours, the cloud. A calm chip beside the mode: its mark is the
 * place, and when the place changes the mark glides in from below with a
 * glint, as if the work had just moved there. A place that isn't ready wears
 * a small dot. A place that needs setting up isn't chosen: its row says what
 * it needs and, quietly, the next step, and pressing it goes there.
 */
export function WorkPlacePicker({
  options,
  value,
  onValueChange,
  isDefault,
  onMakeDefault,
  note,
  disabled = false,
  open: openProp,
  onOpenChange,
  side = 'top',
  className,
}: WorkPlacePickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const [justSaved, setJustSaved] = useState(false);
  const [moved, setMoved] = useState(false);
  const listId = useId();
  const previous = useRef(value);
  // Arrow keys move along the list and choose as they go: a row that needs
  // setting up is passed over, never opened, on the way.
  const arrowing = useRef(false);

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  // The work moved: the chip plays its arrival once.
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setMoved(true);
    const t = setTimeout(() => setMoved(false), 900);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(t);
  }, [justSaved]);

  const current = options.find((o) => o.value === value) ?? options[0];
  const waiting = current?.state && current.state !== 'ready';

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cx(picker.chip, styles.chip, className)}
          data-lustre=""
          data-kind={current?.kind ?? 'computer'}
          data-moved={moved || undefined}
          data-waiting={waiting ? current?.state : undefined}
          aria-label={`Where work runs: ${current?.label ?? value}${waiting && current?.state ? `, ${STATE_WORDS[current.state].toLowerCase()}` : ''}`}
        >
          <span className={styles.chipIcon} key={current?.value}>
            <PlaceGlyph kind={current?.kind ?? 'computer'} />
            {waiting && <span className={styles.chipDot} aria-hidden />}
          </span>
          <span className={picker.chipLabel}>{current?.label ?? value}</span>
          <ChevronDown className={picker.chevron} aria-hidden />
          {moved && <span className={styles.chipGlint} aria-hidden />}
        </button>
      </PopoverPrimitive.Trigger>
      <Popover.Content
        side={side}
        align="start"
        padding="none"
        className={cx(picker.panel, styles.panel)}
        aria-label="Where work runs"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(`${listId}-${value}`)?.focus();
        }}
      >
        <p className={styles.heading}>Where work runs</p>
        {note && (
          <p className={styles.note}>
            <Info aria-hidden className={styles.noteIcon} />
            {note}
          </p>
        )}
        <RadioPrimitive.Root
          value={value}
          onValueChange={(next) => {
            const setup = options.find((o) => o.value === next)?.setup;
            if (!setup) return onValueChange(next);
            if (arrowing.current) return;
            setOpen(false);
            setup.onSetup();
          }}
          onKeyDownCapture={(event) => {
            arrowing.current = event.key.startsWith('Arrow');
          }}
          onKeyUpCapture={() => {
            arrowing.current = false;
          }}
          aria-label="Where work runs"
          className={picker.list}
          loop
        >
          {options.map((option) => {
            const state = option.state ?? 'ready';
            const { setup } = option;
            return (
              <div key={option.value} className={styles.option}>
                <RadioPrimitive.Item
                  id={`${listId}-${option.value}`}
                  value={option.value}
                  data-kind={option.kind}
                  data-place-state={state}
                  data-setup={setup ? '' : undefined}
                  className={cx(picker.row, styles.row)}
                  aria-describedby={`${listId}-${option.value}-about`}
                  {...(setup && {
                    // A radio doesn't answer Enter; a row that goes somewhere does.
                    onKeyDown: (event: KeyboardEvent) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      setOpen(false);
                      setup.onSetup();
                    },
                  })}
                >
                  <span className={styles.icon} aria-hidden>
                    <PlaceGlyph kind={option.kind} />
                  </span>
                  <span className={picker.rowText}>
                    <span className={picker.rowLabel}>
                      {option.label}
                      {state !== 'ready' && (
                        <span className={styles.state} data-place-state={state}>
                          {STATE_WORDS[state]}
                        </span>
                      )}
                    </span>
                    <span id={`${listId}-${option.value}-about`} className={picker.rowDescription}>
                      {state !== 'ready' && option.message ? option.message : option.description}
                      {setup && (
                        <>
                          {' '}
                          <span className={styles.setup}>
                            {setup.label}
                            <ArrowRight aria-hidden className={styles.setupIcon} />
                          </span>
                          <span className="nc-visually-hidden">
                            , {setup.where ?? 'opens Settings'}
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                  <RadioPrimitive.Indicator className={picker.check}>
                    <Check aria-hidden />
                  </RadioPrimitive.Indicator>
                </RadioPrimitive.Item>
              </div>
            );
          })}
        </RadioPrimitive.Root>
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
      </Popover.Content>
    </Popover.Root>
  );
}
