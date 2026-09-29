import { useMemo, type ComponentProps } from 'react';
import { encode } from 'uqr';

import { cx } from '../../utils/cx';
import styles from './QRCode.module.css';

export interface QRCodeProps extends Omit<ComponentProps<'svg'>, 'children'> {
  /** Text or URL to encode. */
  value: string;
  /** Rendered size in px. */
  size?: number;
  /** What the code is for, read by screen readers. */
  label: string;
}

/**
 * A crisp, theme-independent QR code. Always dark on light (with a quiet
 * zone) because that's what phone cameras read best — even in dark mode.
 */
export function QRCode({ value, size = 200, label, className, ...props }: QRCodeProps) {
  const { path, dimension } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, dimension: qr.size };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${dimension} ${dimension}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cx(styles.qr, className)}
      {...props}
    >
      <rect width={dimension} height={dimension} className={styles.paper} />
      <path d={path} className={styles.ink} />
    </svg>
  );
}
