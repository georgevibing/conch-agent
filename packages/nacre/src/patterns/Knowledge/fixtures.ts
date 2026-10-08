/**
 * Stand-ins for stories and tests: pictures drawn as data URLs so nothing is
 * fetched, and words in the shape the services give them.
 */
import type { ShelfBook } from './BookShelf';
import type { KnowledgeCardProps } from './KnowledgeCard';
import type { LinkCardItem } from './LinkCards';
import type { ShowCardItem } from './ShowCards';
import type { CardPicture } from './shared';

/** One of a list, for a story that needs exactly that one. */
function pick<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`No fixture at ${index}.`);
  return item;
}

const svg = (w: number, h: number, body: string): CardPicture => ({
  src: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  )}`,
  width: w,
  height: h,
});

/** A painted portrait: a sitter in a dark gown against a warm ground. */
export const portrait = svg(
  600,
  760,
  `<defs>
<radialGradient id="g" cx=".45" cy=".35" r=".8"><stop offset="0" stop-color="#8a6a4a"/><stop offset=".6" stop-color="#3d2c22"/><stop offset="1" stop-color="#1c1410"/></radialGradient>
<linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3550"/><stop offset="1" stop-color="#121624"/></linearGradient>
<radialGradient id="f" cx=".45" cy=".4" r=".6"><stop offset="0" stop-color="#f1d2b8"/><stop offset="1" stop-color="#c79a7c"/></radialGradient>
</defs>
<rect width="600" height="760" fill="url(#g)"/>
<path d="M90 760 C110 560 200 500 300 500 S500 560 520 760Z" fill="url(#d)"/>
<path d="M230 520 Q300 600 370 520 L360 500 Q300 560 240 500Z" fill="#e9e1d6" opacity=".85"/>
<ellipse cx="300" cy="360" rx="92" ry="118" fill="url(#f)"/>
<path d="M200 330 C200 220 260 190 305 190 S410 230 400 340 C390 280 350 250 300 252 S215 280 200 330Z" fill="#2a1a12"/>
<path d="M205 330 C180 400 200 440 225 455 C215 400 215 360 225 330Z" fill="#2a1a12"/>
<path d="M395 330 C420 400 400 440 375 455 C385 400 385 360 375 330Z" fill="#2a1a12"/>`,
);

/** A city at golden hour, over the water. */
export const landscape = svg(
  1600,
  900,
  `<defs>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26406b"/><stop offset=".55" stop-color="#e59a6b"/><stop offset="1" stop-color="#f6d3a1"/></linearGradient>
