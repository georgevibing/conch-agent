import { ArrowUpCircle, Check, CloudOff, Hourglass, Lightbulb, Search } from 'lucide-react';
import {
  useId,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Badge } from '../../components/Badge';
import { Skeleton } from '../../components/Skeleton';
import { Heading } from '../../components/Text';
import { cx } from '../../utils/cx';
import { SkillIcon } from '../Skills/SkillIcon';
import styles from './Discover.module.css';
import { MarketTrustBadge } from './MarketTrustBadge';
import { roughly, type MarketIdeaView, type MarketListingView } from './types';

export interface MarketSkillCardProps extends Omit<ComponentProps<'article'>, 'children'> {
  listing: MarketListingView;
  /** **Look**: the skill read and explained, before anything is added. */
  onOpen: (listing: MarketListingView) => void;
  /** Position in a grid, to stagger the entrance. */
  index?: number;
}

/**
 * A skill someone published, as a card on Discover (ADR 0070): what it does in
 * a line, what the place it's from says about it, where and who it's from,
 * and how many use it. Nothing is added from here: the card opens the skill,
 * read and explained first. One you have says **Added** (or **Update**).
 */
export function MarketSkillCard({
  listing,
  onOpen,
  index = 0,
  className,
  style,
  ...props
}: MarketSkillCardProps) {
  const titleId = useId();
  const used = listing.installs ?? 0;
  return (
    <article
      aria-labelledby={titleId}
      data-lustre=""
      data-trust={listing.trust}
      data-installed={listing.installed ? '' : undefined}
      className={cx(styles.tile, className)}
      style={{ '--mk-i': Math.min(index, 12), ...style } as CSSProperties}
      {...props}
    >
      <SkillIcon name={listing.name} title={listing.title} size="md" />
      <div className={styles.text}>
        <h3 className={styles.title}>
          <button
            type="button"
            id={titleId}
            className={styles.open}
            onClick={() => onOpen(listing)}
            aria-label={`${listing.title}, from ${listing.sourceLabel}. Look at it`}
          >
            {listing.title}
          </button>
        </h3>
        <p className={styles.description} data-empty={!listing.description || undefined}>
          {listing.description || 'No description yet. Open it to read what it does.'}
        </p>
        <p className={styles.meta}>
          <MarketTrustBadge trust={listing.trust} />
          <span className={styles.from}>
            {listing.sourceLabel} · {listing.publisher.name}
          </span>
          {used > 0 && (
            <span className={styles.used}>
              {roughly(used)}
              <span className="nc-visually-hidden"> people</span> use it
            </span>
          )}
        </p>
      </div>
      <div className={styles.side}>
        {listing.installed?.update ? (
          <Badge size="sm" tone="info" icon={<ArrowUpCircle />}>
            Update
          </Badge>
        ) : listing.installed ? (
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

export interface MarketShelfProps extends Omit<ComponentProps<'section'>, 'children' | 'title'> {
  listings: readonly MarketListingView[];
  onOpen: (listing: MarketListingView) => void;
  /** The shelf's heading: “Popular”, “For “slides””. */
  title?: string;
  loading?: boolean;
  /** A place couldn't be reached; what's shown is from before (or nothing). */
  offline?: boolean;
  /** A place asked Conch to wait. */
  limited?: boolean;
  /** What was searched for, for the empty state. */
  query?: string;
  /** Something to offer when nothing's found: **Write it yourself**. */
  emptyAction?: ReactNode;
}

/**
 * A shelf of skills on Discover (ADR 0070). Calm when a place can't be
 * reached or asks Conch to wait: a quiet line says what's shown is from
 * before, never an error.
 */
export function MarketShelf({
  listings,
  onOpen,
  title,
  loading,
  offline,
  limited,
  query,
  emptyAction,
  className,
  ...props
}: MarketShelfProps) {
  const titleId = useId();
  const note = offline
    ? {
        icon: <CloudOff />,
        text: listings.length
          ? 'Some places skills come from can’t be reached right now. These are from before.'
          : 'The places skills come from can’t be reached right now. Conch looks again when you’re back online.',
      }
    : limited
      ? {
          icon: <Hourglass />,
          text: listings.length
            ? 'One place asked Conch to wait a minute. These are from before.'
            : 'One place asked Conch to wait a minute. Try again shortly.',
        }
      : undefined;
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : 'Skills people share'}
      aria-busy={loading || undefined}
      className={cx(styles.shelf, className)}
      {...props}
    >
      {title && (
        <Heading level={2} id={titleId} size="sm" tone="muted">
          {title}
        </Heading>
      )}
      {note && (
        <p className={styles.note} role="status">
          {note.icon}
          {note.text}
        </p>
      )}
      {loading && !listings.length ? (
        <div className={styles.grid} aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.placeholder}>
              <Skeleton shape="block" width="2.5rem" height="2.5rem" />
              <Skeleton lines={3} style={{ flex: 1 }} />
            </div>
          ))}
        </div>
      ) : listings.length ? (
        <ul className={styles.grid}>
          {listings.map((listing, i) => (
            <li key={listing.id}>
              <MarketSkillCard listing={listing} onOpen={onOpen} index={i} />
            </li>
          ))}
        </ul>
      ) : (
        !note && (
          <div className={styles.empty}>
            <Search aria-hidden className={styles.emptyIcon} />
            <p className={styles.emptyText}>
              {query ? `Nobody has shared a skill for “${query}” yet.` : 'Nothing here yet.'}
            </p>
            {emptyAction}
          </div>
        )
      )}
    </section>
  );
}

export interface MarketIdeasProps extends Omit<ComponentProps<'section'>, 'children' | 'onSelect'> {
  ideas: readonly MarketIdeaView[];
  onPick: (idea: MarketIdeaView) => void;
}

/**
 * **Ideas**: for someone who doesn't know what to look for, the everyday
 * things people teach an assistant, in their words. Each one searches.
 */
export function MarketIdeas({ ideas, onPick, className, ...props }: MarketIdeasProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx(styles.ideas, className)} {...props}>
      <p className={styles.ideasTitle} id={titleId}>
        <Lightbulb aria-hidden />
        Not sure what to look for? Start from an idea.
      </p>
      <ul className={styles.ideaList}>
        {ideas.map((idea) => (
          <li key={idea.id}>
            <button type="button" className={styles.idea} onClick={() => onPick(idea)}>
              <SkillIcon name={idea.id} title={idea.label} size="xs" />
              {idea.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface MarketCategoriesProps extends Omit<
  ComponentProps<'div'>,
  'children' | 'onChange'
> {
  categories: readonly { id: string; label: string }[];
  /** Undefined: all of them. */
  value?: string;
  onChange: (category: string | undefined) => void;
}

/** The shelves, as a row of chips; one at a time, or all. Arrow keys move between them. */
export function MarketCategories({
  categories,
  value,
  onChange,
  className,
  ...props
}: MarketCategoriesProps) {
  const all = [{ id: '', label: 'All' }, ...categories];
  const at = Math.max(
    0,
    all.findIndex((c) => (c.id || undefined) === value),
  );
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (at + step + all.length) % all.length;
    onChange(all[next]?.id || undefined);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button');
    buttons?.[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Kinds of skill"
      className={cx(styles.categories, className)}
      {...props}
    >
      {all.map((c, i) => (
        <button
          key={c.id || 'all'}
          type="button"
          role="radio"
          aria-checked={i === at}
          tabIndex={i === at ? 0 : -1}
          className={styles.category}
          onClick={() => onChange(c.id || undefined)}
          onKeyDown={move}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
