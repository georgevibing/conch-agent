import { FoldVertical } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { Popover } from '../../components/Popover';
import { Progress } from '../../components/Progress';
import { cx } from '../../utils/cx';
import { ComposerChip } from '../Composer';
import { UsageRing } from '../Usage';
import type { UsageSeverity } from '../Usage/types';
import styles from './ContextMeter.module.css';

/** A token count the way a person says it: 950, 1.2k, 30k, 1.2M. */
export function tokensShort(count: number): string {
  const n = Math.max(0, Math.round(count));
  if (n < 1_000) return String(n);
  const [value, unit] = n < 1_000_000 ? [n / 1_000, 'k'] : [n / 1_000_000, 'M'];
  const shown = value < 10 ? Math.floor(value * 10) / 10 : Math.round(value);
  return `${shown}${unit}`;
}

/** How full, as a whole percent; undefined when there's no window to measure against. */
export function fillOf(used?: number, window?: number): number | undefined {
  if (used === undefined || !window) return undefined;
  return Math.min(100, Math.max(0, Math.round((used / window) * 100)));
}

const severityOf = (percent: number): UsageSeverity =>
  percent >= 90 ? 'critical' : percent >= 75 ? 'warning' : 'normal';

export interface ContextMeterProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** How much the model reads each time now: the chat, its instructions and tools. */
  used?: number;
  /** How much it can read before older messages are summarised. */
  window?: number;
  /** What the running turn has used so far, all its requests together. */
  working?: number;
  /** Of that, what it wrote; the rest it read (mostly the chat again, from cache). */
  written?: number;
  /** A turn is running: the chip counts its tokens as they go. */
  running?: boolean;
  /** Summarise older messages now. Absent: compacting isn't offered here. */
  onCompact?: () => void;
  compacting?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * How full the chat's context is, beside the mode picker: a small ring that
 * fills as the chat grows and the share in words. While a turn runs, the chip
 * counts what it has used, quietly ticking up ("30k", "1.2M"). It opens to the
 * detail, and to **Compact now**, which summarises older messages to make room.
 */
export function ContextMeter({
  used,
  window,
  working,
  written,
  running = false,
  onCompact,
  compacting = false,
  open,
  onOpenChange,
  className,
  ...props
}: ContextMeterProps) {
  const percent = fillOf(used, window);
  const counting = running && working !== undefined && working > 0;
  if (used === undefined && !counting) return null;
  // How full stays the chip's word while a message runs (the live tally is in the
  // working line); it counts only when there's no window to measure against.
  const label =
    percent !== undefined
      ? `${percent}%`
      : counting
        ? tokensShort(working)
        : tokensShort(used ?? 0);
  const severity = percent === undefined ? 'normal' : severityOf(percent);
  const said = [
    percent !== undefined
      ? `Context ${percent}% full`
      : used !== undefined
        ? `Context: ${tokensShort(used)} tokens`
        : undefined,
    counting ? `this message has used ${tokensShort(working)} tokens so far` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <ComposerChip
          icon={
            <UsageRing
              size={14}
              percentLeft={percent === undefined ? undefined : 100 - percent}
              severity={severity}
            />
          }
          data-counting={(counting && percent === undefined) || undefined}
          data-severity={percent === undefined ? undefined : severity}
          className={cx(styles.chip, className)}
          aria-label={`${said}. Details`}
          {...props}
        >
          {/* Keyed by what it counts, so a new number settles in softly. */}
          <span
            key={counting && percent === undefined ? 'working' : 'fill'}
            className={styles.count}
          >
            {label}
          </span>
        </ComposerChip>
      </Popover.Trigger>
      <Popover.Content side="top" align="start" className={styles.panel} aria-label="Context">
        <div className={styles.body}>
          <div className={styles.head}>
            <p className={styles.title}>Context</p>
            {percent !== undefined && <span className={styles.share}>{percent}% full</span>}
          </div>
          {percent !== undefined && (
            <Progress
              size="sm"
              value={percent}
              tone={severity === 'critical' ? 'danger' : 'accent'}
              aria-label={`Context ${percent}% full`}
            />
          )}
          {used !== undefined && (
            <p className={styles.line}>
              {window
                ? `${tokensShort(used)} of ${tokensShort(window)} tokens`
                : `${tokensShort(used)} tokens`}
            </p>
          )}
          <p className={styles.note}>
            What the model reads each time: this chat, its instructions and tools. When it fills,
            older messages are summarised so the chat can go on.
          </p>
          {counting && (
            <p className={styles.line}>
              {written !== undefined && written <= working ? (
                <>
                  This message so far: wrote <strong>{tokensShort(written)}</strong>, read{' '}
                  <strong>{tokensShort(working - written)}</strong> tokens (mostly this chat again,
                  each step)
                </>
              ) : (
                <>
                  This message so far: <strong>{tokensShort(working)} tokens</strong>
                </>
              )}
            </p>
          )}
          {onCompact && (
            <div className={styles.compact}>
              <Button
                size="sm"
                variant="surface"
                leadingIcon={<FoldVertical />}
                loading={compacting}
                disabled={running}
                onClick={onCompact}
              >
                Compact now
              </Button>
              <span className={styles.hint}>
                {running ? 'Once this message is done.' : 'Or type /compact.'}
              </span>
            </div>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
