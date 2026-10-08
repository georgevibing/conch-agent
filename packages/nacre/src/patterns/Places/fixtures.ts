/**
 * Made-up places for stories and tests, on a drawn map: the tiles are SVG
 * pictures of an imaginary neighbourhood in the colours of OpenStreetMap's
 * own style, drawn here, so nothing loads from the network. Nobody and
 * nothing here is real, though the points sit near Green Park in London.
 */
import type { Place, PlacesMosaic } from './Places';

/** The grid the made-up places sit on: 3 × 2 tiles at zoom 16. */
export const GRID = { zoom: 16, x: 32741, y: 21791, cols: 3, rows: 2 } as const;
export const ORIGIN = { name: 'The Grand Hotel', lat: 51.50715, lon: -0.14168 };

const W = GRID.cols * 256,
  H = GRID.rows * 256;

/** The whole drawn neighbourhood, once; each tile is a window onto it. */
function scene(): string {
  const blocks: string[] = [];
  // City blocks between the streets, a little irregular so it reads as a town.
  for (let row = 0; row < 9; row++)
    for (let col = 0; col < 13; col++) {
      const x = col * 62 + ((row * 17) % 23) - 10,
        y = row * 60 + ((col * 13) % 19) - 12;
      const w = 44 + ((row + col * 3) % 4) * 3,
        h = 40 + ((col + row * 5) % 3) * 4;
      blocks.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#e3dbd2"/>`);
      if ((row + col) % 3 === 0)
        blocks.push(
          `<rect x="${x + 6}" y="${y + 6}" width="${w / 2 - 6}" height="${h / 2 - 4}" rx="1" fill="#d9cfc6"/>`,
        );
    }
  const minor = [
    'M0 110 L768 92',
    'M0 232 L768 214',
    'M0 352 L520 340',
    'M120 0 L104 512',
    'M300 0 L292 300',
    'M470 0 L480 512',
    'M640 0 L626 512',
    'M560 130 L700 260',
  ];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#f2efe9"/>`,
    ...blocks,
    // The park, its paths and its pond.
    '<path d="M-10 300 L260 262 L330 512 L-10 512 Z" fill="#cdebb0"/>',
    '<path d="M0 470 C80 420 160 400 300 380" stroke="#f6f1df" stroke-width="3" fill="none"/>',
    '<path d="M40 300 C90 360 120 420 160 512" stroke="#f6f1df" stroke-width="3" fill="none"/>',
    '<ellipse cx="96" cy="430" rx="38" ry="16" fill="#aad3df"/>',
    // A square with its garden.
    '<rect x="512" y="268" width="96" height="66" rx="6" fill="#cdebb0"/>',
    // Side streets: white with a soft edge.
    ...minor.map(
      (d) =>
        `<path d="${d}" stroke="#d6cfc6" stroke-width="9" fill="none" stroke-linecap="round"/>`,
    ),
    ...minor.map(
      (d) =>
        `<path d="${d}" stroke="#ffffff" stroke-width="6.5" fill="none" stroke-linecap="round"/>`,
    ),
    // The main road along the park, and one across.
    '<path d="M-10 296 L270 258 L780 196" stroke="#d6a76e" stroke-width="14" fill="none"/>',
    '<path d="M-10 296 L270 258 L780 196" stroke="#fcd6a4" stroke-width="11" fill="none"/>',
    '<path d="M390 -10 L410 520" stroke="#d6c58a" stroke-width="11" fill="none"/>',
    '<path d="M390 -10 L410 520" stroke="#f7fabf" stroke-width="8" fill="none"/>',
    '<g font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#6f6a64" letter-spacing="0.3">',
    '<text x="560" y="214" transform="rotate(-7 560 214)">Grand Street</text>',
    '<text x="60" y="292" transform="rotate(-7 60 292)">Grand Street</text>',
    '<text x="402" y="150" transform="rotate(88 402 150)">Long Road</text>',
    '<text x="150" y="88" font-size="9">Mill Lane</text>',
    '<text x="70" y="368" font-size="11" fill="#5f8a4a" font-style="italic">The Green</text>',
    '</g>',
    '</svg>',
  ].join('');
}

