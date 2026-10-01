import { Smartphone, X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './Notifications.module.css';

export interface NotifiedDevice {
  id: string;
  name: string;
  /** "Last told 2 hours ago". */
  detail?: ReactNode;
  /** The last one didn't arrive: one sentence. */
  problem?: ReactNode;
  current?: boolean;
}

export interface NotifiedDevicesProps extends Omit<ComponentProps<'ul'>, 'children'> {
  devices: NotifiedDevice[];
  onRemove?: (id: string) => void;
}

/** The devices Conch tells things to, each with a way to stop it. */
export function NotifiedDevices({ devices, onRemove, className, ...props }: NotifiedDevicesProps) {
  return (
    <ul
      className={cx(styles.list, className)}
      aria-label="Devices that get notifications"
      {...props}
    >
      {devices.map((d) => (
        <li key={d.id} className={styles.row}>
          <span className={styles.rowIcon} aria-hidden>
            <Smartphone />
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowName}>
              {d.name}
              {d.current && (
                <Badge size="sm" variant="soft">
                  This device
                </Badge>
              )}
            </span>
            {d.problem ? (
              <span className={styles.rowProblem}>{d.problem}</span>
            ) : (
              d.detail && <span className={styles.rowDetail}>{d.detail}</span>
            )}
          </span>
          {onRemove && (
            <IconButton
              size="sm"
              variant="ghost"
              label={`Stop notifications on ${d.name}`}
              onClick={() => onRemove(d.id)}
            >
              <X />
            </IconButton>
          )}
        </li>
      ))}
    </ul>
  );
}
