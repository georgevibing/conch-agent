import { Laptop, Smartphone, Tablet, TerminalSquare } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
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
}

export interface DeviceListProps extends Omit<ComponentProps<'ul'>, 'children'> {
  devices: Device[];
  onSignOut?: (device: Device) => void;
  /** Label for the current device's action. */
  currentActionLabel?: string;
  empty?: ReactNode;
}

const icons: Record<Device['kind'], ReactNode> = {
  desktop: <Laptop />,
  phone: <Smartphone />,
  tablet: <Tablet />,
  other: <TerminalSquare />,
};

/** Signed-in devices, this one first, each with a one-click sign out. */
export function DeviceList({
  devices,
  onSignOut,
  currentActionLabel = 'Sign out',
  empty = 'No devices are signed in.',
  className,
  ...props
}: DeviceListProps) {
  if (!devices.length) return <p className={styles.devicesEmpty}>{empty}</p>;
  const sorted = [...devices].sort(
    (a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)),
  );
  return (
    <ul aria-label="Signed-in devices" className={cx(styles.devices, className)} {...props}>
      {sorted.map((device) => (
        <li key={device.id} className={styles.device}>
          <span className={styles.deviceIcon} aria-hidden>
            {icons[device.kind]}
          </span>
          <div className={styles.deviceBody}>
            <p className={styles.deviceName}>
              {device.name}
              {device.current && (
                <Badge size="sm" tone="accent" variant="soft">
                  This device
                </Badge>
              )}
            </p>
            <p className={styles.deviceMeta}>{device.meta}</p>
          </div>
          {onSignOut && (
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
        </li>
      ))}
    </ul>
  );
}