/** One tile of the drawn neighbourhood, as a same-origin picture. */
export function drawnTiles(): string[] {
  const whole = scene();
  return Array.from({ length: GRID.cols * GRID.rows }, (_, i) => {
    const col = i % GRID.cols,
      row = Math.floor(i / GRID.cols);
    const svg = whole.replace(
      `viewBox="0 0 ${W} ${H}"`,
      `viewBox="${col * 256} ${row * 256} 256 256" width="256" height="256"`,
    );
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  });
}

export const MOSAIC: PlacesMosaic = { ...GRID, tiles: drawnTiles() };

const directions = (lat: number, lon: number) => ({
  apple: `https://maps.apple.com/?daddr=${lat},${lon}`,
  google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
  osm: `https://www.openstreetmap.org/directions?to=${lat},${lon}`,
});

const place = (p: Omit<Place, 'url' | 'directions'> & { id: number }): Place => {
  const { id, ...rest } = p;
  return {
    ...rest,
    url: `https://www.openstreetmap.org/node/${id}`,
    directions: directions(p.lat, p.lon),
  };
};

export const CAFES: Place[] = [
  place({
    id: 101,
    name: 'Kiosk on the Green',
    category: 'cafe',
    lat: 51.5066,
    lon: -0.1427,
    distance: 120,
    hours: 'Mo-Su 07:30-18:00',
    openNow: { open: true, at: '18:00' },
    wheelchair: 'yes',
  }),
  place({
    id: 102,
    name: 'Little Copper Coffee',
    category: 'cafe',
    lat: 51.5081,
    lon: -0.1405,
    distance: 180,
    address: '12 Grand Street, London W1J 9AA',
    hours: 'Mo-Fr 07:00-18:00; Sa 08:00-16:00; Su off',
    openNow: { open: true, at: '18:00' },
    website: 'https://example.org/copper',
    phone: '+44 20 0000 0101',
    cuisine: 'coffee shop',
    wheelchair: 'limited',
  }),
  place({
    id: 103,
    name: 'Arcade Espresso Bar',
    category: 'cafe',
    lat: 51.5089,
    lon: -0.1385,
    distance: 260,
    address: '3 The Arcade, London W1J 0AB',
    hours: 'Mo-Sa 08:00-17:30',
    openNow: { open: true, at: '17:30' },
    cuisine: 'coffee shop',
  }),
  place({
    id: 104,
    name: 'The Long Room',
    category: 'cafe',
    lat: 51.5064,
    lon: -0.1387,
    distance: 300,
    hours: 'Mo-Fr 09:00-15:00',
    openNow: { open: false, at: '09:00', day: 'Mon' },
    cuisine: 'tea, cake',
  }),
  place({
    id: 105,
    name: 'Mill Lane Bakery & Café',
    category: 'bakery',
    lat: 51.5097,
    lon: -0.1442,
    distance: 340,
    hours: 'Mo-Su 06:30-20:00',
    openNow: { open: true, at: '20:00' },
  }),
  place({
    id: 106,
    name: 'Sakura Tea House',
    category: 'cafe',
    lat: 51.5108,
    lon: -0.135,
    distance: 410,
    hours: '24/7',
    openNow: { open: true, always: true },
    cuisine: 'japanese',
  }),
  place({
    id: 107,
    name: 'Corner Roasters',
    category: 'cafe',
    lat: 51.5102,
    lon: -0.1369,
    distance: 470,
    hours: 'by appointment',
  }),
  place({
    id: 108,
    name: 'Brew & Bloom',
    category: 'cafe',
    lat: 51.5112,
    lon: -0.1462,
    distance: 520,
    hours: 'Mo-Fr 08:00-16:00',
    openNow: { open: false, at: '08:00', day: 'Thu' },
  }),
];

export const MUSEUM: Place = place({
  id: 201,
  name: 'Museum of Small Things',
  category: 'museum',
  lat: 51.5074,
  lon: -0.1412,
  address: '1 Long Road, St James’s, London, W1J 0AA, United Kingdom',
  hours: 'Tu-Su 10:00-17:30; Mo off',
  openNow: { open: true, at: '17:30' },
  website: 'https://example.org/small-things',
  phone: '+44 20 0000 0201',
  wheelchair: 'yes',
});
