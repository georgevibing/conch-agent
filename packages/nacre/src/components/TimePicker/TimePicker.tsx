import { Clock3 } from 'lucide-react';
import { MotionConfig, motion } from 'motion/react';
import { ToggleGroup } from 'radix-ui';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { springs } from '../../tokens';
import { cx } from '../../utils/cx';
import { useFieldControl } from '../Field';
import inputStyles from '../Input/Input.module.css';
import { Popover } from '../Popover';
import { SegmentedControl } from '../SegmentedControl';
import {
  dayPeriods,
  formatTime,
  from12,
  localeHourCycle,
  parseTime,
  to12,
  wrap,
  type Clock,
  type HourCycle,
} from './time';
import styles from './TimePicker.module.css';

export interface TimePreset {
  label: string;
  /** `HH:MM`, 24-hour. */
  value: string;
}

export interface TimePickerProps {
  /** `HH:MM`, 24-hour, whatever the display. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Defaults to the reader's locale (12-hour in en-US, 24-hour in most of Europe). */
  hourCycle?: HourCycle;
  /** Spacing of the minute chips in the picker. Typing and arrow keys still reach every minute. */
  minuteStep?: 1 | 5 | 10 | 15 | 30;
  /** One-tap choices under the grids, e.g. Morning / Noon / Evening. */
  presets?: TimePreset[];
  locale?: string;
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

type Segment = 'hour' | 'minute' | 'period';

const pad = (n: number) => String(n).padStart(2, '0');
/** Let the selection pill land before the panel leaves. */
const CLOSE_DELAY = 140;

/**
 * Time of day. Type it — each part is its own spin button (↑/↓ to nudge,
 * digits to overwrite, ←/→ to move) — or open the clock face and tap an hour
 * then a minute. The pill glides between chips on a spring.
 */
export function TimePicker({
  value: valueProp,
  defaultValue = '09:00',
  onValueChange,
  hourCycle: hourCycleProp,
  minuteStep = 5,
  presets,
  locale,
  size = 'md',
  invalid: invalidProp,
  disabled: disabledProp,
  id,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: TimePickerProps) {
  const { invalid, disabled, labelId, ...field } = useFieldControl({
    id,
    invalid: invalidProp,
    disabled: disabledProp,
    'aria-describedby': ariaDescribedBy,
  });
  const [internal, setInternal] = useState(defaultValue);
  const value = valueProp ?? internal;
  const clock = parseTime(value);
  const h12 = (hourCycleProp ?? localeHourCycle(locale)) === 'h12';
  const periods = useMemo(() => dayPeriods(locale), [locale]);
  const pm = clock.hour >= 12;
  const segments: Segment[] = h12 ? ['hour', 'minute', 'period'] : ['hour', 'minute'];

  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState<{ segment: Segment; text: string }>();
  const refs = useRef<Partial<Record<Segment, HTMLSpanElement | null>>>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const set = (next: Clock) => {
    const formatted = formatTime(next);
    if (formatted === value) return;
    if (valueProp === undefined) setInternal(formatted);
    onValueChange?.(formatted);
  };

  const range = (segment: Segment): [number, number] =>
    segment === 'hour' ? (h12 ? [1, 12] : [0, 23]) : segment === 'minute' ? [0, 59] : [0, 1];

  const current = (segment: Segment) =>
    segment === 'hour'
      ? h12
        ? to12(clock.hour)
        : clock.hour
      : segment === 'minute'
        ? clock.minute
        : Number(pm);

  const setSegment = (segment: Segment, n: number) => {
    if (segment === 'hour') set({ ...clock, hour: h12 ? from12(n, pm) : n });
    else if (segment === 'minute') set({ ...clock, minute: n });
    else set({ ...clock, hour: (clock.hour % 12) + (n ? 12 : 0) });
  };

  const focusNext = (segment: Segment, direction: 1 | -1) => {
    const next = segments[segments.indexOf(segment) + direction];
    if (next) refs.current[next]?.focus();
  };

  const onSegmentKeyDown = (segment: Segment) => (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const [lo, hi] = range(segment);
    const now = current(segment);
    const bigStep = segment === 'minute' ? minuteStep : 1;
    const nav: Record<string, () => void> = {
      ArrowUp: () => setSegment(segment, wrap(now + 1, lo, hi)),
      ArrowDown: () => setSegment(segment, wrap(now - 1, lo, hi)),
      PageUp: () => setSegment(segment, wrap(now + bigStep, lo, hi)),
      PageDown: () => setSegment(segment, wrap(now - bigStep, lo, hi)),
      Home: () => setSegment(segment, lo),
      End: () => setSegment(segment, hi),
      ArrowLeft: () => focusNext(segment, -1),
      ArrowRight: () => focusNext(segment, 1),
      Backspace: () => {},
      Delete: () => {},
    };
    const action = nav[event.key];
    if (action) {
      event.preventDefault();
      setTyping(undefined);
      action();
      return;
    }

    if (segment === 'period') {
      const key = event.key.toLowerCase();
      const match = periods.findIndex((p) => p.toLowerCase().startsWith(key));
      const index = key === 'a' ? 0 : key === 'p' ? 1 : match;
      if (index >= 0 && key.length === 1) {
        event.preventDefault();
        setSegment('period', index);
      }
      return;
    }

    if (!/^\d$/.test(event.key)) return;
    event.preventDefault();
    let text = (typing?.segment === segment ? typing.text : '') + event.key;
    if (Number(text) > hi) text = event.key;
    const n = Number(text);
    if (n >= lo && n <= hi) setSegment(segment, n);
    // Two digits, or one that can't be followed by another (e.g. "7" for minutes), completes the part.
    if (text.length >= 2 || n * 10 > hi) {
      setTyping(undefined);
      focusNext(segment, 1);
    } else {
      setTyping({ segment, text });
    }
  };

  const display = (segment: Segment) => {
    if (typing?.segment === segment) return typing.text;
    if (segment === 'period') return periods[Number(pm)];
    if (segment === 'hour') return h12 ? String(to12(clock.hour)) : pad(clock.hour);
    return pad(clock.minute);
  };

  // Clicking the well's empty space — or tapping anywhere on touch — opens the clock face.
  const onWellPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    const onSegment = target.closest('[role="spinbutton"]');
    if (onSegment && event.pointerType !== 'touch') return;
    event.preventDefault();
    setOpen(true);
  };

  const segmentLabels: Record<Segment, string> = {
    hour: 'Hour',
    minute: 'Minute',
    period: `${periods[0]}/${periods[1]}`,
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        {/* The well is a pointer convenience; keyboard users reach each part and the button directly. */}
        <div
          id={field.id}
          role="group"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : (ariaLabelledBy ?? labelId)}
          aria-describedby={field['aria-describedby']}
          data-size={size}
          data-invalid={invalid || undefined}
          data-disabled={disabled || undefined}
          data-open={open || undefined}
          className={cx(inputStyles.well, styles.well, className)}
          onPointerDown={onWellPointerDown}
        >
          <span className={styles.segments}>
            {segments.map((segment, i) => {
              const [lo, hi] = range(segment);
              const text = display(segment);
              return (
                <span key={segment} className={styles.segmentWrap}>
                  {segment === 'minute' && (
                    <span className={styles.colon} aria-hidden>
                      :
                    </span>
                  )}
                  <span
                    ref={(node) => {
                      refs.current[segment] = node;
                    }}
                    role="spinbutton"
                    tabIndex={disabled ? -1 : 0}
                    aria-label={segmentLabels[segment]}
                    aria-valuenow={current(segment)}
                    aria-valuemin={lo}
                    aria-valuemax={hi}
                    aria-valuetext={segment === 'period' ? periods[Number(pm)] : text}
                    aria-disabled={disabled || undefined}
                    aria-invalid={field['aria-invalid']}
                    inputMode={segment === 'period' ? undefined : 'numeric'}
                    data-segment={segment}
                    data-typing={typing?.segment === segment || undefined}
                    data-first={i === 0 || undefined}
                    className={styles.segment}
                    onKeyDown={disabled ? undefined : onSegmentKeyDown(segment)}
                    onBlur={() => setTyping((t) => (t?.segment === segment ? undefined : t))}
                  >
                    {text}
                  </span>
                </span>
              );
            })}
          </span>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={styles.trigger}
              aria-label="Choose a time"
              disabled={disabled}
            >
              <Clock3 aria-hidden />
            </button>
          </Popover.Trigger>
        </div>
      </Popover.Anchor>
      <Popover.Content
        padding="none"
        align="start"
        sideOffset={6}
        className={styles.content}
        aria-label="Choose a time"
        onOpenAutoFocus={(event) => {
          // Start on the current hour rather than the first control in the panel.
          const chip = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
            '[data-chip][data-state="on"]',
          );
          if (chip) {
            event.preventDefault();
            chip.focus();
          }
        }}
      >
        <ClockFace
          clock={clock}
          h12={h12}
          periods={periods}
          minuteStep={minuteStep}
          presets={presets}
          locale={locale}
          onChange={set}
          onDone={() => {
            clearTimeout(closeTimer.current);
            closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
          }}
        />
      </Popover.Content>
    </Popover.Root>
  );
}

