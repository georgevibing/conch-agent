import {
  VIDEO_SITE,
  videoFromUrl,
  videoPage,
  videoPlayer,
  type VideoItem,
  type VideosView,
} from '@conch/protocol';
import { VideoShelf, type VideoSummary } from '@conch/nacre';

import { attachmentUrl } from './uploads';

/** A found video as the card draws it: its poster served by Conch, never by the site. */
export function videoSummary(item: VideoItem): VideoSummary {
  // The link out is the video's own page, rebuilt from its id (the view's url was checked
  // against it, so this only ever says the same thing).
  const page = videoFromUrl(item.url);
  return {
    key: `${item.provider}:${item.id}`,
    title: item.title,
    channel: item.channel,
    duration: item.duration,
    published: item.published,
    views: item.views,
    live: item.live,
    poster: item.thumbnail?.kind === 'image' ? attachmentUrl(item.thumbnail.id) : undefined,
    site: VIDEO_SITE[item.provider],
    href: page ? videoPage(item.provider, item.id, item.start) : undefined,
    start: item.start,
    chapters: item.chapters,
  };
}

/**
 * Videos a step found, played in the chat (ADR 0060 §7). The player's
 * address is built here from the checked provider and id (`videoPlayer`),
 * never taken from the view, and only once the person presses play.
 */
export function FoundVideos({ view }: { view: VideosView }) {
  const byKey = new Map(view.items.map((item) => [`${item.provider}:${item.id}`, item]));
  return (
    <VideoShelf
      videos={view.items.map(videoSummary)}
      query={view.query}
      playerFor={(video, start) => {
        const item = byKey.get(video.key);
        return item ? videoPlayer(item.provider, item.id, start) : undefined;
      }}
    />
  );
}
