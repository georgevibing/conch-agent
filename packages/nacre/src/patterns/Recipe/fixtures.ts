import type { RecipeData, RecipeStepData } from './recipe';

/** A stand-in photo: shakshuka in a pan, from above, drawn as a data URL so stories need no files. */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">
<defs>
<radialGradient id="cloth" cx="30%" cy="20%" r="95%"><stop offset="0" stop-color="#e9dcc6"/><stop offset=".6" stop-color="#cdb99a"/><stop offset="1" stop-color="#8f7a5c"/></radialGradient>
<radialGradient id="pan" cx="45%" cy="40%" r="60%"><stop offset=".78" stop-color="#2b2724"/><stop offset=".9" stop-color="#4a4440"/><stop offset="1" stop-color="#191614"/></radialGradient>
<radialGradient id="sauce" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#d4442a"/><stop offset=".6" stop-color="#b3301d"/><stop offset="1" stop-color="#7d1d10"/></radialGradient>
<radialGradient id="white" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fffdf7"/><stop offset=".8" stop-color="#f3ead8"/><stop offset="1" stop-color="#e2d3b5"/></radialGradient>
<radialGradient id="yolk" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#ffd25a"/><stop offset=".55" stop-color="#f6a51d"/><stop offset="1" stop-color="#d9800c"/></radialGradient>
<filter id="soft"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .08 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
</defs>
<rect width="1200" height="675" fill="url(#cloth)"/>
<g opacity=".18" stroke="#6b5537" stroke-width="3">${Array.from({ length: 24 }, (_, i) => `<line x1="${i * 52}" y1="0" x2="${i * 52 - 120}" y2="675"/>`).join('')}</g>
<ellipse cx="640" cy="372" rx="410" ry="330" fill="#000" opacity=".28" filter="url(#soft)"/>
<rect x="960" y="300" width="300" height="70" rx="35" fill="#231f1c" transform="rotate(-18 960 330)"/>
<circle cx="610" cy="340" r="330" fill="url(#pan)"/>
<circle cx="610" cy="340" r="292" fill="url(#sauce)"/>
<g fill="#e05a36" opacity=".55">${Array.from({ length: 40 }, (_, i) => `<circle cx="${380 + ((i * 97) % 460)}" cy="${120 + ((i * 61) % 440)}" r="${6 + (i % 5) * 4}"/>`).join('')}</g>
<g fill="#8f2414" opacity=".45">${Array.from({ length: 30 }, (_, i) => `<circle cx="${360 + ((i * 131) % 500)}" cy="${110 + ((i * 83) % 460)}" r="${4 + (i % 4) * 3}"/>`).join('')}</g>
${[
  [500, 230, 0],
  [720, 250, 40],
  [470, 430, 80],
  [700, 450, 120],
  [600, 340, 160],
]
  .map(
    ([x = 0, y = 0, r = 0]) =>
      `<g transform="rotate(${r} ${x} ${y})"><path d="M${x - 70} ${y} C${x - 75} ${y - 60} ${x + 60} ${y - 72} ${x + 72} ${y - 6} C${x + 82} ${y + 56} ${x - 30} ${y + 78} ${x - 70} ${y} Z" fill="url(#white)"/><circle cx="${x + 4}" cy="${y - 2}" r="30" fill="url(#yolk)"/><ellipse cx="${x - 6}" cy="${y - 12}" rx="10" ry="6" fill="#fff6d5" opacity=".7"/></g>`,
  )
  .join('')}
