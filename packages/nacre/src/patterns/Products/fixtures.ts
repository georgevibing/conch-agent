import type { ShelfPicture, ShelfProduct } from './ProductCard';

/**
 * Stand-in product photos, drawn as data URLs so stories need no files. Each
 * sits on a shop's white backdrop, as real ones do, to show it melting into
 * the porcelain.
 */
const svg = (w: number, h: number, body: string): ShelfPicture => ({
  src: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>`,
  )}`,
  width: w,
  height: h,
});

const kettle = (tone: string, handle = '#1d1d1f') =>
  svg(
    800,
    800,
    `<defs><linearGradient id="k" x1="0" x2="1"><stop offset="0" stop-color="${tone}" stop-opacity=".75"/><stop offset=".35" stop-color="${tone}"/><stop offset=".7" stop-color="${tone}" stop-opacity=".85"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient></defs>
<ellipse cx="400" cy="672" rx="230" ry="22" fill="#000" opacity=".08"/>
<path d="M232 330 Q232 300 262 296 L538 296 Q568 300 568 330 L590 640 Q592 664 566 664 L234 664 Q208 664 210 640Z" fill="url(#k)"/>
<path d="M230 330 L130 220 Q118 206 128 198 L142 190 Q152 186 162 196 L262 300" fill="none" stroke="url(#k)" stroke-width="22" stroke-linecap="round"/>
<path d="M568 360 Q680 360 680 470 Q680 580 572 590" fill="none" stroke="${handle}" stroke-width="30" stroke-linecap="round"/>
<rect x="300" y="268" width="200" height="34" rx="10" fill="${handle}"/>
<circle cx="400" cy="250" r="22" fill="${handle}"/>
<rect x="250" y="620" width="300" height="10" rx="5" fill="#fff" opacity=".25"/>`,
  );

const headphones = (tone: string) =>
  svg(
    900,
    800,
    `<ellipse cx="450" cy="700" rx="260" ry="20" fill="#000" opacity=".07"/>
<path d="M210 470 Q210 150 450 150 Q690 150 690 470" fill="none" stroke="${tone}" stroke-width="44" stroke-linecap="round"/>
<path d="M226 440 Q226 190 450 190 Q674 190 674 440" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="10"/>
<rect x="150" y="410" width="150" height="250" rx="70" fill="${tone}"/>
<rect x="600" y="410" width="150" height="250" rx="70" fill="${tone}"/>
<rect x="178" y="440" width="94" height="190" rx="46" fill="#000" opacity=".22"/>
<rect x="628" y="440" width="94" height="190" rx="46" fill="#000" opacity=".22"/>`,
  );

const sneaker = (tone: string, accent: string) =>
  svg(
    1000,
    700,
    `<ellipse cx="500" cy="590" rx="380" ry="22" fill="#000" opacity=".08"/>
<path d="M120 520 Q110 420 200 400 L420 300 Q470 250 520 300 L640 400 Q820 420 880 480 Q910 540 860 560 L160 570 Q120 566 120 520Z" fill="${tone}"/>
<path d="M120 520 L880 520 Q900 560 860 572 L160 580 Q118 576 120 520Z" fill="#f4f4f2" stroke="#ddd" stroke-width="4"/>
<path d="M300 430 Q450 380 640 440" fill="none" stroke="${accent}" stroke-width="26" stroke-linecap="round"/>
<g stroke="#fff" stroke-width="8" stroke-linecap="round"><path d="M420 330 L470 360"/><path d="M445 310 L500 340"/><path d="M470 292 L525 322"/></g>`,
  );

const lamp = (tone: string) =>
  svg(
    700,
    900,
    `<ellipse cx="350" cy="820" rx="170" ry="18" fill="#000" opacity=".08"/>
<rect x="210" y="780" width="280" height="36" rx="18" fill="#2b2b2b"/>
<rect x="338" y="360" width="24" height="430" fill="#3a3a3a"/>
<path d="M190 380 L250 140 L450 140 L510 380Z" fill="${tone}"/>
<path d="M250 140 L450 140 L470 220 L230 220Z" fill="#fff" opacity=".22"/>`,
  );

const backpack = (tone: string) =>
  svg(
    700,
    900,
    `<ellipse cx="350" cy="830" rx="220" ry="20" fill="#000" opacity=".08"/>
<path d="M260 150 Q260 90 350 90 Q440 90 440 150" fill="none" stroke="#333" stroke-width="22"/>
<rect x="150" y="140" width="400" height="680" rx="120" fill="${tone}"/>
<rect x="210" y="470" width="280" height="260" rx="60" fill="#000" opacity=".16"/>
<rect x="250" y="250" width="200" height="22" rx="11" fill="#000" opacity=".2"/>`,
  );