<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6f93"/><stop offset="1" stop-color="#1d2a44"/></linearGradient>
</defs>
<rect width="1600" height="900" fill="url(#s)"/>
<circle cx="1180" cy="520" r="70" fill="#fff1cf" opacity=".9"/>
<path d="M0 560 L80 540 L80 470 L130 470 L130 520 L200 505 L200 430 L230 400 L260 430 L260 520 L340 500 L340 455 L420 455 L420 515 L520 490 L520 380 L545 330 L570 380 L570 500 L660 520 L660 470 L760 470 L760 530 L880 510 L880 450 L960 420 L1040 450 L1040 540 L1160 560 L1280 520 L1280 470 L1360 470 L1360 545 L1480 530 L1480 490 L1600 480 L1600 900 L0 900Z" fill="#3a2a3e" opacity=".92"/>
<rect y="600" width="1600" height="300" fill="url(#w)"/>
<path d="M1060 640 h240 M1100 680 h170 M1130 720 h110" stroke="#ffe2b0" stroke-width="6" stroke-linecap="round" opacity=".6"/>`,
);

const tile = (bg: string, fg: string, letter: string) =>
  svg(
    64,
    64,
    `<rect width="64" height="64" rx="14" fill="${bg}"/><text x="32" y="44" font-family="Georgia,serif" font-size="38" font-weight="700" text-anchor="middle" fill="${fg}">${letter}</text>`,
  ).src;

export const icons = {
  wikipedia: tile('#f3f3f3', '#111', 'W'),
  journal: tile('#0c3b5e', '#fff', 'Q'),
  tube: tile('#e8322b', '#fff', '▶'),
  forge: tile('#1f2328', '#fff', 'G'),
  shop: tile('#2e7d5b', '#fff', 'K'),
};

export const ada: KnowledgeCardProps = {
  title: 'Ada Lovelace',
  description: 'English mathematician and writer (1815–1852)',
  extract:
    'Augusta Ada King, Countess of Lovelace (née Byron; 10 December 1815 – 27 November 1852) was an English mathematician and writer chiefly known for her work on Charles Babbage’s proposed mechanical general-purpose computer, the Analytical Engine. She was the first to recognise that the machine had applications beyond pure calculation.\n\nLovelace’s notes on the engine include what is often described as the first computer program: an algorithm for the engine to compute Bernoulli numbers. She also developed a vision of the capability of computers to go beyond mere calculating or number-crunching, while many others, including Babbage himself, focused only on those capabilities.',
  picture: portrait,
  url: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
  lang: 'en',
  sourceIcon: icons.wikipedia,
  facts: [
    { label: 'Born', value: '10 December 1815, London' },
    { label: 'Died', value: '27 November 1852, Marylebone' },
    { label: 'Known for', value: 'Mathematics, computing' },
    { label: 'Parents', value: 'Lord Byron, Anne Isabella Milbanke' },
  ],
  related: [
    { title: 'Analytical Engine', url: 'https://en.wikipedia.org/wiki/Analytical_Engine' },
    { title: 'Charles Babbage', url: 'https://en.wikipedia.org/wiki/Charles_Babbage' },
  ],
};

export const lisbon: KnowledgeCardProps = {
  title: 'Lisbon',
  description: 'Capital and largest city of Portugal',
  extract:
    'Lisbon is the capital and largest city of Portugal, with an estimated population of 567,131 within its administrative limits. Lisbon lies on the northern shore of the Tagus estuary, where the river meets the Atlantic Ocean. It is one of the oldest cities in Western Europe, predating other modern European capitals by centuries.',
  picture: landscape,
  url: 'https://en.wikipedia.org/wiki/Lisbon',
  lang: 'en',
  sourceIcon: icons.wikipedia,
  facts: [
    { label: 'Country', value: 'Portugal' },
    { label: 'Population', value: '567,131 (2023)' },
    { label: 'Area', value: '100.05 km²' },
    { label: 'Founded', value: 'c. 1200 BC' },
    { label: 'Elevation', value: '2 m' },
    { label: 'Time zone', value: 'WET (UTC+0)' },
  ],
  related: [
    { title: 'Tagus', url: 'https://en.wikipedia.org/wiki/Tagus' },
    { title: 'Alfama', url: 'https://en.wikipedia.org/wiki/Alfama' },
  ],
};

const hero = (a: string, b: string, c: string) =>
  svg(
    1200,
    630,
    `<defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#h)"/>
<circle cx="900" cy="180" r="220" fill="${c}" opacity=".35"/>
<circle cx="260" cy="520" r="300" fill="${c}" opacity=".18"/>
<rect x="120" y="190" width="520" height="34" rx="17" fill="#fff" opacity=".75"/>
<rect x="120" y="250" width="380" height="34" rx="17" fill="#fff" opacity=".5"/>`,
  );

export const links: LinkCardItem[] = [
  {
    url: 'https://quarterly.example/2026/10/tides-of-the-tagus',
    title: 'The tides of the Tagus: how Lisbon learned to live with its river',
    site: 'The Quarterly',
    description:
      'For three thousand years the city has faced the estuary. A new flood plan asks it to give some of the shore back, and the neighbourhoods closest to the water are split on what that means.',
    picture: hero('#16324f', '#3f7f9a', '#f3c78b'),
    icon: icons.journal,
    published: '2026-10-06T08:00:00Z',
    author: 'Marta Sousa',
    kind: 'article',
  },
  {
    url: 'https://tube.example/watch?v=tram28',
    title: 'Riding tram 28 end to end, in real time',
    site: 'Tube',
    description: 'Forty minutes across Alfama, Graça and Estrela, without a word.',
    picture: hero('#3a2340', '#c4604c', '#ffd9a0'),
    icon: icons.tube,
    published: '2026-09-21T17:30:00Z',
    kind: 'video',
  },
  {
    url: 'https://forge.example/tidekit/tidekit',
    title: 'tidekit/tidekit: tide predictions from harmonic constants',
    site: 'forge.example',
    description: 'A small library that predicts the tide anywhere you have constants for.',
    icon: icons.forge,
    kind: 'repo',
  },
  {
    url: 'https://kettle.example/products/azulejo-kettle',
    title: 'Azulejo kettle, 1.2 l',
    site: 'Kettle & Co',
    description: 'Glazed stoneware, hand painted in Sacavém.',
    picture: hero('#1f4e8c', '#e8eef7', '#ffffff'),
    icon: icons.shop,
    kind: 'product',
  },
];

const cover = (bg: string, ink: string, title: string, author: string, motif: string) =>
  svg(
    400,
    600,
    `<rect width="400" height="600" fill="${bg}"/>${motif}