<g fill="#2f7a3a">${Array.from({ length: 46 }, (_, i) => `<ellipse cx="${390 + ((i * 113) % 440)}" cy="${120 + ((i * 71) % 430)}" rx="${7 + (i % 3) * 3}" ry="4" transform="rotate(${i * 37} ${390 + ((i * 113) % 440)} ${120 + ((i * 71) % 430)})"/>`).join('')}</g>
<g fill="#fbf6ea">${Array.from({ length: 22 }, (_, i) => `<rect x="${410 + ((i * 151) % 400)}" y="${150 + ((i * 89) % 380)}" width="${10 + (i % 3) * 4}" height="${9 + (i % 2) * 5}" rx="3" transform="rotate(${i * 23} ${410 + ((i * 151) % 400)} ${150 + ((i * 89) % 380)})"/>`).join('')}</g>
<rect width="1200" height="675" filter="url(#grain)"/>
</svg>`;

export const shakshukaPhoto = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** A step, with its timer found where it's mentioned (as the gateway finds it). */
function step(text: string, said?: string, seconds?: number, upTo?: number, section?: string) {
  const start = said ? text.indexOf(said) : -1;
  const out: RecipeStepData = {
    text,
    ...(section && { section }),
    timers:
      said && seconds && start >= 0
        ? [{ start, end: start + said.length, seconds, ...(upTo && { upTo }) }]
        : [],
  };
  return out;
}

export const shakshuka: RecipeData = {
  title: 'Shakshuka with feta and herbs',
  source: { site: 'Good Kitchen', url: 'https://goodkitchen.example.org/recipes/shakshuka' },
  picture: { src: shakshukaPhoto, width: 1200, height: 675 },
  description:
    'Eggs gently poached in a smoky, spiced tomato and pepper sauce, finished with crumbled feta and plenty of soft herbs. A one-pan brunch that’s just as good for supper.',
  author: 'Mira Haddad',
  yield: { amount: 4, unit: 'servings' },
  times: { prep: 600, cook: 1800, total: 2400 },
  rating: { value: 4.8, count: 1342 },
  cuisine: 'Middle Eastern',
  category: 'Brunch',
  ingredients: [
    { text: '2 tbsp olive oil', quantity: 2, unit: 'tbsp', item: 'olive oil' },
    {
      text: '1 large onion, finely sliced',
      quantity: 1,
      item: 'large onion',
      note: 'finely sliced',
    },
    { text: '1 red pepper, sliced', quantity: 1, item: 'red pepper', note: 'sliced' },
    {
      text: '2–3 cloves garlic, crushed',
      quantity: { from: 2, to: 3 },
      unit: 'cloves',
      item: 'garlic',
      note: 'crushed',
    },
    { text: '1½ tsp ground cumin', quantity: 1.5, unit: 'tsp', item: 'ground cumin' },
    { text: '1 tsp smoked paprika', quantity: 1, unit: 'tsp', item: 'smoked paprika' },
    {
      text: '2 x 400g cans chopped tomatoes',
      quantity: 2,
      unit: '×',
      item: '400g cans chopped tomatoes',
    },
    { text: '½ tsp sugar', quantity: 0.5, unit: 'tsp', item: 'sugar' },
    { text: '6 eggs', quantity: 6, item: 'eggs' },
    { text: '100g feta, crumbled', quantity: 100, unit: 'g', item: 'feta', note: 'crumbled' },
    {
      text: 'A small bunch of coriander, chopped',
      quantity: 1,
      unit: 'bunch',
      item: 'coriander',
      note: 'chopped',
    },
    { text: 'Salt and pepper, to taste', item: 'Salt and pepper', note: 'to taste' },
  ],
  steps: [
    step(
      'Heat the olive oil in a large, deep frying pan over a medium heat. Add the onion and pepper and cook for 8–10 minutes, until soft and sweet.',
      '8–10 minutes',
      480,
      600,
      'The sauce',
    ),
    step(
      'Stir in the garlic, cumin and paprika and cook for 1 minute, until fragrant.',
      '1 minute',
      60,
      undefined,
      'The sauce',
    ),
    step(
      'Tip in the tomatoes and sugar, season, and simmer for 15 minutes, stirring now and then, until thick.',
      '15 minutes',
      900,
      undefined,
      'The sauce',
    ),
    step(
      'Make six hollows in the sauce with the back of a spoon and crack an egg into each.',
      undefined,
      undefined,
      undefined,
      'The eggs',
    ),
    step(
      'Cover and cook for 6–8 minutes, until the whites are set but the yolks still run.',
      '6–8 minutes',
      360,
      480,
      'The eggs',
    ),
    step(
      'Scatter over the feta and coriander and bring the pan to the table with plenty of warm bread.',
      undefined,
      undefined,
      undefined,
      'The eggs',
    ),
  ],
  nutrition: [
    { label: 'Calories', value: '318 kcal' },
    { label: 'Protein', value: '17 g' },
    { label: 'Carbohydrates', value: '18 g' },
    { label: 'Sugar', value: '13 g' },
    { label: 'Fat', value: '20 g' },
    { label: 'Fibre', value: '5 g' },
    { label: 'Salt', value: '1.2 g' },
  ],
  tags: ['eggs', 'vegetarian', 'one pan'],
};

/** No photo, no rating, a yield in loaves, a long proof. */
export const loaf: RecipeData = {
  title: 'Overnight country loaf',
  source: { site: 'bread.example.org', url: 'https://bread.example.org/country-loaf' },
  yield: { amount: 1, unit: 'loaf' },
  times: { prep: 1800, cook: 2700, total: 15 * 3600 },
  ingredients: [
    { text: '500g strong white flour', quantity: 500, unit: 'g', item: 'strong white flour' },
    { text: '350ml water', quantity: 350, unit: 'ml', item: 'water' },
    { text: '10g salt', quantity: 10, unit: 'g', item: 'salt' },
    { text: '¼ tsp dried yeast', quantity: 0.25, unit: 'tsp', item: 'dried yeast' },
  ],
  steps: [
    step('Mix everything into a shaggy dough and leave for 30 minutes.', '30 minutes', 1800),
    step(
      'Fold the dough over itself a few times, then cover and leave overnight, about 12 hours.',
      '12 hours',
      43200,
    ),
    step('Shape, then bake in a hot lidded pot for 45 minutes.', '45 minutes', 2700),
  ],
};