const watch = (tone: string) =>
  svg(
    700,
    900,
    `<ellipse cx="350" cy="840" rx="150" ry="16" fill="#000" opacity=".08"/>
<rect x="250" y="40" width="200" height="300" rx="40" fill="${tone}"/>
<rect x="250" y="560" width="200" height="300" rx="40" fill="${tone}"/>
<rect x="190" y="260" width="320" height="380" rx="96" fill="#1c1c1e"/>
<rect x="215" y="285" width="270" height="330" rx="76" fill="#0a0a0a"/>
<circle cx="350" cy="450" r="96" fill="none" stroke="#ff9f0a" stroke-width="18" stroke-dasharray="420 200" stroke-linecap="round"/>
<rect x="512" y="380" width="22" height="70" rx="10" fill="#3a3a3c"/>`,
  );

export const PICTURES = {
  kettle: kettle('#2c2c2e'),
  kettleSide: kettle('#3a3a3c', '#8e6a3c'),
  kettleTop: kettle('#48484a'),
  kettleSteel: kettle('#b8bcc2', '#222'),
  kettleCream: kettle('#efe6d2', '#c9a26b'),
  headphones: headphones('#d9d4cc'),
  sneaker: sneaker('#e9edf2', '#ff5a36'),
  lamp: lamp('#e7b04a'),
  backpack: backpack('#55786a'),
  watch: watch('#c9b8a6'),
};

export const KETTLES: ShelfProduct[] = [
  {
    title: 'Stagg EKG Electric Pour-Over Kettle, Matte Black',
    url: 'https://shop.example/stagg-ekg',
    pictures: [PICTURES.kettle, PICTURES.kettleSide, PICTURES.kettleTop],
    price: { amount: 149, currency: 'USD' },
    was: { amount: 195, currency: 'USD' },
    rating: { value: 4.6, count: 1840 },
    store: 'Example Shop',
    brand: 'Fellow',
    availability: 'in_stock',
    highlights: ['0.9 litres', 'Holds a temperature for an hour', 'Gooseneck spout'],
    description:
      'A pour-over kettle with a counterbalanced handle and a precision spout, made for slow coffee.',
  },
  {
    title: 'Classic Kettle 1.7 L, Brushed Stainless Steel',
    url: 'https://kitchen.example/classic',
    pictures: [PICTURES.kettleSteel],
    price: { amount: 89.5, currency: 'USD' },
    rating: { value: 4.2, count: 312 },
    store: 'Kitchen Things',
    brand: 'Smeg',
    availability: 'limited',
    highlights: ['1.7 litres', 'Boils in 3 minutes', 'Removable filter'],
  },
  {
    title: 'Retro Cream Kettle with Wooden Handle',
    url: 'https://home.example/retro',
    pictures: [PICTURES.kettleCream],
    price: { amount: 64, currency: 'USD' },
    was: { amount: 79, currency: 'USD' },
    rating: { value: 3.5, count: 57 },
    store: 'Homewares & Co',
    availability: 'out_of_stock',
    highlights: ['1.2 litres', 'Stovetop'],
  },
];

export const MIXED: ShelfProduct[] = [
  ...KETTLES,
  {
    title: 'Wireless Noise-Cancelling Headphones',
    url: 'https://audio.example/hp',
    pictures: [PICTURES.headphones],
    price: { amount: 329, currency: 'EUR' },
    was: { amount: 399, currency: 'EUR' },
    rating: { value: 4.8, count: 21409 },
    store: 'Audio Haus',
    brand: 'Sonic',
    availability: 'in_stock',
  },
  {
    title: 'Everyday Runner, White and Flame',
    url: 'https://run.example/everyday',
    pictures: [PICTURES.sneaker],
    price: { amount: 120, currency: 'GBP' },
    rating: { value: 4.1, count: 980 },
    store: 'Run Club',
    availability: 'preorder',
  },
  {
    title: 'Brass Reading Lamp',
    url: 'https://light.example/brass',
    pictures: [PICTURES.lamp],
    price: { amount: 2980, currency: 'JPY' },
    store: 'Light & Co',
    availability: 'in_stock',
  },
  {
    title: 'Roll-Top Backpack 22 L',
    pictures: [PICTURES.backpack],
    price: { amount: 95, currency: 'USD' },
    rating: { value: 4.4, count: 66 },
    store: 'Trail',
  },
  {
    title: 'A product with no photo and a very long name that has to wrap onto a second line',
    url: 'https://plain.example/item',
    store: 'Plain Store',
  },
];
