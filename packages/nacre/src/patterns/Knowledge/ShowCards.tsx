import { ArrowUpRight, CalendarClock, Clapperboard, Star, Tv } from 'lucide-react';
import { Toolbar, VisuallyHidden } from 'radix-ui';
import { useState, type ComponentProps, type CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import styles from './Knowledge.module.css';
import { Picture } from './Picture';
import { useScrollEdges } from './useScrollEdges';
import { outside, secureLink, tintOf, type CardPicture } from './shared';

export interface ShowNextEpisode {
  /** When it airs (ISO). */
  at: string;
  season?: number;
  number?: number;
  name?: string;
}

export interface ShowCardItem {
  title: string;
  kind: 'tv' | 'movie';
  year?: number;
  poster?: CardPicture;
  genres?: readonly string[];
  /** Viewers' average, out of 10. */
  rating?: number;
  /** Plain text. */
  summary?: string;
  network?: string;
  status?: string;
  next?: ShowNextEpisode;
  /** Its page (https only). */
  url: string;
}

export interface ShowCardsProps extends ComponentProps<'section'> {
  shows: readonly ShowCardItem[];
  /** Where they're from, for the link out: "TVmaze". */
  source?: string;
  /** The time now, for "next episode in 3 days" (tests and stories pin it). */
  now?: number;
  locale?: string;
}

const DAY = 86_400_000;

/** Calendar days from `now` to `at`, in local time. */
function daysUntil(at: Date, now: Date): number {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(at) - start(now)) / DAY);
}

/** "Next episode tomorrow", "… in 3 days", "… on 12 Nov"; nothing once it's passed. */
export function nextEpisodeWords(
  next: ShowNextEpisode | undefined,
  now = Date.now(),
  locale?: string,
  /** For a poster's narrow chip: "Episode in 3 days". */
  short = false,
): string | undefined {
  if (!next) return undefined;
  const at = new Date(next.at);
  if (Number.isNaN(at.getTime())) return undefined;
  const days = daysUntil(at, new Date(now));
  if (days < 0) return undefined;
  const when =
    days === 0
      ? 'today'
      : days === 1
        ? 'tomorrow'
        : days < 7
          ? `in ${days} days`
          : `on ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at)}`;
  return `${short ? 'Episode' : 'Next episode'} ${when}`;
}

const episodeCode = (next: ShowNextEpisode) =>
  next.season !== undefined && next.number !== undefined ? `S${next.season} E${next.number}` : '';

/**
 * Shows and films found, as posters in a row that snaps as it scrolls: each
 * with its rating on the corner, its year and where it's on, its genres, and
 * a chip when the next episode is coming. Arrow keys move along the row; one
 * tab stop for the lot, and pressing a poster opens its page. A single show
 * is shown in full: its poster beside what it's about.
 */
