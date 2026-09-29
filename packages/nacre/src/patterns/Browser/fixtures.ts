/* Story/test fixtures — not exported from the package. Pages are drawn as SVG: nothing is fetched. */
import type { BrowserTrailStep } from './BrowserTrail';

function svg(body: string, bg = '#fbf8f5'): string {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800"><rect width="1280" height="800" fill="${bg}"/>${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

const text = (x: number, y: number, size: number, value: string, fill = '#2b2420', weight = 400) =>
  `<text x="${x}" y="${y}" font-family="system-ui, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${value}</text>`;

/** A hotel search results page. */
export const hotelsPage = svg(
  [
    '<rect width="1280" height="72" fill="#1f3b73"/>',
    text(40, 46, 26, 'Staylight', '#ffffff', 700),
    '<rect x="40" y="104" width="1200" height="64" rx="12" fill="#ffffff" stroke="#e0d8d0"/>',
    text(64, 144, 20, 'Lisbon · 12–15 Oct · 2 guests', '#4b423c'),
    '<rect x="1060" y="112" width="164" height="48" rx="10" fill="#e8743b"/>',
    text(1102, 143, 19, 'Search', '#ffffff', 600),
    ...[0, 1, 2].map((i) =>
      [
        `<rect x="40" y="${200 + i * 190}" width="1200" height="170" rx="14" fill="#ffffff" stroke="#ece5de"/>`,
        `<rect x="56" y="${216 + i * 190}" width="220" height="138" rx="10" fill="${['#c9d8e8', '#e8d6c3', '#d4e3d2'][i]}"/>`,
        text(
          300,
          252 + i * 190,
          24,
          ['Casa do Rio', 'Alfama Light House', 'Jardim Suites'][i] ?? '',
          '#2b2420',
          600,
        ),
        text(
          300,
          286 + i * 190,
          17,
          ['River view · Free cancellation', 'Old town · Breakfast included', 'Garden · Pool'][i] ??
            '',
          '#6f6660',
        ),
        text(1080, 300 + i * 190, 26, ['€128', '€96', '€142'][i] ?? '', '#2b2420', 700),
        `<rect x="1060" y="${316 + i * 190}" width="156" height="36" rx="8" fill="#1f3b73"/>`,
        text(1088, 340 + i * 190, 16, 'See availability', '#ffffff', 600),
      ].join(''),
    ),
  ].join(''),
);

/** A checkout page with a "Place order" button. */
export const checkoutPage = svg(
  [
    '<rect width="1280" height="72" fill="#232f3e"/>',
    text(40, 46, 26, 'Shopwise', '#ffffff', 700),
    text(40, 132, 34, 'Review your order', '#2b2420', 600),
    '<rect x="40" y="164" width="760" height="360" rx="14" fill="#ffffff" stroke="#ece5de"/>',
    '<rect x="64" y="188" width="120" height="120" rx="10" fill="#e9dccb"/>',
    text(208, 228, 22, 'Pearl ceramic mug, 350 ml', '#2b2420', 600),
    text(208, 262, 17, 'Qty 2 · Arrives Thursday', '#6f6660'),
    '<rect x="840" y="164" width="400" height="360" rx="14" fill="#ffffff" stroke="#ece5de"/>',
    text(868, 214, 20, 'Order total', '#6f6660'),
    text(868, 262, 38, '£24.00', '#2b2420', 700),
    '<rect x="868" y="424" width="344" height="64" rx="12" fill="#f0a93b"/>',
    text(975, 464, 22, 'Place order', '#2b2420', 700),
  ].join(''),
);

/** A sign-in page. */
export const signInPage = svg(
  [
    '<rect x="440" y="140" width="400" height="480" rx="20" fill="#ffffff" stroke="#e6ded6"/>',
    '<circle cx="640" cy="220" r="32" fill="#e6dff5"/>',
    text(560, 300, 28, 'Sign in', '#2b2420', 600),
    '<rect x="480" y="340" width="320" height="52" rx="10" fill="#ffffff" stroke="#cfc6be"/>',
    text(500, 373, 17, 'ada@example.com', '#4b423c'),
    '<rect x="480" y="410" width="320" height="52" rx="10" fill="#ffffff" stroke="#8f7fd0" stroke-width="2"/>',
    text(500, 443, 17, 'Password', '#9a8f88'),
    '<rect x="480" y="490" width="320" height="52" rx="10" fill="#5b4bb7"/>',
    text(605, 523, 18, 'Continue', '#ffffff', 600),
  ].join(''),
  '#f3f0fa',
);

/** Box of the checkout page's "Place order" button, 0–1 of the viewport. */
export const placeOrderBox = { x: 868 / 1280, y: 424 / 800, width: 344 / 1280, height: 64 / 800 };
/** Box of the hotels page's first "See availability" button. */
export const availabilityBox = {
  x: 1060 / 1280,
  y: 316 / 800,
  width: 156 / 1280,
  height: 36 / 800,
};
/** Box of the sign-in page's password field. */
export const passwordBox = { x: 480 / 1280, y: 410 / 800, width: 320 / 1280, height: 52 / 800 };

export const trailSteps: BrowserTrailStep[] = [
  {
    id: 's1',
    status: 'done',
    label: 'Opened staylight.example',
    url: 'https://www.staylight.example/',
    shot: hotelsPage,
  },
  {
    id: 's2',
    status: 'done',
    label: 'Typed in “Where are you going?”',
    url: 'https://www.staylight.example/',
    shot: hotelsPage,
  },
  {
    id: 's3',
    status: 'done',
    label: 'Clicked “Search”',
    url: 'https://www.staylight.example/lisbon',
    shot: hotelsPage,
  },
  {
    id: 's4',
    status: 'done',
    label: 'Read the page',
    url: 'https://www.staylight.example/lisbon',
    shot: hotelsPage,
  },
  {
    id: 's5',
    status: 'running',
    label: 'Clicking “See availability”',
    url: 'https://www.staylight.example/lisbon',
  },
];
