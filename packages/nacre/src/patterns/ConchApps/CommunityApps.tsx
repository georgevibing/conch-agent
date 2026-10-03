import { Check, CloudOff, Hourglass, Search, Star } from 'lucide-react';
import { useId, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Skeleton } from '../../components/Skeleton';
import { Heading } from '../../components/Text';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './CommunityApps.module.css';
import type { CommunityAppView } from './types';

/** "plant-diary" → "plant diary", for the monogram and the name read aloud. */
const words = (repo: string) => repo.replace(/[-_.]+/g, ' ').trim() || repo;

/** 1234 → "1.2k": a glance, not a count. */
function stars(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
}

export interface CommunityAppTileProps extends Omit<ComponentProps<'article'>, 'children'> {
  app: CommunityAppView;
  /** **Look**: the preview, with what it can do, before anything is added. */
  onLook: (app: CommunityAppView) => void;
  /** Position in a grid, to stagger the entrance. */
  index?: number;
}

/**
 * A Conch app someone published on GitHub (ADR 0061), as a tile in the Apps
 * gallery beside the catalog's: who made it, what it says it does, its
 * stars, and **Look**. Nothing is added from here: Look opens the preview,
 * which says what it can do first. One you have says **Added**.
 */
export function CommunityAppTile({
  app,
  onLook,
  index = 0,
  className,
  style,
  ...props
}: CommunityAppTileProps) {
  const titleId = useId();
  const name = words(app.repo);
  return (
    <article
      aria-labelledby={titleId}
      data-lustre=""
      data-installed={app.installed || undefined}
      className={cx(styles.tile, className)}
      style={{ '--ct-i': Math.min(index, 12), ...style } as CSSProperties}
      {...props}
    >
      <IntegrationLogo name={name} size="md" decorative />
      <div className={styles.text}>
        <h3 className={styles.title}>
          <button
            type="button"
            id={titleId}
            className={styles.open}
            onClick={() => onLook(app)}
            aria-label={`Look at ${app.repo} by ${app.owner}`}
          >
            {app.repo}
          </button>
        </h3>
        <p className={styles.owner}>
          {app.owner}
          {(app.stars ?? 0) > 0 && (
            <span className={styles.stars}>
              <Star aria-hidden />
              {stars(app.stars ?? 0)}
              <span className="nc-visually-hidden"> stars</span>
            </span>
          )}
        </p>
        <p className={styles.description} data-empty={!app.description || undefined}>
          {app.description || 'No description yet.'}
        </p>
      </div>
      <div className={styles.side}>
        {app.installed ? (
          <Badge size="sm" tone="success" icon={<Check />}>
            Added
          </Badge>
        ) : (
          <span className={styles.look} aria-hidden>
            Look
          </span>
        )}
      </div>
    </article>
  );
}

export interface CommunityAppsProps extends Omit<ComponentProps<'section'>, 'children'> {
  apps: readonly CommunityAppView[];
  onLook: (app: CommunityAppView) => void;
  /** Still asking GitHub. */
  loading?: boolean;
  /** GitHub asked us to wait; what's shown is from before (or nothing). */
  limited?: boolean;
  /** GitHub couldn't be reached. */
  offline?: boolean;
  /** What was searched for, for the empty state. */
  query?: string;
  /** The heading's level, to fit the page. */
  headingLevel?: 2 | 3;
  /** Something to offer when nothing's found: **Make "…" with Conch**. */
  emptyAction?: ReactNode;
}

/**
 * **From the community**: Conch apps people published on GitHub with the
 * topic `conch-app`, under the Apps gallery. Calm when GitHub limits it or
 * can't be reached — a quiet note, never an error — and an empty search
 * offers to make it instead.
 */
export function CommunityApps({
  apps,
  onLook,
  loading,
  limited,
  offline,
  query,
  headingLevel = 2,
  emptyAction,
  className,
  ...props
}: CommunityAppsProps) {
  const titleId = useId();
  const note = offline
    ? {
        icon: <CloudOff />,
        text: apps.length
          ? 'GitHub can’t be reached right now. These are from before.'
          : 'GitHub can’t be reached right now. Conch looks again when you’re back online.',
      }
    : limited
      ? {
          icon: <Hourglass />,
          text: apps.length
            ? 'GitHub asked us to wait a minute. These are from before.'
            : 'GitHub asked us to wait a minute. Try again shortly.',
        }
      : undefined;
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={loading || undefined}
      className={cx(styles.group, className)}
      {...props}
    >
      <Heading
        level={headingLevel}
        id={titleId}
        size={headingLevel === 2 ? 'sm' : 'xs'}
        tone={headingLevel === 2 ? 'muted' : 'subtle'}
      >
        From the community
      </Heading>
      {note && (
        <p className={styles.note} role="status">
          {note.icon}
          {note.text}
        </p>
      )}
      {loading && !apps.length ? (
        <div className={styles.grid} aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.placeholder}>
              <Skeleton shape="block" width="2.5rem" height="2.5rem" />
              <Skeleton lines={2} style={{ flex: 1 }} />
            </div>
          ))}
        </div>
      ) : apps.length ? (
        <div className={styles.grid}>
          {apps.map((app, i) => (
            <CommunityAppTile
              key={`${app.owner}/${app.repo}`}
              app={app}
              onLook={onLook}
              index={i}
            />
          ))}
        </div>
      ) : (
        !note && (
          <div className={styles.empty}>
            <Search aria-hidden className={styles.emptyIcon} />
            <p className={styles.emptyText}>
              {query
                ? `Nobody has shared an app for “${query}” yet.`
                : 'Nobody has shared a Conch app yet.'}
            </p>
            {emptyAction}
          </div>
        )
      )}
    </section>
  );
}
