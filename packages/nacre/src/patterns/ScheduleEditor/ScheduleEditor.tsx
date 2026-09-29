import { CalendarClock, Globe } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';

import { Callout } from '../../components/Callout';
import { DatePicker } from '../../components/DatePicker';
import { Input } from '../../components/Input';
import { NumberField } from '../../components/NumberField';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Select } from '../../components/Select';
import { Skeleton } from '../../components/Skeleton';
import { TimePicker, type TimePreset } from '../../components/TimePicker';
import { cx } from '../../utils/cx';
import { formatWhen } from '../Routines/time';
import {
  WEEKDAY_NAMES,
  WEEKDAYS,
  type SchedulePreviewValue,
  type ScheduleValue,
  type Weekday,
} from '../Routines/types';
import { fromZonedIso, toZonedIso, zonedDate } from '../Routines/zoned';
import styles from './ScheduleEditor.module.css';

/** The friendly "repeats" choices; `weekdays` is a preset of `weekly`. */
export type RepeatKind = 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'interval' | 'cron';

const repeatLabels: Record<RepeatKind, string> = {
  once: 'Once',
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
  interval: 'Every few hours',
  cron: 'Custom',
};

const WORKWEEK: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const MIN_INTERVAL_MINUTES = 15;
const DEFAULT_TIME = '09:00';
const MAX_EVERY = { minutes: 1440, hours: 168 } as const;

const timePresets: TimePreset[] = [
  { label: 'Morning', value: '08:00' },
  { label: 'Midday', value: '12:00' },
  { label: 'Evening', value: '18:00' },
];

export function repeatKindOf(value: ScheduleValue): RepeatKind {
  if (value.type === 'weekly') {
    const sorted = [...value.days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
    if (sorted.join() === WORKWEEK.join()) return 'weekdays';
  }
  return value.type;
}

function timeOf(value: ScheduleValue, timeZone: string): string {
  if ('time' in value) return value.time;
  if (value.type === 'once') return fromZonedIso(value.at, timeZone).time || DEFAULT_TIME;
  return DEFAULT_TIME;
}

/** Switch repeat kind, keeping whatever the user already chose (time, days) where it makes sense. */
export function convertSchedule(
  value: ScheduleValue,
  kind: RepeatKind,
  timeZone: string,
): ScheduleValue {
  const time = timeOf(value, timeZone);
  switch (kind) {
    case 'once':
      return { type: 'once', at: toZonedIso(zonedDate(timeZone, 1), time, timeZone) };
    case 'daily':
      return { type: 'daily', time };
    case 'weekdays':
      return { type: 'weekly', days: [...WORKWEEK], time };
    case 'weekly': {
      const days =
        value.type === 'weekly' && repeatKindOf(value) !== 'weekdays'
          ? value.days
          : (['mon'] as Weekday[]);
      return { type: 'weekly', days, time };
    }
    case 'monthly':
      return { type: 'monthly', day: 1, time };
    case 'interval':
      return { type: 'interval', every: 2, unit: 'hours' };
    case 'cron': {
      const [h = '9', m = '0'] = time.split(':').map((part) => String(Number(part)));
      return { type: 'cron', expression: `${m} ${h} * * *` };
    }
  }
}

const cronExamples = [
  { label: 'Weekdays at 9', expression: '0 9 * * 1-5' },
  { label: 'Every 3 hours', expression: '0 */3 * * *' },
  { label: '1st of the month', expression: '0 8 1 * *' },
];

export interface ScheduleEditorProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  /** IANA timezone the schedule is expressed in. */
  timezone: string;
  /** Server-computed description and upcoming runs for `value`. */
  preview?: SchedulePreviewValue;
  loading?: boolean;
  /** Label for the whole control. */
  label?: string;
}

/**
 * "When should it run?" — a friendly schedule builder. Everyday choices are
 * plain controls; a Custom option accepts a cron expression for power users.
 * The preview underneath always says, in words, exactly what will happen.
 */
