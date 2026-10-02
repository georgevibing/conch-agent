import { ChevronLeft, Laptop } from 'lucide-react';
import type { ComponentProps, CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import styles from './LinkedDevicesSketch.module.css';

export interface LinkedDevicesSketchProps extends Omit<ComponentProps<'figure'>, 'title'> {
  /** What the picture shows, for screen readers ("Linked devices in WhatsApp"). */
  label: string;
  /** The app's colour: the button to press wears it. */
  color?: string;
  /** The screen's title, as the app names it. */
  title?: string;
  /** The button to press: "Link a device". */
  action: string;
  /** Devices already linked; Conch's own once it is. */
  devices?: { name: string; meta: string; isNew?: boolean }[];
  /** The app's own small print under the list. */
  note?: string;
  /** Something is about to happen here: the button calls gently, and the rim orbits. */
  alive?: boolean;
}

/**
 * A phone showing the chat app's **Linked devices** screen, as the person
 * will see it: where to press to show the camera that scans Conch's code,
 * and, once linked, Conch in the list. It sits beside the code while you
 * link WhatsApp or Signal, so "where is that?" always has a picture.
 */
export function LinkedDevicesSketch({
  label,
  color,
  title = 'Linked devices',
  action,
  devices = [],
  note,
  alive,
  className,
  style,
  ...props
}: LinkedDevicesSketchProps) {
  return (
    <figure
      aria-label={label}
      className={cx(styles.phone, className)}
      data-lustre=""
      data-lustre-ambient={alive || undefined}
      style={{ ...(color && { '--ld-brand': color }), ...style } as CSSProperties}
      {...props}
    >
      <div className={styles.screen}>
        <div className={styles.bar} aria-hidden>
          <ChevronLeft size={18} />
          <span className={styles.title}>{title}</span>
        </div>
        <div className={styles.hero} aria-hidden>
          <span className={styles.device}>
            <Laptop size={40} strokeWidth={1.5} />
          </span>
        </div>
        <div className={styles.actionRow}>
          <span className={styles.action} data-alive={alive || undefined}>
            {action}
          </span>
        </div>
        {devices.length > 0 && (
          <div className={styles.list}>
            <span className={styles.listTitle}>Device status</span>
            <ul className={styles.devices}>
              {devices.map((device) => (
                <li key={device.name} className={styles.row} data-new={device.isNew || undefined}>
                  <span className={styles.rowIcon} aria-hidden>
                    <Laptop size={16} />
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{device.name}</span>
                    <span className={styles.rowMeta}>{device.meta}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {note && <p className={styles.note}>{note}</p>}
      </div>
    </figure>
  );
}
