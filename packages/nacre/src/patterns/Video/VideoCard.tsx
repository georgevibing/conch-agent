import { ArrowUpRight, Film, Maximize, Play, RectangleHorizontal, Square } from 'lucide-react';
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from 'react';

import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import { useScrollEdges } from './edges';
import { useNowPlaying } from './nowPlaying';
import styles from './Video.module.css';
import { clockOf, lengthWords, publishedWords, viewsWords } from './words';

export interface VideoChapterMark {
  title: string;
  /** Seconds from the start. */
  start: number;
}

export interface VideoSummary {
  /** Unique in the chat: `youtube:dQw4w9WgXcQ`. */
  key: string;
  title: string;
  channel?: string;
  /** Length in seconds. */
  duration?: number;
  /** An ISO date, or the site's own words ("2 years ago"). */
  published?: string;
  views?: number;
  live?: boolean;
  /** The poster: a picture Conch kept, never a remote address. */
  poster?: string;
  /** The site's name: "YouTube". */
  site: string;
  /** Its own page on the site. */
  href?: string;
  /** Where it starts playing, in seconds. */
  start?: number;
  chapters?: VideoChapterMark[];
}

/**
 * The player addresses a card will put in a frame: the two sites' own
 * players, nothing else. The app builds the address from a checked id; this
 * is the last look before a frame is made.
 */
const PLAYERS =
  /^https:\/\/(?:www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}\?|player\.vimeo\.com\/video\/\d{1,12}\?)/;

export function isPlayerAddress(src: string | undefined): src is string {
  return Boolean(src && PLAYERS.test(src));
}

export interface VideoCardProps extends Omit<ComponentProps<'figure'>, 'title' | 'children'> {
  video: VideoSummary;
  /** The player's address for this video, from a moment (seconds); nothing when it can't play here. */
  playerFor?: (video: VideoSummary, start?: number) => string | undefined;
  /** Draws the player instead of a frame (stories, tests: nothing loads from outside). */
  renderPlayer?: (video: VideoSummary, start?: number) => ReactNode;
  /** As wide as the transcript. Controlled when set. */
  theater?: boolean;
  onTheaterChange?: (theater: boolean) => void;
  /** Which "one playing at a time" slot is this card's (the shelf hands it over). */
  playKey?: string;
  /** Under the caption: the shelf of the others. */
  footer?: ReactNode;
  /** The poster's picture, for a shared-element move between shelf and lead. */
  posterRef?: Ref<HTMLImageElement>;
}

/** "Play: Bake the perfect loaf, 12 minutes". */
export function playLabel(video: VideoSummary, verb = 'Play'): string {
  const length = video.live ? 'live' : video.duration ? lengthWords(video.duration) : undefined;
  return `${verb}: ${video.title}${length ? `, ${length}` : ''}`;
}

/** "Natasha’s Kitchen · 2 years ago · 3.3M views". */
export function metaLine(video: VideoSummary): string[] {
  const published = publishedWords(video.published);
  return [
    video.channel,
    published,
    video.views !== undefined ? viewsWords(video.views) : undefined,
  ].filter((part): part is string => Boolean(part));
}

/** The poster's chip: its length, or Live. Words, not only a colour. */
export function LengthChip({ video, className }: { video: VideoSummary; className?: string }) {
  if (video.live)
    return (
      <span className={cx(styles.chip, className)} data-live="">
        <span className={styles.liveDot} aria-hidden />
        Live
      </span>
    );
  if (!video.duration) return null;
  return (
    <span className={cx(styles.chip, className)} aria-hidden>
      {clockOf(video.duration)}
    </span>
  );
}