export function ScheduleEditor({
  value,
  onChange,
  timezone,
  preview,
  loading,
  label = 'When should it run?',
  className,
  ...props
}: ScheduleEditorProps) {
  const id = useId();
  const kind = repeatKindOf(value);
  const [hint, setHint] = useState<string>();

  const setTime = (time: string) => {
    if (!time) return;
    if (value.type === 'once') {
      const { date } = fromZonedIso(value.at, timezone);
      onChange({ type: 'once', at: toZonedIso(date || zonedDate(timezone, 1), time, timezone) });
    } else if ('time' in value) {
      onChange({ ...value, time });
    }
  };

  const toggleDay = (day: Weekday) => {
    if (value.type !== 'weekly') return;
    const on = value.days.includes(day);
    if (on && value.days.length === 1) {
      setHint('Pick at least one day.');
      return;
    }
    setHint(undefined);
    const days = on ? value.days.filter((d) => d !== day) : [...value.days, day];
    onChange({ ...value, days: WEEKDAYS.filter((d) => days.includes(d)) });
  };

  const setInterval = (every: number, unit: 'minutes' | 'hours') => {
    const minimum = unit === 'minutes' ? MIN_INTERVAL_MINUTES : 1;
    onChange({
      type: 'interval',
      every: Math.min(Math.max(every, minimum), MAX_EVERY[unit]),
      unit,
    });
  };

  const repeatId = `${id}-repeat`;
  const atMinimum =
    value.type === 'interval' && value.unit === 'minutes' && value.every <= MIN_INTERVAL_MINUTES;
  const timeValue = timeOf(value, timezone);

  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      className={cx(styles.editor, className)}
      {...props}
    >
      <div className={styles.head}>
        <CalendarClock aria-hidden className={styles.headIcon} />
        <span id={`${id}-label`} className={styles.label}>
          {label}
        </span>
      </div>

      <div className={styles.grid}>
        <div className={styles.field}>
          <label htmlFor={repeatId} className={styles.fieldLabel}>
            Repeats
          </label>
          <Select
            id={repeatId}
            value={kind}
            onValueChange={(next) => {
              setHint(undefined);
              onChange(convertSchedule(value, next as RepeatKind, timezone));
            }}
          >
            {(Object.keys(repeatLabels) as RepeatKind[]).map((k) => (
              <Select.Item key={k} value={k}>
                {repeatLabels[k]}
              </Select.Item>
            ))}
          </Select>
        </div>

        {value.type === 'once' && (
          <div className={styles.field}>
            <label htmlFor={`${id}-date`} className={styles.fieldLabel}>
              Date
            </label>
            <DatePicker
              id={`${id}-date`}
              value={fromZonedIso(value.at, timezone).date}
              min={zonedDate(timezone)}
              today={zonedDate(timezone)}
              onValueChange={(date) =>
                onChange({ type: 'once', at: toZonedIso(date, timeValue, timezone) })
              }
            />
          </div>
        )}

        {value.type === 'monthly' && (
          <div className={styles.field}>
            <label htmlFor={`${id}-day`} className={styles.fieldLabel}>
              On
            </label>
            <Select
              id={`${id}-day`}
              value={String(value.day)}
              onValueChange={(day) =>
                onChange({ ...value, day: day === 'last' ? 'last' : Number(day) })
              }
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <Select.Item key={d} value={String(d)}>
                  {ordinal(d)}
                </Select.Item>
              ))}
              <Select.Separator />
              <Select.Item value="last">Last day of the month</Select.Item>
            </Select>
          </div>
        )}

        {'time' in value || value.type === 'once' ? (
          <div className={styles.field}>
            <span id={`${id}-time-label`} className={styles.fieldLabel}>
              At
            </span>
            <TimePicker
              id={`${id}-time`}
              aria-labelledby={`${id}-time-label`}
              value={timeValue}
              onValueChange={setTime}
              presets={timePresets}
            />
          </div>
        ) : null}

        {value.type === 'interval' && (
          <div className={cx(styles.field, styles.wide)}>
            <label className={styles.fieldLabel} htmlFor={`${id}-every`}>
              Every
            </label>
            <div className={styles.stepper}>
              <NumberField
                id={`${id}-every`}
                aria-describedby={atMinimum ? `${id}-every-note` : undefined}
                value={value.every}
                min={value.unit === 'minutes' ? MIN_INTERVAL_MINUTES : 1}
                max={MAX_EVERY[value.unit]}
                step={value.unit === 'minutes' ? 5 : 1}
                decrementLabel="Less often"
                incrementLabel="More often"
                onValueChange={(every) => setInterval(every, value.unit)}
                rootClassName={styles.count}
              />
              <SegmentedControl
                aria-label="Unit"
                value={value.unit}
                onValueChange={(unit) =>
                  setInterval(
                    unit === 'minutes' ? Math.max(value.every, MIN_INTERVAL_MINUTES) : value.every,
                    unit as 'minutes' | 'hours',
                  )
                }
              >
                <SegmentedControl.Item value="minutes">minutes</SegmentedControl.Item>
                <SegmentedControl.Item value="hours">hours</SegmentedControl.Item>
              </SegmentedControl>
            </div>
            {atMinimum && (
              <p id={`${id}-every-note`} className={styles.note}>
                Every {MIN_INTERVAL_MINUTES} minutes is the most often a routine can run.
              </p>
            )}
          </div>
        )}
      </div>

      {value.type === 'weekly' && kind === 'weekly' && (
        <div className={styles.days} role="group" aria-label="Days">
          {WEEKDAYS.map((day) => {
            const on = value.days.includes(day);
            return (
              <button
                key={day}
                type="button"
                className={styles.day}
                aria-pressed={on}
                aria-label={WEEKDAY_NAMES[day]}
                data-on={on || undefined}
                onClick={() => toggleDay(day)}
              >
                {WEEKDAY_NAMES[day].slice(0, 1)}
              </button>
            );
          })}
        </div>
      )}

      {value.type === 'monthly' && typeof value.day === 'number' && value.day >= 29 && (
        <p className={styles.note}>Months without a {ordinal(value.day)} are skipped.</p>
      )}

      {value.type === 'cron' && (
        <div className={styles.cron}>
          <Input
            aria-label="Cron expression"
            value={value.expression}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange({ type: 'cron', expression: e.target.value })}
            rootClassName={styles.cronInput}
            invalid={preview ? !preview.valid : undefined}
          />
          <p className={styles.note}>
            <span className={styles.mono}>minute hour day month weekday</span> — try{' '}
            {cronExamples.map((ex, i) => (
              <span key={ex.expression}>
                {i > 0 && ', '}
                <button
                  type="button"
                  className={styles.example}
                  onClick={() => onChange({ type: 'cron', expression: ex.expression })}
                >
                  {ex.label}
                </button>
              </span>
            ))}
            .
          </p>
        </div>
      )}

      {hint && (
        <p className={styles.hint} role="status">
          {hint}
        </p>
      )}

      <SchedulePreview preview={preview} loading={loading} timezone={timezone} />
    </div>
  );
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  const suffix =
    rem100 >= 11 && rem100 <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** The plain-language answer to "so when will it actually run?". */
