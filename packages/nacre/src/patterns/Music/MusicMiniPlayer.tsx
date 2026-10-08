import { X } from 'lucide-react';
import type { ComponentProps, CSSProperties } from 'react';

import { PanelPresence } from '../../components/PanelPresence';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../utils/cx';
import styles from './Music.module.css';
import { Equalizer, PlayGlyph } from './MusicCard';
import { useMusicPlayer, useMusicTime } from './player';
import { useArtworkTint } from './tint';

export type MusicMiniPlayerProps = Omit<ComponentProps<'div'>, 'children'>;

/**
 * What's playing, when its card has scrolled out of sight: a small pill at
 * the foot of the chat with the cover, the title, play/pause and close. The
 * title takes you back to the card. It comes and goes with the panel motion
 * (glint), from the bottom edge.
 */
export function MusicMiniPlayer({ className, ...props }: MusicMiniPlayerProps) {
  const [state, player] = useMusicPlayer();
  const track = state.track;
  const open = Boolean(track && !state.cardInSight && (state.playing || player.time() > 0));
  const time = useMusicTime(open);
  const tint = useArtworkTint(track?.artwork);
  const duration = state.duration ?? (track?.whole ? track.duration : 30) ?? 30;
  const progress = Math.min(1, Math.max(0, time / Math.max(1, duration)));
  return (
    <PanelPresence open={open} side="bottom" className={cx(styles.miniHost, className)} {...props}>
      {track && (
        <div
          className={styles.mini}
          role="group"
          aria-label="Now playing"
          data-state={state.playing ? 'playing' : 'paused'}
          style={
            {
              '--mu-progress': progress,
              ...(tint && { '--mu-tint': tint.glow, '--mu-ink': tint.ink }),
            } as CSSProperties
          }
        >
          <button
            type="button"
            className={styles.miniBack}
            onClick={() => player.reveal()}
            aria-label={`${track.title}${track.by ? ` by ${track.by}` : ''}. Back to its card`}
          >
            <span className={styles.miniCover} aria-hidden>
              {track.artwork ? <img src={track.artwork} alt="" draggable={false} /> : null}
            </span>
            <span className={styles.miniText} aria-hidden>
              <span className={styles.miniTitle}>
                <Equalizer playing={state.playing} className={styles.miniEq} />
                <span className={styles.titleText}>{track.title}</span>
              </span>
              {track.by && <span className={styles.miniBy}>{track.by}</span>}
            </span>
          </button>
          <button
            type="button"
            className={cx(styles.play, styles.miniPlay)}
            aria-label={`${state.playing ? 'Pause' : 'Play'} ${track.title}`}
            onClick={() => player.toggle()}
          >
            <PlayGlyph playing={state.playing} />
          </button>
          <Tooltip content="Stop and close">
            <button
              type="button"
              className={styles.miniClose}
              aria-label="Stop and close"
              onClick={() => player.stop()}
            >
              <X aria-hidden />
            </button>
          </Tooltip>
          <span className={styles.miniProgress} aria-hidden />
        </div>
      )}
    </PanelPresence>
  );
}
