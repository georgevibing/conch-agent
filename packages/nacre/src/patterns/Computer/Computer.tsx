import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { Sparkline, type SparklineProps } from '../../components/LiveChart/Sparkline';
import { MetaList } from '../../components/MetaList';
import { cx } from '../../utils/cx';
import { OsMark, type OsName } from '../Docs/OsMark';
import styles from './Computer.module.css';

export interface ComputerHeaderProps extends Omit<ComponentProps<'header'>, 'title'> {
  /** Its system, for the mark beside its name. `other` shows none. */
  os: OsName | 'other';
  /** What it is: "Apple M3 Pro". */
  name: string;
  /** How it's doing, in two or three words: "Room to spare". */
  status: string;
  /** `busy` and `critical` tint the live dot; the words carry the meaning. */
  tone?: 'calm' | 'busy' | 'critical';
  /** Short facts in a row: "macOS 26.1", "12 cores", "Up 3 days". */
  facts?: readonly ReactNode[];
  /** Whether readings are arriving: the dot breathes while they are. */
  live?: boolean;
  /** The heading level of `status`. Default 2. */
  level?: 2 | 3;
}

/**
 * The top of This computer: its system's mark and name, how it's doing in a
 * few words in the display serif, and a line of facts. A small dot breathes
 * while readings arrive, the only thing that moves here.
 */
export function ComputerHeader({
  os,
  name,
  status,
  tone = 'calm',
  facts = [],
  live = true,
  level = 2,
  className,
  ...props
}: ComputerHeaderProps) {
  const Heading = `h${level}` as const;
  return (
    <header className={cx(styles.header, className)} data-tone={tone} {...props}>
      <span className={styles.name}>
        {os !== 'other' && <OsMark os={os} className={styles.mark} />}
        {name}
        <span className={styles.live} data-live={live || undefined} aria-hidden />
      </span>
      <Heading className={styles.status}>{status}</Heading>
      <MetaList items={facts} className={styles.facts} />
    </header>
  );
}

export interface CoreStripProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Each core, 0–100. */
  values: readonly number[];
}

/**
 * Every core side by side, each a slim column filled as far as it's busy.
 * The fills rise and fall on the soft spring as readings change. One
 * sentence for screen readers: how many, the busiest and the quietest.
 */
export function CoreStrip({ values, className, ...props }: CoreStripProps) {
  const busiest = values.length ? Math.round(Math.max(...values)) : 0;
  const quietest = values.length ? Math.round(Math.min(...values)) : 0;
  return (
    <div
      role="img"
      aria-label={`${values.length} ${values.length === 1 ? 'core' : 'cores'}: the busiest at ${busiest}%, the quietest at ${quietest}%.`}
      className={cx(styles.cores, className)}
      {...props}
    >
      {values.map((value, i) => (
        <span key={i} className={styles.core}>
          <span
            className={styles.coreFill}
            style={{ '--core': Math.min(100, Math.max(0, value)) / 100 } as CSSProperties}
          />
        </span>
      ))}
    </div>
  );
}

export interface HelperRow {
  id: string;
  label: string;
  /** A logo or glyph. */
  icon?: ReactNode;
  /** A quiet line under the name: "3 processes". */
  detail?: ReactNode;
  /** Worded: "3.1%". */
  cpu: string;
  /** Worded: "412 MB". */
  memory: string;
  /** Its processor share over the last few minutes. */
  trend?: Pick<SparklineProps, 'values' | 'max' | 'latest' | 'intervalMs' | 'color'>;
}

export interface HelperListProps extends Omit<ComponentProps<'table'>, 'children'> {
  rows: readonly HelperRow[];
  /** What the table is, for screen readers. */
  caption: string;
}

/**
 * What's running and what it takes: one row each for Conch and what it
 * started, by who it belongs to, with the processor's share as a number and
 * a sparkline, and memory. A table, so each number is read with its column.
 */
export function HelperList({ rows, caption, className, ...props }: HelperListProps) {
  return (
    <table className={cx(styles.helpers, className)} {...props}>
      <caption className="nc-visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="nc-visually-hidden">Name</span>
          </th>
          <th scope="col" className={styles.trendCell}>
            <span className="nc-visually-hidden">Last few minutes</span>
          </th>
          <th scope="col">Processor</th>
          <th scope="col">Memory</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">
              <span className={styles.helper}>
                {row.icon != null && (
                  <span className={styles.helperIcon} aria-hidden>
                    {row.icon}
                  </span>
                )}
                <span className={styles.helperText}>
                  <span className={styles.helperName}>{row.label}</span>
                  {row.detail != null && <span className={styles.helperDetail}>{row.detail}</span>}
                </span>
              </span>
            </th>
            <td className={styles.trendCell}>
              {row.trend && <Sparkline {...row.trend} height={20} />}
            </td>
            <td className={styles.number}>{row.cpu}</td>
            <td className={styles.number}>{row.memory}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