/** A poster's picture, or a quiet pearl stand-in when there's none. */
export function Poster({
  video,
  imgRef,
  className,
}: {
  video: VideoSummary;
  imgRef?: Ref<HTMLImageElement>;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!video.poster || broken)
    return (
      <span className={cx(styles.blank, className)} aria-hidden>
        <Film />
      </span>
    );
  return (
    <img
      ref={imgRef}
      className={cx(styles.picture, className)}
      src={video.poster}
      alt=""
      decoding="async"
      loading="lazy"
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}

/** Focus that came from the keyboard (where the browser can say). */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** How long the player may take to say it's there before the poster goes anyway. */
const REVEAL_MS = 4000;
/** A drawn player: one breath of the waiting disc, then in. */
const DRAWN_MS = 450;
/** How long the poster takes to fade (matches `--nc-duration-slow`). */
const FADE_MS = 320;

/**
 * A video found for the chat. At rest it's a poster: the picture Conch kept,
 * its length, and a big soft play button that blooms under the pointer.
 * Pressing play makes the player, in place, in the same 16:9 box, and the
 * poster fades into it; nothing loads from the site before that press. Once
 * it plays: Theater (as wide as the transcript, Escape leaves it), Full
 * screen, and Stop, which puts the poster back. Only one video plays at a
 * time in the chat.
 */
export function VideoCard({
  video,
  playerFor,
  renderPlayer,
  theater: theaterProp,
  onTheaterChange,
  playKey,
  footer,
  posterRef,
  className,
  ...props
}: VideoCardProps) {
  const uid = useId();
  const key = playKey ?? `${uid}:${video.key}`;
  const { isPlaying, play, stop } = useNowPlaying(key);
  const [own, setOwn] = useState(false);
  const theater = theaterProp ?? own;
  const setTheater = (next: boolean) => {
    if (theaterProp === undefined) setOwn(next);
    onTheaterChange?.(next);
  };
  // Where it plays from: the video's own start, or a chapter pressed (for this video only).
  const [picked, setPicked] = useState<{ key: string; at: number }>();
  const from = picked?.key === video.key ? picked.at : video.start;
  // One play: pressed (a nonce), of this video, from here. Ready and gone belong to one play,
  // so stopping (or another video starting) puts the poster back without resetting anything.
  const [nonce, setNonce] = useState(0);
  const session = isPlaying ? `${video.key}|${from ?? 0}|${nonce}` : undefined;
  const [readyFor, setReadyFor] = useState<string>();
  const [goneFor, setGoneFor] = useState<string>();
  const ready = session !== undefined && readyFor === session;
  const gone = session !== undefined && goneFor === session;
  const stage = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLSpanElement>(null);
  const chapterRow = useRef<HTMLOListElement>(null);
  useScrollEdges(chapterRow);
  const playButton = useRef<HTMLButtonElement>(null);
  const titleId = `${uid}-title`;

  const src = playerFor?.(video, from);
  const drawn = Boolean(renderPlayer);
  const canPlay = drawn || isPlayerAddress(src);
  const setReady = () => setReadyFor(session);

  // The poster fades once the player is there, then makes way.
  useEffect(() => {
    if (!session || ready) return;
    // A player drawn here (not a frame) is there at once; a frame says so when it loads.
    const timer = setTimeout(() => setReadyFor(session), drawn ? DRAWN_MS : REVEAL_MS);
    return () => clearTimeout(timer);
  }, [session, ready, drawn]);
  useEffect(() => {
    if (!session || !ready) return;
    const timer = setTimeout(() => {
      // Focus never falls to the page: if it was still on the poster, it goes to the
      // controls when it came from the keyboard, and quietly to the stage otherwise.
      const poster = playButton.current;
      if (poster && document.activeElement === poster) {
        if (keyboardFocus(poster)) controls.current?.querySelector('button')?.focus();
        else stage.current?.focus({ preventScroll: true });
      }
      setGoneFor(session);
    }, FADE_MS);
    return () => clearTimeout(timer);
  }, [session, ready]);

  // Escape leaves theater (full screen handles its own Escape).
  useEffect(() => {
    if (!theater) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.fullscreenElement) return;
      setTheater(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const start = (at?: number) => {
    if (!canPlay) return;
    if (at !== undefined) setPicked({ key: video.key, at });
    setNonce((n) => n + 1);
    play();
  };

  const fullscreen = () => {
    const el = stage.current;
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
  };

  const meta = metaLine(video);
  const fullscreenable = typeof document !== 'undefined' && document.fullscreenEnabled;

  return (
    <figure
      className={cx(styles.card, className)}
      data-lustre=""
      data-playing={isPlaying || undefined}
      data-ready={(isPlaying && ready) || undefined}
      data-theater={theater || undefined}
      aria-labelledby={titleId}
      {...props}
    >
      <div className={styles.stage} ref={stage} tabIndex={-1}>
        {isPlaying && (
          <div className={styles.player}>
            {renderPlayer ? (
              renderPlayer(video, from)
            ) : (
              <iframe
                key={src}
                src={src}
                title={`${video.title} (${video.site} player)`}
                // The site's player needs its own scripts and storage; popups are its own
                // "Watch on YouTube" links, presentation is casting. Nothing else.
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                // YouTube refuses to play with no referrer at all (error 153): this
                // frame alone sends Conch's origin, never a path. The page stays no-referrer.
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={(event) => {
                  setReady();
                  // Pressed from the keyboard: the keys go on to the player (Space pauses).
                  if (document.activeElement === playButton.current) event.currentTarget.focus();
                }}
              />
            )}
          </div>
        )}
        {!gone && (
          <button
            ref={playButton}
            type="button"
            className={styles.poster}
            data-poster=""
            aria-label={canPlay ? playLabel(video) : `${video.title}: can’t play here`}
            aria-describedby={meta.length ? `${uid}-meta` : undefined}
            disabled={!canPlay}
            data-loading={(isPlaying && !ready) || undefined}
            onClick={() => !isPlaying && start()}
          >
            <Poster video={video} imgRef={posterRef} />
            <span className={styles.scrim} aria-hidden />
            {canPlay && (
              <span className={styles.play} aria-hidden>
                <span className={styles.halo} />
                <Play className={styles.playGlyph} />
              </span>
            )}
            <LengthChip video={video} className={styles.posterChip} />
          </button>
        )}
      </div>
      <figcaption className={styles.caption}>
        <div className={styles.titleRow}>
          <span className={styles.title} id={titleId}>
            {video.title}
          </span>
          {isPlaying && (
            <span className={styles.controls} ref={controls}>
              <IconButton
                size="sm"
                tone="neutral"
                label={theater ? 'Leave theater' : 'Theater'}
                aria-pressed={theater}
                shortcut={theater ? 'Esc' : undefined}
                onClick={() => setTheater(!theater)}
              >
                <RectangleHorizontal />
              </IconButton>
              {fullscreenable && (
                <IconButton size="sm" tone="neutral" label="Full screen" onClick={fullscreen}>
                  <Maximize />
                </IconButton>
              )}
              <IconButton
                size="sm"
                tone="neutral"
                label="Stop"
                onClick={() => {
                  stop();
                  setTheater(false);
                  requestAnimationFrame(() => playButton.current?.focus());
                }}
              >
                <Square />
              </IconButton>
            </span>
          )}
        </div>
        <div className={styles.metaRow}>
          {meta.length > 0 && (
            <span className={styles.meta} id={`${uid}-meta`}>
              {meta.map((part, i) => (
                <Fragment key={i}>
                  {/* Each part stays whole; a line breaks only after a dot, never before one. */}
                  <span className={styles.metaPart}>
                    {part}
                    {i < meta.length - 1 && (
                      <>
                        <span className="nc-visually-hidden">,</span>
                        <span className={styles.sep} aria-hidden>
                          ·
                        </span>
                      </>
                    )}
                  </span>{' '}
                </Fragment>
              ))}
            </span>
          )}
          {video.href && (
            <a className={styles.out} href={video.href} target="_blank" rel="noopener noreferrer">
              Open on {video.site}
              <ArrowUpRight aria-hidden />
            </a>
          )}
        </div>
        {video.chapters && video.chapters.length > 1 && canPlay && (
          <ol className={styles.chapters} aria-label="Chapters" ref={chapterRow}>
            {video.chapters.map((chapter) => (
              <li key={chapter.start}>
                <button
                  type="button"
                  className={styles.chapter}
                  aria-label={`Play from ${clockOf(chapter.start)}: ${chapter.title}`}
                  data-current={(isPlaying && from === chapter.start) || undefined}
                  onClick={() => start(chapter.start)}
                >
                  <span className={styles.chapterAt}>{clockOf(chapter.start)}</span>
                  <span className={styles.chapterTitle}>{chapter.title}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {footer}
      </figcaption>
    </figure>
  );
}
