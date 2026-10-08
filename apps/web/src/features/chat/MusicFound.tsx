import { listenPath, type AudioView } from '@conch/protocol';
import { MusicCard, MusicMiniPlayer, type MusicTrack } from '@conch/nacre';
import { useMemo } from 'react';

import styles from './MusicFound.module.css';
import { attachmentUrl } from './uploads';

/**
 * What a music card shows and plays, all from Conch itself: the cover is the
 * chat's own picture, and what plays streams through `/api/listen`, which
 * plays only what a card in this same chat carries. Nothing here ever loads
 * from another site (security.ts: `img-src` and `media-src` are `'self'`).
 */
export function musicTracks(view: AudioView): MusicTrack[] {
  return view.items.map((item, i) => ({
    id: item.preview?.url ?? `${i}:${item.kind}:${item.title}`,
    kind: item.kind,
    title: item.title,
    ...(item.by && { by: item.by }),
    ...(item.album && { album: item.album }),
    ...(item.artwork && { artwork: attachmentUrl(item.artwork.id) }),
    ...(item.duration !== undefined && { duration: item.duration }),
    ...(item.released && { released: item.released }),
    ...(item.genre && { genre: item.genre }),
    ...(item.explicit && { explicit: true }),
    ...(item.description && { description: item.description }),
    ...(item.tracks && { tracks: item.tracks }),
    ...(item.preview && {
      src: listenPath(view.chat, item.preview.url),
      whole: item.preview.whole,
    }),
    ...(item.links && { links: item.links }),
  }));
}

/** Songs and podcasts a tool found, played in the chat (ADR 0060). */
export function MusicFound({ view }: { view: AudioView }) {
  const tracks = useMemo(() => musicTracks(view), [view]);
  const card = `music-${view.chat}-${tracks[0]?.id ?? ''}-${tracks.length}`;
  return <MusicCard tracks={tracks} query={view.query} cardId={card} />;
}

/** What's playing, at the foot of the chat, once its card has scrolled away. */
export function MusicDock() {
  return (
    <div className={styles.dock}>
      <MusicMiniPlayer />
    </div>
  );
}