export function SchedulePreview({
  preview,
  loading,
  timezone,
}: {
  preview?: SchedulePreviewValue;
  loading?: boolean;
  timezone: string;
}) {
  if (loading && !preview) {
    return (
      <div className={styles.preview} aria-busy>
        <Skeleton width="60%" />
        <Skeleton lines={3} width="40%" />
      </div>
    );
  }
  if (!preview) return null;
  if (!preview.valid) {
    return (
      <Callout
        tone="danger"
        title="That schedule doesn’t work"
        live="polite"
        className={styles.callout}
      >
        {preview.error ?? 'Check the schedule and try again.'}
      </Callout>
    );
  }
  return (
    <div className={styles.preview} aria-live="polite" data-loading={loading || undefined}>
      <p className={styles.previewText}>{preview.text}</p>
      {preview.next.length > 0 && (
        <div className={styles.next}>
          <span className={styles.nextLabel}>
            {preview.next.length === 1 ? 'Runs' : 'Next runs'}
          </span>
          <ol className={styles.nextList}>
            {preview.next.slice(0, 3).map((ts) => (
              <li key={ts}>{formatWhen(ts, { timeZone: timezone })}</li>
            ))}
          </ol>
        </div>
      )}
      <p className={styles.zone}>
        <Globe aria-hidden />
        {timezone.replaceAll('_', ' ')}
      </p>
      {preview.perDay !== undefined && preview.perDay > 24 && (
        <Callout tone="warning" className={styles.callout}>
          This runs about {Math.round(preview.perDay)} times a day and could use a lot of your plan.
        </Callout>
      )}
    </div>
  );
}
