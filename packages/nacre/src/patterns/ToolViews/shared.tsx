import { ChevronDown } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './ToolViews.module.css';

/** How many rows a view shows before "Show all". */
export const VISIBLE_ROWS = 6;

/** Only web links leave the chat: anything else is drawn as plain text. */
export function webLink(url: string | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

/** Links out open in a tab of their own that knows nothing about Conch. */
export const outside = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * Whether a list shows everything: it does when there's at most one row more
 * than fits (hiding a single row behind a button saves nothing).
 */
export function useShowAll(total: number, limit = VISIBLE_ROWS) {
  const [all, setAll] = useState(false);
  const folds = total > limit + 1;
  return { folded: folds && !all, folds, showAll: () => setAll(true), limit };
}

/** The quiet button under (or over) a folded list. */
export function ShowAll({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <div className={styles.more}>
      <Button variant="ghost" size="sm" tone="neutral" onClick={onClick}>
        {children}
        <ChevronDown aria-hidden />
      </Button>
    </div>
  );
}

export interface ViewFrameProps extends ComponentProps<'section'> {
  /** What it is, for screen readers: "Calendar, 3 events". */
  label: string;
  /** Where it's from, shown small above the rows: "#design". */
  heading?: ReactNode;
}

/** What a tool found: rows of plain text under the tool's row, no surface of their own. */
export function ViewFrame({ label, heading, className, children, ...props }: ViewFrameProps) {
  return (
    <section aria-label={label} className={cx(styles.view, className)} {...props}>
      {heading != null && <div className={styles.heading}>{heading}</div>}
      {children}
    </section>
  );
}

/** "1 email" / "3 emails". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
