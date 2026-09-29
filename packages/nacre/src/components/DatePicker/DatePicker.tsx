import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, useIsPresent } from 'motion/react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { durations, easings } from '../../tokens';
import { cx } from '../../utils/cx';
import { useFieldControl } from '../Field';
import { IconButton } from '../IconButton';
import { Popover } from '../Popover';
import selectStyles from '../Select/Select.module.css';
import {
  addDays,
  addMonths,
  clampDate,
  isDate,
  localeWeekStart,
  localToday,
  monthGrid,
  sameMonth,
  startOfMonth,
  startOfWeek,
  toUtc,
  type Weekday,
} from './calendar';
import styles from './DatePicker.module.css';

export interface DatePickerProps {
  /** `YYYY-MM-DD`. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Earliest selectable day, inclusive. */
  min?: string;
  /** Latest selectable day, inclusive. */
  max?: string;
  /** What "today" is, e.g. in the schedule's timezone rather than the reader's. */
  today?: string;
  locale?: string;
  weekStartsOn?: Weekday;
  /** Show Today / Tomorrow / Next week shortcuts under the calendar. */
  quickPicks?: boolean;
  placeholder?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

/** Let the selection land before the panel leaves. */
const CLOSE_DELAY = 120;

const slide = {
  enter: (dir: number) => ({ x: dir * 28, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -28, opacity: 0 }),
};

function useFormatters(locale?: string) {
  return useMemo(() => {
    const f = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
    return {
      title: f({ month: 'long', year: 'numeric' }),
      weekdayShort: f({ weekday: 'short' }),
      weekdayLong: f({ weekday: 'long' }),
      day: f({ day: 'numeric' }),
      full: f({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      short: f({ weekday: 'short', month: 'short', day: 'numeric' }),
      shortYear: f({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
      relative: new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
    };
  }, [locale]);
}

const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/**
 * A calendar in a popover. The trigger reads like speech ("Tomorrow · Thu,
 * Oct 1"). Arrow keys walk the days, Page Up/Down turn months (with Shift,
 * years), Home/End jump to the week's edges; months slide in the direction
 * you're travelling.
 */
export function DatePicker({
  value: valueProp,
  defaultValue,
  onValueChange,
  min,
  max,
  today: todayProp,
  locale,
  weekStartsOn,
  quickPicks = true,
  placeholder = 'Pick a date',
  size = 'md',
  invalid: invalidProp,
  disabled: disabledProp,
  required: requiredProp,
  id,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: DatePickerProps) {
  const {
    invalid,
    labelId: _labelId,
    ...field
  } = useFieldControl({
    id,
    invalid: invalidProp,
    disabled: disabledProp,
    required: requiredProp,
    'aria-describedby': ariaDescribedBy,
  });
  const [internal, setInternal] = useState(defaultValue);
  const value = valueProp ?? internal;
  const selected = isDate(value) ? value : undefined;
  const today = todayProp ?? localToday();
  const fmt = useFormatters(locale);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const pick = (date: string) => {
    if (date !== value) {
      if (valueProp === undefined) setInternal(date);
      onValueChange?.(date);
    }
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };

  const days = selected ? Math.round((toUtc(selected) - toUtc(today)) / 86_400_000) : 0;
  const relative =
    selected && Math.abs(days) <= 1 ? capitalise(fmt.relative.format(days, 'day')) : undefined;
  const dateText = selected
    ? (selected.slice(0, 4) === today.slice(0, 4) ? fmt.short : fmt.shortYear).format(
        toUtc(selected),
      )
    : undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={field.id}
          disabled={field.disabled}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={field['aria-describedby']}
          data-size={size}
          data-variant="field"
          data-invalid={invalid || undefined}
          data-placeholder={selected ? undefined : ''}
          className={cx(selectStyles.trigger, styles.trigger, className)}
        >
          <span className={selectStyles.leading} aria-hidden>
            <CalendarDays />
          </span>
          <span className={cx(selectStyles.value, styles.value)}>
            {selected ? (
              <>
                {relative && <span className={styles.relative}>{relative}</span>}
                <span className={relative ? styles.muted : undefined}>{dateText}</span>
              </>
            ) : (
              placeholder
            )}
          </span>
          <span className={selectStyles.chevron} aria-hidden>
            <ChevronDown />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Content
        padding="none"
        align="start"
        sideOffset={6}
        className={styles.content}
        aria-label="Choose a date"
        onOpenAutoFocus={(event) => {
          // Land on the chosen (or today's) day, not the month buttons.
          const day = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
            '[data-day][tabindex="0"]',
          );
          if (day) {
            event.preventDefault();
            day.focus();
          }
        }}
      >
        <Calendar
          value={selected}
          today={today}
          min={min}
          max={max}
          weekStart={weekStartsOn ?? localeWeekStart(locale)}
          fmt={fmt}
          quickPicks={quickPicks}
          onPick={pick}
        />
      </Popover.Content>
    </Popover.Root>
  );
}

interface CalendarProps {
  value?: string;
  today: string;
  min?: string;
  max?: string;
  weekStart: Weekday;
  fmt: ReturnType<typeof useFormatters>;
  quickPicks: boolean;
  onPick: (date: string) => void;
}

function Calendar({ value, today, min, max, weekStart, fmt, quickPicks, onPick }: CalendarProps) {
  const id = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(() => clampDate(value ?? today, min, max));
  const [month, setMonth] = useState(() => startOfMonth(focused));
  const [direction, setDirection] = useState(0);
  const moveFocus = useRef(false);

  const weeks = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const header = weeks[0] ?? [];
  const inRange = (date: string) => clampDate(date, min, max) === date;
  const canPrev = !min || addDays(month, -1) >= min;
  const canNext = !max || addMonths(month, 1) <= max;

  const showMonth = (next: string) => {
    const target = startOfMonth(next);
    if (target === month) return;
    setDirection(target > month ? 1 : -1);
    setMonth(target);
  };

  const go = (date: string) => {
    const next = clampDate(date, min, max);
    moveFocus.current = true;
    setFocused(next);
    if (!sameMonth(next, month)) showMonth(next);
  };

  const turn = (months: number) => {
    const next = clampDate(addMonths(focused, months), min, max);
    setFocused(next);
    showMonth(next);
  };

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-present] [data-day="${focused}"]`)?.focus();
  }, [focused, month]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, () => string> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => startOfWeek(focused, weekStart),
      End: () => addDays(startOfWeek(focused, weekStart), 6),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
    };
    const next = keys[event.key];
    if (!next) return;
    event.preventDefault();
    go(next());
  };

  const picks = quickPicks
    ? [
        { date: today, label: capitalise(fmt.relative.format(0, 'day')) },
        { date: addDays(today, 1), label: capitalise(fmt.relative.format(1, 'day')) },
        { date: addDays(today, 7), label: capitalise(fmt.relative.format(1, 'week')) },
      ].filter((p) => inRange(p.date))
    : [];

  return (
    <MotionConfig reducedMotion="user">
      <div className={styles.header}>
        <div className={styles.title} id={`${id}-title`} aria-live="polite">
          <AnimatePresence initial={false} mode="popLayout" custom={direction}>
            <Slide key={month} direction={direction} className={styles.titleText}>
              {fmt.title.format(toUtc(month))}
            </Slide>
          </AnimatePresence>
        </div>
        <IconButton
          label="Previous month"
          size="sm"
          variant="ghost"
          tooltip={false}
          disabled={!canPrev}
          onClick={() => turn(-1)}
        >
          <ChevronLeft />
        </IconButton>
        <IconButton
          label="Next month"
          size="sm"
          variant="ghost"
          tooltip={false}
          disabled={!canNext}
          onClick={() => turn(1)}
        >
          <ChevronRight />
        </IconButton>
      </div>

      <div ref={gridRef} role="grid" aria-labelledby={`${id}-title`} className={styles.grid}>
        <div role="row" className={styles.row}>
          {header.map((d) => (
            <span
              key={d}
              role="columnheader"
              aria-label={fmt.weekdayLong.format(toUtc(d))}
              className={styles.weekday}
            >
              {fmt.weekdayShort.format(toUtc(d))}
            </span>
          ))}
        </div>
        <div className={styles.weeks}>
          <AnimatePresence initial={false} mode="popLayout" custom={direction}>
            <Slide key={month} direction={direction} role="rowgroup" className={styles.body}>
              {weeks.map((week) => (
                <div key={week[0]} role="row" className={styles.row}>
                  {week.map((date) => {
                    const isSelected = date === value;
                    const outside = !sameMonth(date, month);
                    return (
                      <div key={date} role="gridcell" aria-selected={isSelected}>
                        <button
                          type="button"
                          data-day={date}
                          tabIndex={date === focused ? 0 : -1}
                          aria-label={fmt.full.format(toUtc(date))}
                          aria-current={date === today ? 'date' : undefined}
                          disabled={!inRange(date)}
                          data-selected={isSelected || undefined}
                          data-today={date === today || undefined}
                          data-outside={outside || undefined}
                          className={styles.day}
                          onKeyDown={onKeyDown}
                          onFocus={() => setFocused(date)}
                          onClick={() => {
                            setFocused(date);
                            if (outside) showMonth(date);
                            onPick(date);
                          }}
                        >
                          <span className={styles.dayText}>{fmt.day.format(toUtc(date))}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </Slide>
          </AnimatePresence>
        </div>
      </div>

      {picks.length > 0 && (
        <div className={styles.picks} role="group" aria-label="Quick picks">
          {picks.map((p) => (
            <button
              key={p.label}
              type="button"
              className={styles.pick}
              aria-pressed={p.date === value}
              data-on={p.date === value || undefined}
              onClick={() => {
                setFocused(p.date);
                showMonth(p.date);
                onPick(p.date);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </MotionConfig>
  );
}

/**
 * A month sliding in or out. The outgoing copy is hidden from assistive tech
 * and made inert so only the arriving month can be read, focused or clicked.
 */
function Slide({
  direction,
  role,
  className,
  children,
}: {
  direction: number;
  role?: 'rowgroup';
  className?: string;
  children: ReactNode;
}) {
  const present = useIsPresent();
  return (
    <motion.div
      role={role}
      custom={direction}
      variants={slide}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: durations.base, ease: easings.out }}
      aria-hidden={present ? undefined : true}
      inert={!present}
      data-present={present || undefined}
      className={className}
    >
      {children}
    </motion.div>
  );
}
