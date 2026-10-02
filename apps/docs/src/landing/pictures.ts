/**
 * Web pages for the browser pictures, drawn as SVG so nothing is fetched and
 * no real site is shown. Their colours are the pretend sites' own, not Nacre's.
 */

const WIDTH = 1280;
const HEIGHT = 800;

function page(body: string, ground = '#fbf8f5'): string {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="${ground}"/>${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

const words = (x: number, y: number, size: number, value: string, fill = '#2b2420', weight = 400) =>
  `<text x="${x}" y="${y}" font-family="system-ui, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${value}</text>`;

/** A place on the page, as a share of its width and height (what the browser components take). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const box = (x: number, y: number, width: number, height: number): Box => ({
  x: x / WIDTH,
  y: y / HEIGHT,
  width: width / WIDTH,
  height: height / HEIGHT,
});

const HOTELS = ['Casa do Rio', 'Alfama Light House', 'Jardim Suites'];
const NOTES = ['River view · Free cancellation', 'Old town · Breakfast included', 'Garden · Pool'];
const PRICES = ['€128', '€96', '€142'];
const TINTS = ['#c9d8e8', '#e8d6c3', '#d4e3d2'];

/** A hotel search: a box to search in, and three places to stay. */
export const hotels = page(
  [
    '<rect width="1280" height="72" fill="#1f3b73"/>',
    words(40, 46, 26, 'Staylight', '#ffffff', 700),
    '<rect x="40" y="104" width="1200" height="64" rx="12" fill="#ffffff" stroke="#e0d8d0"/>',
    words(64, 144, 20, 'Lisbon · 12–15 Oct · 2 guests', '#4b423c'),
    '<rect x="1060" y="112" width="164" height="48" rx="10" fill="#e8743b"/>',
    words(1102, 143, 19, 'Search', '#ffffff', 600),
    ...HOTELS.map((name, i) =>
      [
        `<rect x="40" y="${200 + i * 190}" width="1200" height="170" rx="14" fill="#ffffff" stroke="#ece5de"/>`,
        `<rect x="56" y="${216 + i * 190}" width="220" height="138" rx="10" fill="${TINTS[i]}"/>`,
        words(300, 252 + i * 190, 24, name, '#2b2420', 600),
        words(300, 286 + i * 190, 17, NOTES[i] ?? '', '#6f6660'),
        words(1080, 300 + i * 190, 26, PRICES[i] ?? '', '#2b2420', 700),
        `<rect x="1060" y="${316 + i * 190}" width="156" height="36" rx="8" fill="#1f3b73"/>`,
        words(1088, 340 + i * 190, 16, 'See availability', '#ffffff', 600),
      ].join(''),
    ),
  ].join(''),
);

export const hotelsSearch = box(1060, 112, 164, 48);
export const hotelsSecond = box(1060, 506, 156, 36);

/** The page that asks for money: a total, and one button that spends it. */
export const checkout = page(
  [
    '<rect width="1280" height="72" fill="#1f3b73"/>',
    words(40, 46, 26, 'Staylight', '#ffffff', 700),
    words(40, 132, 34, 'Review your stay', '#2b2420', 600),
    '<rect x="40" y="164" width="760" height="320" rx="14" fill="#ffffff" stroke="#ece5de"/>',
    '<rect x="64" y="188" width="160" height="120" rx="10" fill="#e8d6c3"/>',
    words(248, 228, 22, 'Alfama Light House', '#2b2420', 600),
    words(248, 262, 17, '12–15 Oct · 2 guests · Breakfast included', '#6f6660'),
    words(248, 296, 17, 'Free cancellation until 10 Oct', '#6f6660'),
    '<rect x="840" y="164" width="400" height="320" rx="14" fill="#ffffff" stroke="#ece5de"/>',
    words(868, 214, 20, 'Total for 3 nights', '#6f6660'),
    words(868, 262, 38, '€288', '#2b2420', 700),
    '<rect x="868" y="390" width="344" height="60" rx="12" fill="#e8743b"/>',
    words(968, 428, 22, 'Book and pay', '#ffffff', 700),
  ].join(''),
);

export const checkoutPay = box(868, 390, 344, 60);
