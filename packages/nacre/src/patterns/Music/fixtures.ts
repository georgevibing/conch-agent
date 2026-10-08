/** Made-up music for stories and tests: no band, show or song here is real. */
import { createMusicPlayer, type AudioLike, type MusicPlayer, type MusicTrack } from './player';

const svg = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">${body}</svg>`)}`;

export const covers = {
  /** A low sun over the sea, coral and plum. */
  tide: svg(
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1840"/><stop offset=".55" stop-color="#c2456a"/><stop offset="1" stop-color="#ff9a6b"/></linearGradient></defs><rect width="600" height="600" fill="url(#s)"/><circle cx="300" cy="360" r="120" fill="#ffd2a1"/><rect y="380" width="600" height="220" fill="#3a1f4d"/><g fill="#ff9a6b" opacity=".7"><rect x="200" y="410" width="200" height="6" rx="3"/><rect x="230" y="440" width="140" height="6" rx="3"/><rect x="260" y="470" width="80" height="6" rx="3"/></g>`,
  ),
  /** Kelp in deep water, teal and green. */
  kelp: svg(
    `<defs><linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06343f"/><stop offset="1" stop-color="#0f7a6b"/></linearGradient></defs><rect width="600" height="600" fill="url(#w)"/><g fill="none" stroke="#6fe3c1" stroke-width="18" stroke-linecap="round" opacity=".85"><path d="M120 620 C 80 460 200 380 140 200"/><path d="M300 620 C 260 420 380 340 310 120"/><path d="M470 620 C 430 480 540 380 480 250"/></g><circle cx="430" cy="140" r="36" fill="#bff7e4" opacity=".8"/>`,
  ),
  /** Shapes on violet. */
  iris: svg(
    `<rect width="600" height="600" fill="#2e2470"/><circle cx="210" cy="230" r="150" fill="#8f7bff"/><rect x="290" y="290" width="220" height="220" rx="24" fill="#f1c1ff"/><path d="M80 520 L230 360 L380 520Z" fill="#5a46d8"/>`,
  ),
  /** One amber sun. */
  amber: svg(
    `<rect width="600" height="600" fill="#f4e7cf"/><circle cx="300" cy="300" r="190" fill="#f29e1f"/><circle cx="300" cy="300" r="120" fill="#e0611d"/><rect y="440" width="600" height="160" fill="#2a2320"/>`,
  ),
  /** A black sleeve with a single line. */
  mono: svg(
    `<rect width="600" height="600" fill="#141414"/><path d="M60 330 L210 330 L250 220 L300 420 L350 270 L390 330 L540 330" fill="none" stroke="#f2f2f2" stroke-width="10" stroke-linejoin="round"/>`,
  ),
  /** A podcast's square: a microphone on rose. */
  show: svg(
    `<rect width="600" height="600" fill="#ffd6d0"/><rect x="230" y="110" width="140" height="250" rx="70" fill="#d6455d"/><path d="M180 290 a120 120 0 0 0 240 0" fill="none" stroke="#7a1f33" stroke-width="22" stroke-linecap="round"/><rect x="288" y="410" width="24" height="70" fill="#7a1f33"/><rect x="220" y="470" width="160" height="24" rx="12" fill="#7a1f33"/><text x="300" y="560" font-family="Georgia, serif" font-size="44" text-anchor="middle" fill="#7a1f33">Slow History</text>`,
  ),
};

const links = (q: string, podcast = false) => ({
  apple: `https://${podcast ? 'podcasts' : 'music'}.apple.com/us/search?term=${encodeURIComponent(q)}`,
  spotify: `https://open.spotify.com/search/${encodeURIComponent(q)}`,
  ...(!podcast && { youtube: `https://music.youtube.com/search?q=${encodeURIComponent(q)}` }),
});

