import { Check, X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import { deviceIcons, type Device } from './DeviceList';
import styles from './Security.module.css';

export interface DeviceRequestItem {
  /** "K7M-Q2X", as the waiting device shows it. */
  code: string;
  /** "Safari on iPhone". */
  device: string;
  kind: Device['kind'];
  /** "from 100.64.0.7 · with your password · 1 minute ago". */
  meta: string;
  /** Turned down; it can still be approved while it lasts. */
  rejected?: boolean;
}

export interface DeviceRequestsProps extends Omit<ComponentProps<'ul'>, 'children'> {
  requests: DeviceRequestItem[];
  /**
   * This is the computer running Conch, so devices can be approved here.
   * Elsewhere the list shows the command to run there instead.
   */
  canApprove: boolean;
  onApprove?: (request: DeviceRequestItem) => void;
  onReject?: (request: DeviceRequestItem) => void;
  /** The code being approved or turned down right now. */
  busy?: string;
  commandFor?: (code: string) => string;
}

/**
 * Devices that signed in with the right password or key and are waiting for
 * the person's OK. Each shows the same code its screen does, so the right one
 * gets approved. Turning one down is always possible; approving is only on
 * the computer running Conch (or in its terminal), so a stolen session can't
 * let anyone else in.
 */
export function DeviceRequests({
  requests,
  canApprove,
  onApprove,
  onReject,
  busy,
  commandFor = (code) => `pnpm conch devices approve ${code}`,
  className,
  ...props
}: DeviceRequestsProps) {
  return (
    <ul
      aria-label="Waiting for your approval"
      className={cx(styles.requests, className)}
      {...props}
    >
      {requests.map((request) => (
        <li
          key={request.code}
          className={styles.request}
          data-rejected={request.rejected ? '' : undefined}
        >
          <div className={styles.requestMain}>
            <span className={styles.deviceIcon} aria-hidden>
              {deviceIcons[request.kind]}
            </span>
            <div className={styles.deviceBody}>
              <p className={styles.deviceName}>
                {request.device}
                <span className={styles.requestCode} aria-label={`code ${request.code}`}>
                  {request.code}
                </span>
                {request.rejected && (
                  <Badge size="sm" variant="soft">
                    Turned down
                  </Badge>
                )}
              </p>
              <p className={styles.deviceMeta}>{request.meta}</p>
            </div>
            <div className={styles.deviceActions}>
              {canApprove && onApprove && (
                <Button
                  size="sm"
                  variant={request.rejected ? 'surface' : 'solid'}
                  leadingIcon={<Check />}
                  loading={busy === request.code}
                  onClick={() => onApprove(request)}
                  aria-label={`Approve ${request.device} (${request.code})`}
                >
                  {request.rejected ? 'Approve anyway' : 'Approve'}
                </Button>
              )}
              {onReject && !request.rejected && (
                <Button
                  size="sm"
                  variant="ghost"
                  tone="danger"
                  leadingIcon={<X />}
                  onClick={() => onReject(request)}
                  aria-label={`Turn down ${request.device} (${request.code})`}
                >
                  Turn down
                </Button>
              )}
            </div>
          </div>
          {!canApprove && !request.rejected && (
            <div className={styles.requestHint}>
              <span>Approve it on the computer running Conch:</span>
              <div className={styles.requestCommand}>
                <code>{commandFor(request.code)}</code>
                <CopyButton value={commandFor(request.code)} label="Copy command" />
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
