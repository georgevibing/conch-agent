import { Bell, BellOff, Laptop, Smartphone, Tablet, TerminalSquare, Trash2 } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './Security.module.css';

export interface Device {
  id: string;
  /** e.g. "Safari on iPhone". */
  name: string;
  kind: 'desktop' | 'phone' | 'tablet' | 'other';
  /** e.g. "Signed in with a password · active 2 minutes ago". */
  meta: string;
  current?: boolean;
  /** Signed in now (default). A remembered device that isn't can still be removed. */
  signedIn?: boolean;
  /** Not used for a long while: worth removing. */
  stale?: boolean;
  /** It gets Conch's notifications (Settings → Notifications on that device). */
  notified?: boolean;
}

export interface DeviceListProps extends Omit<ComponentProps<'ul'>, 'children'> {
  devices: Device[];
  onSignOut?: (device: Device) => void;
  /** Forget a device (signing it out); with approval on, it has to be approved again. */
  onRemove?: (device: Device) => void;
  /** Stop a device's notifications, leaving it signed in. Shown for devices that get them. */
  onStopNotifications?: (device: Device) => void;
  /** Label for the current device's action. */
  currentActionLabel?: string;
  empty?: ReactNode;
  /** The list's accessible name. */
  label?: string;
}

export const deviceIcons: Record<Device['kind'], ReactNode> = {
  desktop: <Laptop />,
  phone: <Smartphone />,
  tablet: <Tablet />,
  other: <TerminalSquare />,
};

/**
 * Devices, this one first, each with a one-click sign out (and, when given,
 * remove). A bell beside a name says it gets notifications, with a way to
 * stop them that leaves it signed in.
 */
export function DeviceList({
  devices,
  onSignOut,
  onRemove,
  onStopNotifications,
  currentActionLabel = 'Sign out',
  empty = 'No devices are signed in.',
  label = 'Signed-in devices',
  className,
  ...props
}: DeviceListProps) {
  if (!devices.length) return <p className={styles.devicesEmpty}>{empty}</p>;
  const sorted = [...devices].sort(
    (a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)),
  );
  return (
    <ul aria-label={label} className={cx(styles.devices, className)} {...props}>
      {sorted.map((device) => {
        const signedIn = device.signedIn ?? true;
        return (
          <li key={device.id} className={styles.device} data-signed-out={signedIn ? undefined : ''}>
            <span className={styles.deviceIcon} aria-hidden>
              {deviceIcons[device.kind]}
            </span>
            <div className={styles.deviceBody}>
              <p className={styles.deviceName}>
                {device.name}
                {device.current && (
                  <Badge size="sm" tone="accent" variant="soft">
                    This device
                  </Badge>
                )}
                {device.notified && (
                  <span className={styles.deviceNotified} title="Gets notifications">
                    <Bell aria-hidden />
                    <span className={styles.srOnly}>Gets notifications</span>
                  </span>
                )}
                {device.stale && (
                  <Badge size="sm" tone="warning" variant="soft">
                    Not used in 90 days
                  </Badge>
                )}
              </p>
              <p className={styles.deviceMeta}>{device.meta}</p>
            </div>
            <div className={styles.deviceActions}>
              {onStopNotifications && device.notified && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Stop notifications on ${device.name}`}
                  onClick={() => onStopNotifications(device)}
                >
                  <BellOff />
                </IconButton>
              )}
              {onSignOut && signedIn && (
                <Button
                  size="sm"
                  variant="ghost"
                  tone={device.current ? 'neutral' : 'danger'}
                  onClick={() => onSignOut(device)}
                  aria-label={`${device.current ? currentActionLabel : 'Sign out'} ${device.name}`}
                >
                  {device.current ? currentActionLabel : 'Sign out'}
                </Button>
              )}
              {onRemove && !device.current && (
                <IconButton
                  size="sm"
                  tone="danger"
                  label={`Remove ${device.name}`}
                  onClick={() => onRemove(device)}
                >
                  <Trash2 />
                </IconButton>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