export function ShowCards({
  shows,
  source = 'TVmaze',
  now,
  locale,
  className,
  ...props
}: ShowCardsProps) {
  const [rowRef, edges] = useScrollEdges<HTMLDivElement>();
  // The time it was first drawn: "in 3 days" holds still while the chat is open.
  const [drawnAt] = useState(() => Date.now());
  const at = now ?? drawnAt;
  const [first] = shows;
  if (!first) return null;
  if (shows.length === 1)
    return (
      <section
        aria-label={first.kind === 'movie' ? 'Film' : 'Show'}
        className={cx(styles.card, styles.showOne, className)}
        {...props}
      >
        <ShowOne show={first} source={source} now={at} locale={locale} />
      </section>
    );
  return (
    <section
      aria-label={`Shows, ${shows.length} found`}
      className={cx(styles.showsView, className)}
      {...props}
    >
      <Toolbar.Root
        ref={rowRef}
        {...edges}
        aria-label="Shows"
        orientation="horizontal"
        className={styles.posterRow}
      >
        {shows.map((show, i) => {
          const href = secureLink(show.url);
          const next = nextEpisodeWords(show.next, at, locale, true);
          const inner = (
            <>
              <span className={styles.posterFrame}>
                <Poster show={show} />
                {show.rating !== undefined && <Rating value={show.rating} />}
              </span>
              <span className={styles.posterTitle}>{show.title}</span>
              <span className={styles.posterMeta}>
                {[show.year, show.network].filter(Boolean).join(' · ') ||
                  (show.kind === 'movie' ? 'Film' : 'Show')}
              </span>
              {show.genres && show.genres.length > 0 && (
                <span className={styles.posterGenres}>{show.genres.slice(0, 3).join(' · ')}</span>
              )}
              {next && (
                <span className={styles.nextChip}>
                  <CalendarClock aria-hidden />
                  {next}
                </span>
              )}
            </>
          );
          return href ? (
            <Toolbar.Link
              key={`${show.url}-${i}`}
              href={href}
              {...outside}
              className={styles.posterCard}
              data-lustre=""
            >
              {inner}
            </Toolbar.Link>
          ) : (
            <Toolbar.Button key={`${show.url}-${i}`} className={styles.posterCard} disabled>
              {inner}
            </Toolbar.Button>
          );
        })}
      </Toolbar.Root>
    </section>
  );
}

function Rating({ value }: { value: number }) {
  return (
    <span className={styles.ratingBadge}>
      <Star aria-hidden />
      <span>
        {value.toFixed(1)}
        <VisuallyHidden.Root> out of 10</VisuallyHidden.Root>
      </span>
    </span>
  );
}

function Poster({ show }: { show: ShowCardItem }) {
  const Glyph = show.kind === 'movie' ? Clapperboard : Tv;
  return (
    <Picture
      picture={show.poster}
      className={styles.poster}
      fallback={
        <span
          className={styles.drawnPoster}
          style={{ '--bk-tint': tintOf(show.title) } as CSSProperties}
        >
          <Glyph aria-hidden />
          <span className={styles.drawnTitle}>{show.title}</span>
        </span>
      }
    />
  );
}

function ShowOne({
  show,
  source,
  now,
  locale,
}: {
  show: ShowCardItem;
  source: string;
  now: number;
  locale?: string;
}) {
  const href = secureLink(show.url);
  const next = nextEpisodeWords(show.next, now, locale);
  const meta = [
    show.kind === 'movie' ? 'Film' : undefined,
    show.year,
    show.network,
    show.status,
  ].filter(Boolean);
  return (
    <>
      <span className={styles.showOnePoster}>
        <Poster show={show} />
      </span>
      <div className={styles.showOneText}>
        <p className={styles.showOneTitle}>{show.title}</p>
        {meta.length > 0 && <p className={styles.bookMeta}>{meta.join(' · ')}</p>}
        {show.rating !== undefined && (
          <p className={styles.showOneRating}>
            <Star aria-hidden />
            <span>
              {show.rating.toFixed(1)}
              <VisuallyHidden.Root> out of 10</VisuallyHidden.Root>
            </span>
          </p>
        )}
        {show.genres && show.genres.length > 0 && (
          <ul className={styles.subjects} aria-label="Genres">
            {show.genres.slice(0, 4).map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        )}
        {show.summary && <p className={styles.showSummary}>{show.summary}</p>}
        <div className={styles.showOneFoot}>
          {next && show.next && (
            <span className={styles.nextChip}>
              <CalendarClock aria-hidden />
              {next}
              {episodeCode(show.next) && (
                <span className={styles.nextCode}>{episodeCode(show.next)}</span>
              )}
            </span>
          )}
          {href && (
            <a className={styles.sourceChip} href={href} {...outside} data-lustre="">
              <span>
                <VisuallyHidden.Root>Open on</VisuallyHidden.Root> {source}
              </span>
              <ArrowUpRight aria-hidden className={styles.chipArrow} />
            </a>
          )}
        </div>
      </div>
    </>
  );
}
