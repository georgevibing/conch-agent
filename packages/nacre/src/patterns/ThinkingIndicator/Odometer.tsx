import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import { usePrefersReducedMotion } from '../../utils/useMediaQuery';
import styles from './Odometer.module.css';

export interface OdometerProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** What it shows, already worded: "41,240", "1m 04s". */
  value: string;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * A number on wheels: each digit is a strip of 0–9 that turns to its value,
 * so a count that climbs spins its last wheels and settles the rest, the way
 * an odometer does. Wheels are counted from the right, so the units stay put
 * when the number grows a digit. Decorative motion: give it words for
 * assistive tech nearby.
 */
export function Odometer({ value, className, ...props }: OdometerProps) {
  const chars = [...value];
  return (
    <span className={cx(styles.odometer, className)} data-value={value} {...props}>
      {chars.map((ch, i) => {
        const fromRight = chars.length - i;
        const digit = DIGITS.indexOf(ch);
        return digit < 0 ? (
          <span key={`c${fromRight}:${ch}`} className={styles.char}>
            {ch}
          </span>
        ) : (
          <span key={`d${fromRight}`} className={styles.wheel} aria-hidden>
            <span className={styles.strip} style={{ '--odo-digit': digit } as CSSProperties}>
              {DIGITS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
            {/* Holds the wheel's width, and is what's copied. */}
            <span className={styles.sizer}>{ch}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * A count that climbs to its new value instead of jumping there: quick at
 * first, settling softly. A smaller value (a new turn) shows at once, and so
 * does everything with reduced motion.
 */
export function useCountUp(target: number, duration = 900): number {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(target);
  const at = useRef(target);
  useEffect(() => {
    if (reduced || target <= at.current) {
      at.current = target;
      return;
    }
    const origin = at.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / duration);
      at.current = Math.round(origin + (target - origin) * (1 - (1 - t) ** 3));
      setShown(at.current);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduced]);
  return reduced ? target : Math.min(shown, target);
}
