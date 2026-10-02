import { TriangleAlert } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Collapsible } from '../../components/Collapsible';
import { cx } from '../../utils/cx';
import styles from './Releases.module.css';

/** What one release brings, as its notes say it. */
export interface ReleaseNoteItem {
  /** "0.3.0", "0.4.0-beta.2" */
  version: string;
  /** "2 October", already in words. */
  date?: ReactNode;
  /** What changes for you, and what to do. */
  headsUp?: string[];
  new?: string[];
  better?: string[];
  fixed?: string[];
}

export interface ReleaseNotesProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Newest first. */
  releases: ReleaseNoteItem[];
  /** How a version is named: "Conch 0.3". */
  name?: (version: string) => string;
  /** Open the newest one from the start (default). Older ones start folded. */
  openNewest?: boolean;
}

const GROUPS = [
  ['new', 'New'],
  ['better', 'Better'],
  ['fixed', 'Fixed'],
] as const;

/** "0.3.0" reads as "0.3" in a title. */
const short = (version: string) => version.replace(/^(\d+\.\d+)\.0$/, '$1');

function Body({ release }: { release: ReleaseNoteItem }) {
  const id = useId();
  const groups = GROUPS.filter(([key]) => release[key]?.length);
  return (
    <div className={styles.body}>
      {release.headsUp?.length ? (
        <div className={styles.headsUp} role="note" aria-labelledby={`${id}-heads`}>
          <TriangleAlert aria-hidden className={styles.headsIcon} />
          <div>
            <p id={`${id}-heads`} className={styles.groupTitle}>
              Heads up
            </p>
            <ul className={styles.lines}>
              {release.headsUp.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {groups.map(([key, title]) => (
        <div key={key} className={styles.group}>
          <p id={`${id}-${key}`} className={styles.groupTitle}>
            {title}
          </p>
          <ul className={styles.lines} aria-labelledby={`${id}-${key}`}>
            {release[key]?.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
      {!groups.length && !release.headsUp?.length && (
        <p className={styles.quiet}>Work behind the scenes to keep Conch running well.</p>
      )}
    </div>
  );
}

/**
 * What a release brings, in its own few lines: Heads up (what to do, marked
 * with words and an icon, never colour alone), then New, Better and Fixed.
 * Several releases behind, each version's notes are listed newest first;
 * the newest is open and the others are folded away.
 */
export function ReleaseNotes({
  releases,
  name = (version) => `Conch ${short(version)}`,
  openNewest = true,
  className,
  ...props
}: ReleaseNotesProps) {
  if (!releases.length) return null;
  return (
    <div className={cx(styles.notes, className)} {...props}>
      {releases.map((release, i) => (
        <Collapsible
          key={release.version}
          defaultOpen={openNewest && i === 0}
          className={styles.release}
        >
          <Collapsible.Trigger className={styles.trigger}>
            <span className={styles.version}>{name(release.version)}</span>
            {release.date && <span className={styles.date}>{release.date}</span>}
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Body release={release} />
          </Collapsible.Content>
        </Collapsible>
      ))}
    </div>
  );
}
