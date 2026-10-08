/** Made-up videos for stories and tests: nobody and nothing here is real. */
import { Pause } from 'lucide-react';

import type { VideoSummary } from './VideoCard';

const svg = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">${body}</svg>`,
  )}`;

/** A loaf on a board, warm light. */
export const loaf = svg(`<defs>
<radialGradient id="l" cx=".3" cy=".2" r="1"><stop offset="0" stop-color="#f6dcb0"/><stop offset=".6" stop-color="#b9774a"/><stop offset="1" stop-color="#3b2418"/></radialGradient>
<radialGradient id="b" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#e9a65c"/><stop offset=".7" stop-color="#a5602c"/><stop offset="1" stop-color="#5c3115"/></radialGradient></defs>
<rect width="1280" height="720" fill="url(#l)"/>
<ellipse cx="700" cy="560" rx="520" ry="120" fill="#6b4126" opacity=".85"/>
<ellipse cx="660" cy="420" rx="330" ry="210" fill="url(#b)"/>
<path d="M440 400 C560 330 760 330 880 400" stroke="#f5d7a6" stroke-width="18" fill="none" stroke-linecap="round" opacity=".8"/>
<path d="M470 470 C590 410 760 410 860 470" stroke="#f5d7a6" stroke-width="12" fill="none" stroke-linecap="round" opacity=".55"/>`);

/** Hands shaping dough, a cool morning kitchen. */
export const dough =
  svg(`<defs><linearGradient id="k" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe0e8"/><stop offset="1" stop-color="#7a98a8"/></linearGradient></defs>
<rect width="1280" height="720" fill="url(#k)"/>
<rect y="470" width="1280" height="250" fill="#d9c8ad"/>
<ellipse cx="640" cy="500" rx="250" ry="110" fill="#f3ead8"/>
<ellipse cx="420" cy="430" rx="110" ry="70" fill="#e8b996"/><ellipse cx="860" cy="430" rx="110" ry="70" fill="#e8b996"/>`);

/** A starter jar against a window. */
export const starter =
  svg(`<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9c2"/><stop offset="1" stop-color="#f2a65a"/></linearGradient></defs>
<rect width="1280" height="720" fill="url(#w)"/>
<rect x="520" y="170" width="240" height="420" rx="40" fill="#fffaf0" opacity=".75"/>
<rect x="540" y="330" width="200" height="240" rx="26" fill="#efe1c4"/>
<circle cx="600" cy="400" r="12" fill="#fff"/><circle cx="660" cy="450" r="9" fill="#fff"/><circle cx="700" cy="380" r="7" fill="#fff"/>`);

/** A talk on a stage, deep blue. */
export const talk =
  svg(`<defs><radialGradient id="s" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="#3b5bdb"/><stop offset="1" stop-color="#0b1026"/></radialGradient></defs>
<rect width="1280" height="720" fill="url(#s)"/>
<ellipse cx="640" cy="640" rx="460" ry="60" fill="#1b2450"/>
<circle cx="640" cy="330" r="64" fill="#f1c9a5"/><rect x="560" y="400" width="160" height="230" rx="60" fill="#e8590c"/>`);

/** A trailer: mountains at night. */
export const peaks =
  svg(`<defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1b2a"/><stop offset="1" stop-color="#415a77"/></linearGradient></defs>
<rect width="1280" height="720" fill="url(#n)"/>
<circle cx="980" cy="160" r="60" fill="#e0e1dd"/>
<path d="M0 620 L260 300 L460 520 L700 220 L980 560 L1140 400 L1280 520 V720 H0Z" fill="#1b263b"/>
<path d="M0 720 L320 480 L560 640 L820 460 L1280 700 V720Z" fill="#0d1b2a"/>`);

export const bake: VideoSummary = {
  key: 'youtube:aaaaaaaaaaa',
  title: 'Bake the perfect sourdough loaf: a step-by-step guide for beginners',
  channel: 'Harbour Kitchen',
  duration: 713,
  published: '2 years ago',
  views: 3_344_279,
  poster: loaf,
  site: 'YouTube',
  href: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
  chapters: [
    { title: 'Feeding the starter', start: 0 },
    { title: 'Mixing the dough', start: 60 },
    { title: 'Bulk fermentation', start: 135 },
    { title: 'Shaping your loaf', start: 206 },
    { title: 'Cold proof overnight', start: 274 },
    { title: 'Scoring and baking', start: 402 },
  ],
};

export const boule: VideoSummary = {
  key: 'youtube:bbbbbbbbbbb',
  title: 'How to shape a boule (and why tension matters)',
  channel: 'The Flour Room',
  duration: 504,
  published: '8 months ago',
  views: 412_900,
  poster: dough,
  site: 'YouTube',
  href: 'https://www.youtube.com/watch?v=bbbbbbbbbbb',
};

export const starterFilm: VideoSummary = {
  key: 'vimeo:22439234',
  title: 'Starter, from flour and water to bubbles in seven days',
  channel: 'Slow Bread Films',
  duration: 1860,
  published: '2019-04-15T08:35:35',
  views: 18_200,
  poster: starter,
  site: 'Vimeo',
  href: 'https://vimeo.com/22439234',
};

export const science: VideoSummary = {
  key: 'youtube:ccccccccccc',
  title: 'The science of sourdough: wild yeast, bacteria and time',
  channel: 'Food Lab Talks',
  duration: 3725,
  published: '3 years ago',
  views: 1_280_000,
  poster: talk,
  site: 'YouTube',
  href: 'https://www.youtube.com/watch?v=ccccccccccc',
};

export const liveBake: VideoSummary = {
  key: 'youtube:ddddddddddd',
  title: 'Baking live from the bakery: ask us anything',
  channel: 'Harbour Kitchen',
  live: true,
  poster: peaks,
  site: 'YouTube',
  href: 'https://www.youtube.com/watch?v=ddddddddddd',
};

export const videos: VideoSummary[] = [bake, boule, starterFilm, science, liveBake];

/**
 * A stand-in player: the site's frame can't load in Storybook (nothing loads
 * from outside), so this shows what playing looks like.
 */
export function StubPlayer({ video, start }: { video: VideoSummary; start?: number }) {
  return (
    <div
      role="img"
      aria-label={`${video.title}, playing`}
      style={{
        position: 'relative',
        inlineSize: '100%',
        blockSize: '100%',
        background: '#000',
        color: '#fff',
        fontFamily: 'var(--nc-font-sans)',
      }}
    >
      {video.poster && (
        <img
          src={video.poster}
          alt=""
          style={{ inlineSize: '100%', blockSize: '100%', objectFit: 'cover', opacity: 0.92 }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          insetInline: 0,
          insetBlockEnd: 0,
          padding: '28px 14px 10px',
          background: 'linear-gradient(to top, rgb(0 0 0 / 0.7), transparent)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 12,
        }}
      >
        <Pause size={16} fill="currentColor" aria-hidden />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {Math.floor((start ?? 84) / 60)}:{String((start ?? 84) % 60).padStart(2, '0')}
        </span>
        <span
          style={{
            flex: 1,
            height: 3,
            borderRadius: 2,
            background: 'rgb(255 255 255 / 0.3)',
            overflow: 'hidden',
          }}
        >
          <span style={{ display: 'block', width: '22%', height: '100%', background: '#f03' }} />
        </span>
        <span style={{ opacity: 0.8 }}>{video.site}</span>
      </div>
    </div>
  );
}
