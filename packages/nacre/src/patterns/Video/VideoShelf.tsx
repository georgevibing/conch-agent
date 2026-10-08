import { useId, useRef, useState, type ComponentProps } from 'react';
import { flushSync } from 'react-dom';

import { usePrefersReducedMotion } from '../../utils/useMediaQuery';
import { cx } from '../../utils/cx';
import { useScrollEdges } from './edges';
import { playVideo, useNowPlaying } from './nowPlaying';
import styles from './Video.module.css';
import {
  LengthChip,
  playLabel,
  Poster,
  VideoCard,
  type VideoCardProps,
  type VideoSummary,
} from './VideoCard';

export interface VideoShelfProps extends Omit<ComponentProps<'section'>, 'children'> {
  videos: VideoSummary[];
  /** What was searched for: said to screen readers with the count. */
  query?: string;
  playerFor?: VideoCardProps['playerFor'];
  renderPlayer?: VideoCardProps['renderPlayer'];
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/**
 * Videos found for the chat: the first one large, the rest on a shelf under
 * it that scrolls sideways and snaps. Choosing one from the shelf makes it
 * the lead: its picture moves up into the poster's place (a shared-element
 * view transition where the browser has them; a quiet cross-fade where it
 * doesn't, and nothing under reduced motion). When the lead was playing, the
 * chosen one plays in its place.
 */
export function VideoShelf({
  videos,
  query,
  playerFor,
  renderPlayer,
  className,
  ...props
}: VideoShelfProps) {
  const uid = useId();
  const [leadKey, setLeadKey] = useState(videos[0]?.key);
  const [theater, setTheater] = useState(false);
  const reduced = usePrefersReducedMotion();
  const root = useRef<HTMLElement>(null);
  const leadPicture = useRef<HTMLImageElement>(null);
  const lead = videos.find((v) => v.key === leadKey) ?? videos[0];
  const slot = (video: VideoSummary) => `${uid}:${video.key}`;
  const { isPlaying } = useNowPlaying(lead ? slot(lead) : `${uid}:`);
  const [arrived, setArrived] = useState<string>();
  const shelf = useRef<HTMLUListElement>(null);
  useScrollEdges(shelf);

  if (!lead) return null;
  const label = `${videos.length === 1 ? 'A video' : `${videos.length} videos`}${query ? ` for “${query}”` : ''}`;
  const rest = videos.filter((v) => v.key !== lead.key);

  const choose = (video: VideoSummary, picture: HTMLImageElement | null) => {
    const focusLead = () =>
      requestAnimationFrame(() =>
        root.current?.querySelector<HTMLButtonElement>('[data-poster]')?.focus(),
      );
    const apply = () => {
      if (isPlaying) playVideo(slot(video));
      setLeadKey(video.key);
    };
    const doc = document as ViewTransitionDocument;
    const still = reduced || Boolean(root.current?.closest('[data-nacre-motion="reduced"]'));
    if (still || !doc.startViewTransition || !picture) {
      apply();
      // A quiet cross-fade instead (none at all when still).
      if (!still) {
        setArrived(video.key);
        setTimeout(() => setArrived(undefined), 700);
      }
      focusLead();
      return;
    }
    // The picture you pressed becomes the poster: one name, before and after.
    const name = `nc-video-${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    picture.style.viewTransitionName = name;
    const moving = doc.startViewTransition(() => {
      picture.style.viewTransitionName = '';
      flushSync(apply);
      if (leadPicture.current) leadPicture.current.style.viewTransitionName = name;
    });
    void moving.finished.finally(() => {
      if (leadPicture.current) leadPicture.current.style.viewTransitionName = '';
    });
    focusLead();
  };

  return (
    <section
      ref={root}
      aria-label={label}
      className={cx(styles.shelfRoot, className)}
      data-theater={theater || undefined}
      {...props}
    >
      <VideoCard
        video={lead}
        playKey={slot(lead)}
        playerFor={playerFor}
        renderPlayer={renderPlayer}
        theater={theater}
        onTheaterChange={setTheater}
        posterRef={leadPicture}
        data-arrived={arrived === lead.key || undefined}
        footer={
          rest.length > 0 && (
            <ul className={styles.shelf} aria-label="More videos" ref={shelf}>
              {rest.map((video) => (
                <ShelfItem
                  key={video.key}
                  video={video}
                  verb={isPlaying ? 'Play' : 'Show'}
                  onChoose={(picture) => choose(video, picture)}
                />
              ))}
            </ul>
          )
        }
      />
    </section>
  );
}

function ShelfItem({
  video,
  verb,
  onChoose,
}: {
  video: VideoSummary;
  verb: string;
  onChoose: (picture: HTMLImageElement | null) => void;
}) {
  const picture = useRef<HTMLImageElement>(null);
  const id = useId();
  return (
    <li className={styles.shelfItem}>
      <button
        type="button"
        className={styles.thumb}
        aria-label={playLabel(video, verb)}
        aria-describedby={video.channel ? id : undefined}
        onClick={() => onChoose(picture.current)}
      >
        <span className={styles.thumbPicture}>
          <Poster video={video} imgRef={picture} />
          <LengthChip video={video} className={styles.thumbChip} />
        </span>
        <span className={styles.thumbTitle} aria-hidden>
          {video.title}
        </span>
        {video.channel && (
          <span className={styles.thumbChannel} id={id}>
            {video.channel}
          </span>
        )}
      </button>
    </li>
  );
}
