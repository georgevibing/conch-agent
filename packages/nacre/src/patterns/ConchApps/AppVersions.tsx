import { History, Undo2 } from 'lucide-react';
import { useId, type ComponentProps } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './AppVersions.module.css';
import type { AppVersionView } from './types';

const dateOf = (at: number) =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    at,
  );

export interface AppVersionsProps extends Omit<ComponentProps<'section'>, 'children'> {
  /** The app's name, for the buttons' labels. */
  name: string;
  /** The version in use now, and when it came. */
  current: { version: string; at: number };
  /** Earlier versions kept for **Go back**, newest first (`ConchApp.versions`). */
  versions: readonly AppVersionView[];
  /** **Go back** to one of them. */
  onGoBack: (version: string) => void;
  /** Going back to this version now. */
  busy?: string;
  formatTime?: (at: number) => string;
}

/**
 * The versions Conch keeps of an app (ADR 0061): the one in use, and the
 * three before it, each with **Go back**. Its notes stay as they are: only
 * the app's own files change.
 */
export function AppVersions({
  name,
  current,
  versions,
  onGoBack,
  busy,
  formatTime = dateOf,
  className,
  ...props
}: AppVersionsProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx(styles.versions, className)} {...props}>
      <p id={titleId} className={styles.title}>
        <History aria-hidden />
        Versions
      </p>
      <ol className={styles.list}>
        <li className={styles.row} data-current="">
          <span className={styles.version}>{current.version}</span>
          <span className={styles.when}>{formatTime(current.at)}</span>
          <Badge size="sm" tone="success" dot>
            In use
          </Badge>
        </li>
        {versions.map((v) => (
          <li key={`${v.version}-${v.at}`} className={styles.row}>
            <span className={styles.version}>{v.version}</span>
            <span className={styles.when}>{formatTime(v.at)}</span>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Undo2 />}
              onClick={() => onGoBack(v.version)}
              loading={busy === v.version}
              disabled={busy !== undefined && busy !== v.version}
              aria-label={`Go back to ${name} ${v.version}`}
            >
              Go back
            </Button>
          </li>
        ))}
      </ol>
      <p className={styles.note}>
        {versions.length
          ? 'Going back keeps its notes as they are. Only the app itself changes.'
          : 'Earlier versions show here once it’s been updated.'}
      </p>
    </section>
  );
}