<text x="200" y="${title.length > 18 ? 132 : 150}" font-family="Georgia,serif" font-size="40" text-anchor="middle" fill="${ink}">${title
      .split(' / ')
      .map((line, i) => `<tspan x="200" dy="${i ? 46 : 0}">${line}</tspan>`)
      .join('')}</text>
<text x="200" y="540" font-family="Helvetica,Arial,sans-serif" font-size="20" letter-spacing="4" text-anchor="middle" fill="${ink}" opacity=".85">${author}</text>`,
  );

export const books: ShelfBook[] = [
  {
    title: 'The Left Hand of Darkness',
    authors: ['Ursula K. Le Guin'],
    year: 1969,
    cover: cover(
      '#e9e2d0',
      '#2a2a2a',
      'The Left Hand / of Darkness',
      'LE GUIN',
      '<circle cx="200" cy="350" r="110" fill="#1d1d1d"/><circle cx="235" cy="335" r="100" fill="#e9e2d0"/>',
    ),
    pages: 304,
    subjects: ['Science fiction', 'Gender', 'Winter'],
    url: 'https://openlibrary.org/works/OL59852W',
    rating: 4.1,
    ratings: 1203,
  },
  {
    title: 'A Wizard of Earthsea',
    authors: ['Ursula K. Le Guin'],
    year: 1968,
    cover: cover(
      '#173a4a',
      '#f4e7c5',
      'A Wizard / of Earthsea',
      'LE GUIN',
      '<path d="M0 420 Q100 380 200 420 T400 420 V600 H0Z" fill="#0d2430"/><circle cx="290" cy="300" r="40" fill="#f4e7c5" opacity=".8"/>',
    ),
    pages: 183,
    subjects: ['Fantasy', 'Magic', 'Coming of age'],
    url: 'https://openlibrary.org/works/OL59863W',
    rating: 4.0,
    ratings: 2410,
  },
  {
    title: 'The Dispossessed',
    authors: ['Ursula K. Le Guin'],
    year: 1974,
    cover: cover(
      '#b5432e',
      '#fff3e3',
      'The / Dispossessed',
      'LE GUIN',
      '<circle cx="140" cy="360" r="70" fill="#fff3e3" opacity=".9"/><circle cx="270" cy="400" r="46" fill="#5a1a10"/>',
    ),
    pages: 387,
    subjects: ['Utopias', 'Anarchism'],
    url: 'https://openlibrary.org/works/OL59849W',
    rating: 4.2,
    ratings: 980,
  },
  {
    title: 'The Lathe of Heaven',
    authors: ['Ursula K. Le Guin'],
    year: 1971,
    pages: 184,
    subjects: ['Dreams', 'Science fiction'],
    url: 'https://openlibrary.org/works/OL59856W',
    rating: 3.9,
    ratings: 610,
  },
  {
    title: 'Tehanu',
    authors: ['Ursula K. Le Guin'],
    year: 1990,
    cover: cover(
      '#4b5d3a',
      '#f1ecd8',
      'Tehanu',
      'LE GUIN',
      '<path d="M120 420 C160 300 240 300 280 420Z" fill="#f1ecd8" opacity=".25"/>',
    ),
    pages: 252,
    url: 'https://openlibrary.org/works/OL59858W',
  },
  {
    title: 'The Word for World Is Forest',
    authors: ['Ursula K. Le Guin'],
    year: 1972,
    cover: cover(
      '#1f3b2c',
      '#e6f0dc',
      'The Word for / World Is Forest',
      'LE GUIN',
      '<path d="M200 260 L120 470 H280Z" fill="#2f6b45"/><path d="M200 300 L140 470 H260Z" fill="#3f8a59"/>',
    ),
    pages: 189,
    url: 'https://openlibrary.org/works/OL59867W',
    rating: 3.8,
    ratings: 220,
  },
];

const poster = (a: string, b: string, title: string, motif: string) =>
  svg(
    680,
    1000,
    `<defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="680" height="1000" fill="url(#p)"/>${motif}
