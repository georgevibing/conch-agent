import { Bell, BellOff, BellRing, Smartphone } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import styles from './Notifications.module.css';

/**
 * - `on`: this device is told when something needs you.
 * - `off`: it could be; one switch.
 * - `install`: on an iPhone or iPad, notifications come once Conch is on the
 *   Home Screen (`AddToHomeScreen` says how).
 * - `blocked`: the browser was told no; only its settings can undo that.
 * - `unsupported`: this browser can't (or the address isn't https).
 */
export type NotifyState = 'on' | 'off' | 'install' | 'blocked' | 'unsupported';

export interface NotifyThisDeviceProps extends Omit<
  ComponentProps<'section'>,
  'title' | 'onChange'
> {
  state: NotifyState;
  /** Turning on or off right now. */
  busy?: boolean;
  onChange?: (on: boolean) => void;
  /** Send one now, to see it arrive. */
  onTest?: () => void;
  testing?: boolean;
  /** Why it can't, or what to do in the browser's settings, in a sentence. */
  detail?: ReactNode;
  /** Under the card: the steps to install, or the device's choices. */
  children?: ReactNode;
}

const TITLES: Record<NotifyState, string> = {
  on: 'This device is told when something needs you',
  off: 'Get notifications on this device',
  install: 'Add Conch to your Home Screen first',
  blocked: 'Notifications are blocked for Conch',
  unsupported: 'This browser can’t show Conch’s notifications',
};

const DETAILS: Record<NotifyState, string> = {
  on: 'When Conch needs your OK, finishes an answer while you’re away, or a routine runs. Never while you’re looking at Conch.',
  off: 'When Conch needs your OK, finishes an answer while you’re away, or a routine runs. Nothing while you’re looking at Conch.',
  install: 'On iPhone and iPad, notifications work for apps on the Home Screen. It takes a moment:',
  blocked:
    'Your browser was told not to let Conch notify you. Allow it in the browser’s settings for this site, then come back.',
  unsupported: 'Try Safari on an iPhone, or Chrome, Edge or Firefox elsewhere.',
};

/**
 * Notifications on this device, at a glance: one switch, and a test. When the
 * device needs something first (the Home Screen on an iPhone, the browser's
 * own permission), it says exactly that, calmly.
 */
export function NotifyThisDevice({
  state,
  busy = false,
  onChange,
  onTest,
  testing,
  detail,
  children,
  className,
  ...props
}: NotifyThisDeviceProps) {
  const titleId = useId();
  const detailId = useId();
  const Icon =
    state === 'on' ? BellRing : state === 'install' ? Smartphone : state === 'off' ? Bell : BellOff;
  const canSwitch = state === 'on' || state === 'off';
  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.card, className)}
      data-state={state}
      {...props}
    >
      <div className={styles.head}>
        <span className={styles.icon} data-state={state} aria-hidden>
          {busy ? <Spinner size="sm" label={null} /> : <Icon />}
        </span>
        <div className={styles.text}>
          <p className={styles.title} id={titleId}>
            {TITLES[state]}
          </p>
          <p className={styles.detail} id={detailId}>
            {detail ?? DETAILS[state]}
          </p>
        </div>
        {canSwitch && onChange && (
          <Switch
            checked={state === 'on'}
            disabled={busy}
            onCheckedChange={onChange}
            aria-label="Notifications on this device"
            aria-describedby={detailId}
          />
        )}
      </div>
      {state === 'on' && onTest && (
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="surface"
            leadingIcon={<BellRing />}
            loading={testing}
            onClick={onTest}
          >
            Send a test
          </Button>
        </div>
      )}
      {children != null && <div className={styles.body}>{children}</div>}
    </section>
  );
}
