import {
  ArrowUpRight,
  CircleAlert,
  Disc3,
  Mic,
  Music2,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  UserRound,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { SegmentedControl } from '../../components/SegmentedControl';
import { Slider } from '../../components/Slider';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../utils/cx';
import { outside, ShowAll, useShowAll, webLink } from '../ToolViews/shared';
import styles from './Music.module.css';
import { useMusicPlayer, useMusicTime, type MusicKind, type MusicTrack } from './player';
import { clock, length, spoken, useArtworkTint, type Tint } from './tint';

export interface MusicCardProps extends Omit<ComponentProps<'section'>, 'children'> {
  /** What was found, best first. The first is shown large until another is chosen. */
  tracks: MusicTrack[];
  /** What was looked for: "bohemian rhapsody". */
  query?: string;
  /**
   * Which card this is, the same each time it's drawn (the mini player finds
   * its way back to it). Defaults to one made from what it carries.
   */
  cardId?: string;
}

const KIND_WORD: Record<MusicKind, [string, string]> = {
  song: ['song', 'songs'],
  album: ['album', 'albums'],
  artist: ['artist', 'artists'],
  podcast: ['podcast', 'podcasts'],
  episode: ['episode', 'episodes'],
};

const SPEEDS = ['1', '1.25', '1.5', '2'] as const;

/** "3 Oct 2026", "1975". */
function when(iso: string | undefined, year = false): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return year
    ? String(d.getUTCFullYear())
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The small words over the title: what it is, and the one fact that matters most. */
function kicker(t: MusicTrack): string {
  if (t.kind === 'song') return t.src ? 'Song · preview' : 'Song';
  if (t.kind === 'episode') return ['Episode', when(t.released)].filter(Boolean).join(' · ');
  if (t.kind === 'podcast')
    return ['Podcast', t.tracks && `${t.tracks} episodes`].filter(Boolean).join(' · ');
  if (t.kind === 'album')
    return ['Album', t.tracks && `${t.tracks} songs`].filter(Boolean).join(' · ');
  return ['Artist', t.genre].filter(Boolean).join(' · ');
}

/** Who and where, under the title. */
function byline(t: MusicTrack): string | undefined {
  if (t.kind === 'song')
    return [t.by, t.album, when(t.released, true)].filter(Boolean).join(' · ') || undefined;
  if (t.kind === 'album')
    return [t.by, when(t.released, true)].filter(Boolean).join(' · ') || undefined;
  if (t.kind === 'episode')
    return [t.by, length(t.duration)].filter(Boolean).join(' · ') || undefined;
  if (t.kind === 'podcast') return [t.by, t.genre].filter(Boolean).join(' · ') || undefined;
  return undefined;
}

/** Why it doesn't play here, and what to do instead. */
function notHere(t: MusicTrack): string {
  if (t.kind === 'podcast') return 'Ask for one of its episodes to hear it here.';
  if (t.kind === 'episode') return 'This episode can’t be played here. Its own app has it.';
  if (t.kind === 'song') return 'There’s no preview of this one. Hear it in full:';
  if (t.kind === 'artist') return 'Ask for a song of theirs to hear it here.';
  return 'Ask for one of its songs to hear a preview here.';
}

/** A row's second line: who, and how many when it's a collection. */
function rowLine(t: MusicTrack): string | undefined {
  const count =
    t.tracks &&
    (t.kind === 'album'
      ? `${t.tracks} songs`
      : t.kind === 'podcast'
        ? `${t.tracks} episodes`
        : undefined);
  return [byline(t), count].filter(Boolean).join(' · ') || undefined;
}

const tintStyle = (tint: Tint | undefined): CSSProperties | undefined =>
  tint ? ({ '--mu-tint': tint.glow, '--mu-ink': tint.ink } as CSSProperties) : undefined;

/** The cover, or a quiet glyph where there's none. */
function Cover({ track, className }: { track: MusicTrack; className?: string }) {
  const [failed, setFailed] = useState(false);
  const Glyph =
    track.kind === 'artist'
      ? UserRound
      : track.kind === 'podcast' || track.kind === 'episode'
        ? Mic
        : track.kind === 'album'
          ? Disc3
          : Music2;
  return (
    <span className={cx(styles.cover, className)}>
      {track.artwork && !failed ? (
        <img src={track.artwork} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <Glyph aria-hidden className={styles.coverGlyph} />
      )}
    </span>
  );
}

/** Play turning into pause and back: two halves that fold into each other on a spring. */
export function PlayGlyph({ playing }: { playing: boolean }) {
  return (
    <span className={styles.glyph} data-playing={playing || undefined} aria-hidden>
      <span className={styles.glyphHalf} data-half="a" />
      <span className={styles.glyphHalf} data-half="b" />
    </span>
  );
}

/** Three bars that dance while it plays and rest while it's paused. */
export function Equalizer({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span className={cx(styles.eq, className)} data-playing={playing || undefined} aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

/** Skip back or ahead, the seconds drawn inside the arrow. */
function SkipButton({ by, onSkip }: { by: number; onSkip: () => void }) {
  const label = by < 0 ? `Back ${-by} seconds` : `Ahead ${by} seconds`;
  return (
    <Tooltip content={label}>
      <button type="button" className={styles.skip} aria-label={label} onClick={onSkip}>
        {by < 0 ? <RotateCcw aria-hidden /> : <RotateCw aria-hidden />}
        <span className={styles.skipNumber} aria-hidden>
          {Math.abs(by)}
        </span>
      </button>
    </Tooltip>
  );
}

function Links({ track, loud = false }: { track: MusicTrack; loud?: boolean }) {
  const podcast = track.kind === 'podcast' || track.kind === 'episode';
  const links = [
    { name: podcast ? 'Apple Podcasts' : 'Apple Music', url: webLink(track.links?.apple) },
    { name: 'Spotify', url: webLink(track.links?.spotify) },
    { name: 'YouTube Music', url: webLink(track.links?.youtube) },
  ].filter((l): l is { name: string; url: string } => Boolean(l.url));
  if (!links.length) return null;
  return (
    <ul className={styles.links} data-loud={loud || undefined} aria-label="Listen elsewhere">
      {links.map((l) => (
        <li key={l.name}>
          <a className={styles.link} href={l.url} {...outside} data-lustre={loud ? '' : undefined}>
            {l.name}
            <ArrowUpRight aria-hidden />
            <span className={styles.srOnly}> (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A made-up but steady name for a card, from what it carries. */
function keyOf(tracks: MusicTrack[], query?: string): string {
  let h = 0;
  const text = `${query ?? ''}|${tracks.map((t) => t.id).join('|')}`;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `music-${(h >>> 0).toString(36)}`;
}

/**
 * Music and podcasts a tool found, played right in the chat. The one shown
 * large has its cover with a glow of its own colour; a record slides out from
 * behind a song's cover and turns while it plays. Under it, the rest as a
 * tracklist: each row plays at a press, its number turning into dancing bars.
 * Only one thing plays in the whole chat, and the system's media keys work.
 */
export function MusicCard({ tracks, query, cardId, className, ...props }: MusicCardProps) {
  const card = cardId ?? keyOf(tracks, query);
  const [state, player] = useMusicPlayer();
  const [chosen, setChosen] = useState(0);
  const root = useRef<HTMLElement>(null);
  const ours = state.card === card && tracks.some((t) => t.id === state.track?.id);
  // The one shown large follows what plays from this card (the next song, from the media keys).
  const heroIndex = ours
    ? Math.max(
        0,
        tracks.findIndex((t) => t.id === state.track?.id),
      )
    : chosen;
  const hero = tracks[heroIndex] ?? tracks[0];
  const heroOn = Boolean(ours && hero && state.track?.id === hero.id);
  const time = useMusicTime(heroOn);
  const tint = useArtworkTint(hero?.artwork);
  const { folded, folds, showAll, limit } = useShowAll(tracks.length);

  // Whether the card is in sight: when it isn't and it's playing, the mini player shows.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const seen = new IntersectionObserver(
      ([entry]) => player.sight(card, Boolean(entry?.isIntersecting), el),
      { threshold: 0.15 },
    );
    seen.observe(el);
    return () => {
      seen.disconnect();
      player.sight(card, false);
    };
  }, [card, player]);

  if (!hero) return null;
  const playing = heroOn && state.playing;
  const playable = Boolean(hero.src);
  const options = { card, queue: tracks };
  const duration = heroOn
    ? (state.duration ?? (hero.whole ? hero.duration : 30))
    : hero.whole
      ? hero.duration
      : 30;
  const togglePlay = () => player.toggle(hero, options);
  const seekBy = (by: number) => {
    if (!heroOn) return;
    player.skip(by);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      seekBy(e.key === 'ArrowLeft' ? -5 : 5);
    } else if (
      e.key === ' ' &&
      e.target instanceof HTMLElement &&
      e.target.getAttribute('role') === 'slider'
    ) {
      e.preventDefault();
      togglePlay();
    }
  };
  const many = tracks.length > 1;
  const playableCount = tracks.filter((t) => t.src).length;
  const same = tracks.every((t) => t.kind === tracks[0]?.kind);
  const counted: [string, string] = same
    ? KIND_WORD[tracks[0]?.kind ?? 'song']
    : ['result', 'results'];
  const label = `${many ? `${tracks.length} ${counted[1]}` : counted[0]}${query ? ` for “${query}”` : ''}`;
  const problem = heroOn ? state.problem : undefined;
  const busy = heroOn && state.buffering && !problem;
  const remaining = Math.max(0, (duration ?? 0) - time);
  const shown = folded ? tracks.slice(0, limit) : tracks;
  const vinyl = hero.kind === 'song' || hero.kind === 'album';

  return (
    <section
      ref={root}
      aria-label={`Music: ${label}`}
      className={cx(styles.card, className)}
      data-state={playing ? 'playing' : heroOn && !problem ? 'paused' : 'idle'}
      data-kind={hero.kind}
      data-tinted={tint ? '' : undefined}
      style={tintStyle(tint)}
      {...props}
    >
      <div className={styles.hero} data-playable={playable || undefined}>
        <div className={styles.art} data-vinyl={vinyl || undefined}>
          <span className={styles.glow} aria-hidden />
          {vinyl && (
            <span className={styles.vinyl} aria-hidden>
              <span className={styles.vinylSpin}>
                <span className={styles.label} />
              </span>
              <span className={styles.vinylSheen} />
            </span>
          )}
          <Cover track={hero} className={styles.heroCover} />
        </div>
        <div className={styles.main}>
          <span className={styles.kicker}>{kicker(hero)}</span>
          <h3 className={styles.title}>
            <span className={styles.titleText}>{hero.title}</span>
          </h3>
          {(byline(hero) || hero.explicit) && (
            <span className={styles.by}>
              {hero.explicit && <Explicit />}
              <span className={styles.byText}>{byline(hero)}</span>
            </span>
          )}
          {hero.kind === 'episode' && hero.description && (
            <p className={styles.description}>{hero.description}</p>
          )}
          {!playable && <p className={styles.description}>{notHere(hero)}</p>}
        </div>
        {playable ? (
          <div className={styles.transport} data-whole={hero.whole || undefined}>
            <div className={styles.buttons}>
              {hero.whole ? (
                <SkipButton by={-15} onSkip={() => (heroOn ? seekBy(-15) : undefined)} />
              ) : (
                many &&
                playableCount > 1 && (
                  <Tooltip content="Previous">
                    <button
                      type="button"
                      className={styles.skip}
                      aria-label="Previous"
                      disabled={heroIndex === 0}
                      onClick={() =>
                        ours ? player.previous() : setChosen(Math.max(0, heroIndex - 1))
                      }
                    >
                      <SkipBack aria-hidden />
                    </button>
                  </Tooltip>
                )
              )}
              <button
                type="button"
                className={styles.play}
                aria-label={`${playing ? 'Pause' : 'Play'} ${hero.title}`}
                aria-busy={busy || undefined}
                data-busy={busy || undefined}
                onClick={togglePlay}
                onKeyDown={keys}
                data-lustre=""
              >
                <PlayGlyph playing={playing} />
                <span className={styles.ring} aria-hidden />
              </button>
              {hero.whole ? (
                <SkipButton by={30} onSkip={() => (heroOn ? seekBy(30) : undefined)} />
              ) : (
                many &&
                playableCount > 1 && (
                  <Tooltip content="Next">
                    <button
                      type="button"
                      className={styles.skip}
                      aria-label="Next"
                      disabled={heroIndex >= tracks.length - 1}
                      onClick={() => {
                        const next = tracks.slice(heroIndex + 1).find((t) => t.src);
                        if (!next) return;
                        if (ours) player.next();
                        else setChosen(tracks.indexOf(next));
                      }}
                    >
                      <SkipForward aria-hidden />
                    </button>
                  </Tooltip>
                )
              )}
            </div>
            <div className={styles.scrub}>
              <span className={styles.time}>
                <span aria-hidden>{clock(time)}</span>
                <span className={styles.srOnly}>{spoken(time)} played</span>
              </span>
              <Slider
                size="sm"
                className={styles.slider}
                min={0}
                max={Math.max(1, duration ?? 30)}
                step={0.1}
                value={[Math.min(time, duration ?? time)]}
                disabled={!heroOn}
                onValueChange={([v]) => v !== undefined && player.seek(v)}
                onKeyDown={keys}
                aria-label={`Position in ${hero.title}`}
                getValueText={(v) => `${spoken(v)} of ${spoken(duration)}`}
              />
              <span className={styles.time}>
                <span aria-hidden>−{clock(remaining)}</span>
                <span className={styles.srOnly}>{spoken(remaining)} left</span>
              </span>
            </div>
            {problem && (
              <p className={styles.problem} role="status">
                <CircleAlert aria-hidden />
                {problem}
              </p>
            )}
          </div>
        ) : (
          <div className={styles.elsewhere}>
            <Links track={hero} loud />
          </div>
        )}
        <div className={styles.foot}>
          {playable && <Links track={hero} />}
          {playable && hero.whole && (
            <SegmentedControl
              size="sm"
              className={styles.speed}
              aria-label="Playback speed"
              value={String(state.rate)}
              onValueChange={(v) => v && player.setRate(Number(v))}
            >
              {SPEEDS.map((s) => (
                <SegmentedControl.Item key={s} value={s} aria-label={`${s} times`}>
                  {s}×
                </SegmentedControl.Item>
              ))}
            </SegmentedControl>
          )}
        </div>
      </div>
      {many && (
        <>
          <ol className={styles.list} aria-label={`All ${counted[1]}`}>
            {shown.map((t, i) => {
              const current = i === heroIndex;
              const on = ours && state.track?.id === t.id;
              const rowPlaying = on && state.playing;
              const what = rowLine(t);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className={styles.row}
                    aria-current={current || undefined}
                    data-on={on || undefined}
                    data-playable={t.src ? '' : undefined}
                    aria-label={`${t.src ? (rowPlaying ? 'Pause' : 'Play') : 'Show'} ${t.title}${t.by ? ` by ${t.by}` : ''}`}
                    onClick={() => {
                      setChosen(i);
                      if (t.src) player.toggle(t, options);
                    }}
                    data-lustre=""
                  >
                    <span className={styles.lead} aria-hidden>
                      {on ? (
                        <Equalizer playing={rowPlaying} />
                      ) : (
                        <span className={styles.number}>{i + 1}</span>
                      )}
                      {t.src && (
                        <span className={styles.rowPlay}>
                          <PlayGlyph playing={rowPlaying} />
                        </span>
                      )}
                    </span>
                    <Cover track={t} className={styles.thumb} />
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>
                        <span className={styles.titleText}>{t.title}</span>
                      </span>
                      {(what || t.explicit) && (
                        <span className={styles.rowBy}>
                          {t.explicit && <Explicit />}
                          <span className={styles.byText}>{what}</span>
                        </span>
                      )}
                    </span>
                    <span className={styles.rowTime}>
                      {t.kind === 'episode'
                        ? length(t.duration)
                        : t.duration
                          ? clock(t.duration)
                          : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {folded && folds && <ShowAll onClick={showAll}>Show all {tracks.length}</ShowAll>}
        </>
      )}
    </section>
  );
}

function Explicit(): ReactNode {
  return (
    <span className={styles.explicit} title="Explicit">
      <span aria-hidden>E</span>
      <span className={styles.srOnly}>Explicit</span>
    </span>
  );
}