<text x="340" y="900" font-family="Helvetica,Arial,sans-serif" font-size="64" font-weight="700" letter-spacing="6" text-anchor="middle" fill="#fff">${title}</text>`,
  );

/** Pinned "now" for stories: Thursday 8 October 2026, noon UTC. */
export const NOW = Date.UTC(2026, 9, 8, 12);

export const shows: ShowCardItem[] = [
  {
    title: 'Lowtide',
    kind: 'tv',
    year: 2024,
    poster: poster(
      '#0f2a3f',
      '#2f7d8f',
      'LOWTIDE',
      '<circle cx="340" cy="380" r="170" fill="#f5d9a6" opacity=".9"/><path d="M0 560 Q170 520 340 560 T680 560 V1000 H0Z" fill="#0b1e2c"/>',
    ),
    genres: ['Drama', 'Mystery'],
    rating: 8.4,
    network: 'Harbour+',
    status: 'Running',
    summary:
      'When the tide goes out further than anyone has ever seen, a fishing town finds what the sea has been keeping, and who put it there.',
    next: { at: '2026-10-11T02:00:00Z', season: 3, number: 4, name: 'Neap' },
    url: 'https://www.tvmaze.com/shows/1/lowtide',
  },
  {
    title: 'The Night Ferry',
    kind: 'tv',
    year: 2021,
    poster: poster(
      '#1a1430',
      '#5d3a6e',
      'NIGHT FERRY',
      '<rect x="180" y="420" width="320" height="90" rx="20" fill="#f2c46d"/><rect x="230" y="370" width="200" height="60" rx="12" fill="#f8e2a8"/>',
    ),
    genres: ['Thriller'],
    rating: 7.6,
    network: 'BBC One',
    status: 'Ended',
    url: 'https://www.tvmaze.com/shows/2/the-night-ferry',
  },
  {
    title: 'Saltwater Kitchen',
    kind: 'tv',
    year: 2019,
    poster: poster(
      '#7a3b1f',
      '#e3925b',
      'SALTWATER',
      '<circle cx="340" cy="420" r="150" fill="#fff4e2"/><circle cx="340" cy="420" r="90" fill="#e3925b"/>',
    ),
    genres: ['Food', 'Travel'],
    rating: 8.1,
    network: 'Channel 4',
    status: 'Running',
    next: { at: '2026-10-08T19:00:00Z', season: 6, number: 2 },
    url: 'https://www.tvmaze.com/shows/3/saltwater-kitchen',
  },
  {
    title: 'Paper Lanterns',
    kind: 'tv',
    year: 2025,
    genres: ['Animation', 'Family'],
    rating: 7.9,
    network: 'Streamly',
    status: 'Running',
    next: { at: '2026-10-29T08:00:00Z', season: 2, number: 1 },
    url: 'https://www.tvmaze.com/shows/4/paper-lanterns',
  },
  {
    title: 'Glasswork',
    kind: 'tv',
    year: 2017,
    poster: poster(
      '#203a2f',
      '#6aa58b',
      'GLASSWORK',
      '<path d="M340 250 L470 520 L340 640 L210 520Z" fill="#d7f0e4" opacity=".75"/>',
    ),
    genres: ['Documentary'],
    rating: 6.8,
    network: 'PBS',
    status: 'Ended',
    url: 'https://www.tvmaze.com/shows/5/glasswork',
  },
];

export const [quarterly, tram, tidekit] = [0, 1, 2].map((i) => pick(links, i)) as [
  LinkCardItem,
  LinkCardItem,
  LinkCardItem,
];
export const [leftHand, wizard, , lathe] = books.map((_, i) => pick(books, i)) as [
  ShelfBook,
  ShelfBook,
  ShelfBook,
  ShelfBook,
];
export const [lowtide, nightFerry] = [0, 1].map((i) => pick(shows, i)) as [
  ShowCardItem,
  ShowCardItem,
];
