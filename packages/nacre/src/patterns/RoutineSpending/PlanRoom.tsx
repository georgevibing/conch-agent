import { Gauge } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';

import { SegmentedControl } from '../../components/SegmentedControl';
import { Text } from '../../components/Text';
import { cx } from '../../utils/cx';
import styles from './RoutineSpending.module.css';

/** The fullness a person can choose, and “never wait”. */
export const PLAN_ROOM_CHOICES = [70, 80, 90, 95] as const;

export interface PlanRoomPlan {
  /** "Claude Max", "ChatGPT Plus". */
  source: string;
  /** How full its tightest window is now (0–100). */
  usedPercent: number;
  /** When that window resets. */
  resetsAt?: number;
  /** Runs waiting for it to have room. */
  waiting: number;
}

export interface PlanRoomProps extends Omit<ComponentProps<'section'>, 'onChange'> {
  /** How full a plan gets before routines wait; `null`: they never wait. */
  percent: number | null;
  onChange: (percent: number | null) => void;
  /** The plans the routines that are on use, to say what the choice means today. */
  plans?: readonly PlanRoomPlan[];
  /** Conch's own choice, marked as such. */
  defaultPercent?: number;
  disabled?: boolean;
  /** `h2` on a page of its own sections, `h3` inside a settings section. */
  headingLevel?: 2 | 3;
  locale?: string;
  timeZone?: string;
  now?: number;
}

function resetWords(at: number, now: number, locale: string, timeZone?: string): string {
  const soon = at - now < 20 * 3_600_000;
  return soon
    ? `at ${new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(at)}`
    : `on ${new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone }).format(at)}`;
}

/** What the choice means for one plan, right now. */
function planLine(
  plan: PlanRoomPlan,
  percent: number | null,
  now: number,
  locale: string,
  timeZone?: string,
): string {
  const used = `Your ${plan.source} plan is ${Math.round(plan.usedPercent)}% used`;
  if (percent === null || plan.usedPercent < percent) {
    const going = plan.waiting
      ? `, so ${plan.waiting === 1 ? 'the routine waiting for it goes' : `the ${plan.waiting} routines waiting for it go`} now`
      : ', so routines on it run as usual';
    return `${used}${going}.`;
  }
  const until = plan.resetsAt
    ? ` until it resets ${resetWords(plan.resetsAt, now, locale, timeZone)}`
    : '';
  return `${used}, so routines on it wait${until}.`;
}

/**
 * Room for your own chats (ADR 0057): how full a plan you subscribe to may
 * get before routines on it wait for it to reset — or never. One choice, and
 * underneath it, what that choice means for your plans today, as you change it.
 */
export function PlanRoom({
  percent,
  onChange,
  plans = [],
  defaultPercent = 80,
  disabled,
  headingLevel = 2,
  locale = 'en-US',
  timeZone,
  now: nowProp,
  className,
  ...props
}: PlanRoomProps) {
  const id = useId();
  const [mounted] = useState(() => Date.now());
  const now = nowProp ?? mounted;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const lines =
    plans.length > 0
      ? plans.map((plan) => planLine(plan, percent, now, locale, timeZone))
      : [
          percent === null
            ? 'Routines always run, even on a plan that’s nearly used.'
            : `Routines wait once a plan is ${percent}% used, and go when it resets.`,
        ];
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cx(styles.planRoom, className)}
      data-never={percent === null || undefined}
      {...props}
    >
      <div className={styles.planRoomHead}>
        <span className={styles.planRoomIcon} aria-hidden>
          <Gauge />
        </span>
        <div className={styles.planRoomWords}>
          <Heading id={`${id}-title`} className={styles.planRoomTitle}>
            Room for your own chats
          </Heading>
          <Text size="sm" tone="muted" id={`${id}-about`}>
            When a plan you subscribe to is nearly used, routines on it wait until it resets, so
            your own chats don’t run out. Choose when they wait, or let them always run.
          </Text>
        </div>
      </div>
      <SegmentedControl
        size="sm"
        value={percent === null ? 'never' : String(percent)}
        onValueChange={(value) => onChange(value === 'never' ? null : Number(value))}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-now`}
        disabled={disabled}
        className={styles.planRoomChoices}
      >
        {PLAN_ROOM_CHOICES.map((choice) => (
          <SegmentedControl.Item
            key={choice}
            value={String(choice)}
            aria-label={`Wait at ${choice}% used${choice === defaultPercent ? ' (Conch’s choice)' : ''}`}
          >
            {choice}%
          </SegmentedControl.Item>
        ))}
        <SegmentedControl.Item value="never" aria-label="Never wait: always run">
          Never wait
        </SegmentedControl.Item>
      </SegmentedControl>
      <div id={`${id}-now`} className={styles.planRoomNow} aria-live="polite">
        {lines.map((line) => (
          <Text key={line} size="sm">
            {line}
          </Text>
        ))}
        {percent === null && plans.length > 0 && (
          <Text size="xs" tone="subtle">
            Your own chats may run out first. Each run still stops if it does far more than usual.
          </Text>
        )}
      </div>
    </section>
  );
}