interface ClockFaceProps {
  clock: Clock;
  h12: boolean;
  periods: [string, string];
  minuteStep: number;
  presets?: TimePreset[];
  locale?: string;
  onChange: (clock: Clock) => void;
  onDone: () => void;
}

function ClockFace({
  clock,
  h12,
  periods,
  minuteStep,
  presets,
  locale,
  onChange,
  onDone,
}: ClockFaceProps) {
  const id = useId();
  const minutesRef = useRef<HTMLDivElement>(null);
  const pm = clock.hour >= 12;
  const hours = h12
    ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    : Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);
  const hourValue = String(h12 ? to12(clock.hour) : clock.hour);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: h12 ? 'h12' : 'h23',
        timeZone: 'UTC',
      }),
    [locale, h12],
  );
  const hourFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        hourCycle: h12 ? 'h12' : 'h23',
        timeZone: 'UTC',
      }),
    [locale, h12],
  );
  const spoken = (c: Clock) => formatter.format(Date.UTC(2020, 0, 1, c.hour, c.minute));
  const spokenHour = (hour: number) => hourFormatter.format(Date.UTC(2020, 0, 1, hour));

  const focusMinutes = () => {
    const group = minutesRef.current;
    const target =
      group?.querySelector<HTMLElement>('[data-state="on"]') ??
      group?.querySelector<HTMLElement>('button');
    target?.focus();
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className={styles.face}>
        <section className={styles.column} aria-labelledby={`${id}-h`}>
          <div className={styles.columnHead}>
            <span id={`${id}-h`} className={styles.columnLabel}>
              Hour
            </span>
            {h12 && (
              <SegmentedControl
                size="sm"
                aria-label="Morning or afternoon"
                value={pm ? 'pm' : 'am'}
                onValueChange={(next) =>
                  onChange({ ...clock, hour: (clock.hour % 12) + (next === 'pm' ? 12 : 0) })
                }
              >
                <SegmentedControl.Item value="am">{periods[0]}</SegmentedControl.Item>
                <SegmentedControl.Item value="pm">{periods[1]}</SegmentedControl.Item>
              </SegmentedControl>
            )}
          </div>
          <ToggleGroup.Root
            type="single"
            value={hourValue}
            aria-labelledby={`${id}-h`}
            className={styles.chips}
            data-cols={h12 ? 4 : 6}
          >
            {hours.map((h) => {
              const hour = h12 ? from12(h, pm) : h;
              return (
                <Chip
                  key={h}
                  value={String(h)}
                  active={String(h) === hourValue}
                  pill={`${id}-hour`}
                  label={spokenHour(hour)}
                  onPick={() => {
                    onChange({ ...clock, hour });
                    focusMinutes();
                  }}
                >
                  {h12 ? h : pad(h)}
                </Chip>
              );
            })}
          </ToggleGroup.Root>
        </section>

        <span className={styles.divider} aria-hidden />

        <section className={styles.column} aria-labelledby={`${id}-m`}>
          <div className={styles.columnHead}>
            <span id={`${id}-m`} className={styles.columnLabel}>
              Minute
            </span>
          </div>
          <ToggleGroup.Root
            ref={minutesRef}
            type="single"
            value={String(clock.minute)}
            aria-labelledby={`${id}-m`}
            className={styles.chips}
            data-cols={minutes.length > 6 ? 4 : 2}
          >
            {minutes.map((m) => (
              <Chip
                key={m}
                value={String(m)}
                active={m === clock.minute}
                pill={`${id}-minute`}
                label={spoken({ hour: clock.hour, minute: m })}
                onPick={() => {
                  onChange({ ...clock, minute: m });
                  onDone();
                }}
              >
                {pad(m)}
              </Chip>
            ))}
          </ToggleGroup.Root>
        </section>
      </div>

      {presets && presets.length > 0 && (
        <div className={styles.presets} role="group" aria-label="Suggested times">
          {presets.map((preset) => {
            const c = parseTime(preset.value);
            const on = c.hour === clock.hour && c.minute === clock.minute;
            return (
              <button
                key={preset.value}
                type="button"
                className={styles.preset}
                aria-pressed={on}
                data-on={on || undefined}
                onClick={() => {
                  onChange(c);
                  onDone();
                }}
              >
                <span>{preset.label}</span>
                <span className={styles.presetTime}>{spoken(c)}</span>
              </button>
            );
          })}
        </div>
      )}
    </MotionConfig>
  );
}

function Chip({
  value,
  active,
  pill,
  label,
  onPick,
  children,
}: {
  value: string;
  active: boolean;
  pill: string;
  label: string;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <ToggleGroup.Item
      value={value}
      aria-label={label}
      className={styles.chip}
      data-chip=""
      onClick={onPick}
    >
      {active && (
        <motion.span
          layoutId={pill}
          className={styles.pill}
          transition={springs.snappy}
          aria-hidden
        />
      )}
      <span className={styles.chipText}>{children}</span>
    </ToggleGroup.Item>
  );
}