/** A tone, a few seconds of it, as a WAV the page can play: stories need no files. */
export function tone(seconds = 30, hz = 220): string {
  if (typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
  const rate = 8000;
  const n = Math.floor(seconds * rate);
  const buffer = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // A soft chord that swells and fades with each beat.
    const beat = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
    const s =
      (Math.sin(2 * Math.PI * hz * t) +
        0.6 * Math.sin(2 * Math.PI * hz * 1.25 * t) +
        0.4 * Math.sin(2 * Math.PI * hz * 1.5 * t)) *
      0.12 *
      beat;
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

export function songs(src: (i: number) => string | undefined = () => 'blob:song'): MusicTrack[] {
  const list: Omit<MusicTrack, 'id' | 'src'>[] = [
    {
      kind: 'song',
      title: 'Low Sun, High Water',
      by: 'The Pearl Divers',
      album: 'Tidal Rooms',
      artwork: covers.tide,
      duration: 247,
      released: '2024-05-17',
      genre: 'Indie pop',
    },
    {
      kind: 'song',
      title: 'Kelp Forest (Night Swim)',
      by: 'Marlow & the Undertow',
      album: 'Holdfast',
      artwork: covers.kelp,
      duration: 312,
      released: '2023-02-03',
      genre: 'Ambient',
      explicit: true,
    },
    {
      kind: 'song',
      title: 'Iris',
      by: 'Glasshouse',
      album: 'Prism Days',
      artwork: covers.iris,
      duration: 198,
      released: '2025-09-12',
      genre: 'Synth-pop',
    },
    {
      kind: 'song',
      title: 'Amber Hour',
      by: 'Ola Sund',
      album: 'Amber Hour',
      artwork: covers.amber,
      duration: 221,
      released: '2022-11-25',
      genre: 'Soul',
    },
    {
      kind: 'song',
      title: 'Signal',
      by: 'Northline',
      album: 'Monochrome',
      artwork: covers.mono,
      duration: 275,
      released: '2021-04-09',
      genre: 'Electronic',
    },
    {
      kind: 'song',
      title: 'Low Sun, High Water (Acoustic)',
      by: 'The Pearl Divers',
      album: 'Tidal Rooms (Deluxe)',
      artwork: covers.tide,
      duration: 233,
      released: '2024-08-02',
      genre: 'Indie pop',
    },
    {
      kind: 'song',
      title: 'Undertow',
      by: 'Marlow & the Undertow',
      album: 'Holdfast',
      artwork: covers.kelp,
      duration: 289,
      released: '2023-02-03',
      genre: 'Ambient',
    },
    {
      kind: 'song',
      title: 'A Song With No Preview',
      by: 'Nobody Yet',
      album: 'Unreleased',
      duration: 180,
      released: '2026-01-01',
    },
  ];
  return list.map((t, i) => ({
    ...t,
    id: `song-${i}`,
    ...(i < 7 && src(i) && { src: src(i) }),
    links: links(`${t.title} ${t.by ?? ''}`),
  }));
}

export const episode: MusicTrack = {
  id: 'episode-1',
  kind: 'episode',
  title: 'The Lighthouse Keepers of the North Sea',
  by: 'Slow History',
  artwork: covers.show,
  duration: 2771,
  released: '2026-10-04T11:52:32Z',
  genre: 'History',
  description:
    'Long nights, lamp oil and logbooks: how a handful of families kept the lights burning along the coast for two hundred years, told slowly enough to fall asleep to.',
  src: 'blob:episode',
  whole: true,
  links: links('Slow History lighthouse', true),
};

export const episodes: MusicTrack[] = [
  episode,
  {
    ...episode,
    id: 'episode-2',
    title: 'Salt: An Empire in a Pinch',
    duration: 3310,
    released: '2026-09-27T11:00:00Z',
    description:
      'From Roman wages to Gandhi’s march, the mineral that built roads, taxes and revolutions.',
  },
  {
    ...episode,
    id: 'episode-3',
    title: 'The Year Without a Summer',
    duration: 2405,
    released: '2026-09-20T11:00:00Z',
    description: 'A volcano, a cold June and the bicycle: 1816, the year the sun went missing.',
  },
];

export const albums: MusicTrack[] = [
  {
    id: 'album-1',
    kind: 'album',
    title: 'Tidal Rooms',
    by: 'The Pearl Divers',
    artwork: covers.tide,
    tracks: 11,
    released: '2024-05-17',
    links: links('Tidal Rooms'),
  },
  {
    id: 'album-2',
    kind: 'album',
    title: 'Holdfast',
    by: 'Marlow & the Undertow',
    artwork: covers.kelp,
    tracks: 9,
    released: '2023-02-03',
    explicit: true,
    links: links('Holdfast'),
  },
  {
    id: 'album-3',
    kind: 'album',
    title: 'Prism Days',
    by: 'Glasshouse',
    artwork: covers.iris,
    tracks: 13,
    released: '2025-09-12',
    links: links('Prism Days'),
  },
];

export const shows: MusicTrack[] = [
  {
    id: 'show-1',
    kind: 'podcast',
    title: 'Slow History',
    by: 'Lantern Audio',
    artwork: covers.show,
    tracks: 214,
    genre: 'History',
    links: links('Slow History', true),
  },
  {
    id: 'show-2',
    kind: 'podcast',
    title: 'Kelp & Kin',
    by: 'Tide Line',
    artwork: covers.kelp,
    tracks: 48,
    genre: 'Science',
    links: links('Kelp & Kin', true),
  },
];

/**
 * An `<audio>` that only pretends: it says it plays when asked and keeps the
 * playhead where it's put, so a story or a test can show any moment.
 */
export class PretendAudio extends EventTarget implements AudioLike {
  src = '';
  preload: AudioLike['preload'] = '';
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  playbackRate = 1;
  constructor(private readonly length = 30) {
    super();
  }
  play(): Promise<void> {
    this.paused = false;
    if (Number.isNaN(this.duration)) {
      this.duration = this.length;
      this.dispatchEvent(new Event('durationchange'));
    }
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  load(): void {
    this.duration = Number.NaN;
  }
  removeAttribute(): void {
    this.src = '';
  }
}

/** A player on pretend audio, already at a moment: `at` seconds into `track`, playing or not. */
export function pretendPlayer(
  options: {
    track?: MusicTrack;
    queue?: MusicTrack[];
    card?: string;
    at?: number;
    playing?: boolean;
    rate?: number;
  } = {},
): { player: MusicPlayer; audio: PretendAudio } {
  const audio = new PretendAudio(options.track?.whole ? (options.track.duration ?? 2771) : 30);
  const player = createMusicPlayer(() => audio);
  if (options.track) {
    if (options.rate) player.setRate(options.rate);
    player.play(options.track, { card: options.card, queue: options.queue });
    audio.currentTime = options.at ?? 0;
    if (options.playing === false) player.pause();
    player.seek(options.at ?? 0);
  }
  return { player, audio };
}
