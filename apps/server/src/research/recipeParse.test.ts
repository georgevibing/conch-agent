import { Recipe } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { pageData } from './pageData';
import { findTimers, parseIngredient, parseYield, readNumber, readRecipe } from './recipeParse';

describe('amounts', () => {
  it.each([
    ['3', 3],
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['1/2', 0.5],
    ['1 1/2', 1.5],
    ['1⁄4', 0.25],
    ['½', 0.5],
    ['1½', 1.5],
    ['2 ¾', 2.75],
    ['⅓', 1 / 3],
    ['an', 1],
    ['two', 2],
  ])('reads “%s” as %d', (raw, n) => {
    expect(readNumber(raw)).toBeCloseTo(n);
  });

  it('refuses what isn’t an amount', () => {
    expect(readNumber('some')).toBeUndefined();
    expect(readNumber('1/0')).toBeUndefined();
  });
});

describe('ingredients', () => {
  it.each([
    ['2 cups plain flour', { quantity: 2, unit: 'cups', item: 'plain flour' }],
    ['1 1/2 tsp baking soda', { quantity: 1.5, unit: 'tsp', item: 'baking soda' }],
    ['½ cup sugar', { quantity: 0.5, unit: 'cup', item: 'sugar' }],
    ['1½ tbsp. olive oil', { quantity: 1.5, unit: 'tbsp', item: 'olive oil' }],
    ['200g butter, softened', { quantity: 200, unit: 'g', item: 'butter', note: 'softened' }],
    [
      '2–3 cloves garlic, crushed',
      { quantity: { from: 2, to: 3 }, unit: 'cloves', item: 'garlic', note: 'crushed' },
    ],
    [
      '2 to 3 tablespoons honey',
      { quantity: { from: 2, to: 3 }, unit: 'tablespoons', item: 'honey' },
    ],
    ['3 large eggs', { quantity: 3, item: 'large eggs' }],
    [
      '2 x 400g cans chopped tomatoes',
      { quantity: 2, unit: '×', item: '400g cans chopped tomatoes' },
    ],
    ['1 fl oz cream', { quantity: 1, unit: 'fl oz', item: 'cream' }],
    ['a pinch of salt', { quantity: 1, unit: 'pinch', item: 'salt' }],
    ['1 onion (diced)', { quantity: 1, item: 'onion', note: 'diced' }],
    ['500 ml milk', { quantity: 500, unit: 'ml', item: 'milk' }],
  ])('reads “%s”', (line, expected) => {
    expect(parseIngredient(line)).toEqual({ text: line, ...expected });
  });

  it('keeps a line it can’t measure as it was', () => {
    expect(parseIngredient('Salt and pepper, to taste')).toEqual({
      text: 'Salt and pepper, to taste',
      item: 'Salt and pepper',
      note: 'to taste',
    });
    expect(parseIngredient('a few sprigs of thyme')).toEqual({
      text: 'a few sprigs of thyme',
      item: 'a few sprigs of thyme',
    });
    expect(parseIngredient('   ')).toBeUndefined();
  });

  it('never keeps markup', () => {
    expect(parseIngredient('<b>2</b> cups <a href="x">flour</a>')?.text).toBe('2 cups flour');
  });

  it('doesn’t take a word starting with a unit for the unit', () => {
    expect(parseIngredient('2 garlic cloves')).toMatchObject({
      quantity: 2,
      item: 'garlic cloves',
    });
    expect(parseIngredient('1 lemon')).toMatchObject({ quantity: 1, item: 'lemon' });
    expect(parseIngredient('1 lemon')?.unit).toBeUndefined();
  });
});

describe('timers in a step', () => {
  const one = (text: string) => {
    const [t] = findTimers(text);
    return t && { ...t, said: text.slice(t.start, t.end) };
  };

  it.each([
    ['Bake for 20–25 minutes until golden.', 1200, 1500, '20–25 minutes'],
    ['Simmer for 1 hour.', 3600, undefined, '1 hour'],
    ['Rest for 1 hour 30 minutes.', 5400, undefined, '1 hour 30 minutes'],
    ['Cook for 1½ hours, covered.', 5400, undefined, '1½ hours'],
    ['Chill for half an hour.', 1800, undefined, 'half an hour'],
    ['Whisk for 30 seconds.', 30, undefined, '30 seconds'],
    ['Leave for 10 mins.', 600, undefined, '10 mins'],
    ['Proof for 2-3 hrs somewhere warm.', 7200, 10800, '2-3 hrs'],
    ['Give it a 30-minute rest.', 1800, undefined, '30-minute'],
    ['Cook for five minutes.', 300, undefined, 'five minutes'],
    ['Steep for a minute.', 60, undefined, 'a minute'],
    ['Marinate for 2 days.', 172800, undefined, '2 days'],
  ])('finds the timer in “%s”', (text, seconds, upTo, said) => {
    expect(one(text)).toEqual({
      start: text.indexOf(said),
      end: text.indexOf(said) + said.length,
      seconds,
      ...(upTo && { upTo }),
      said,
    });
  });

  it('finds every timer, in order, and nothing that isn’t one', () => {
    const timers = findTimers('Fry for 5 minutes, then add stock and simmer 15–20 minutes.');
    expect(timers.map((t) => t.seconds)).toEqual([300, 900]);
    expect(findTimers('Heat the oven to 200C. Use an 8-inch tin and 2 eggs.')).toEqual([]);
    expect(findTimers('Cook a few minutes, then overnight in the fridge.')).toEqual([]);
  });
});

describe('servings', () => {
  it.each([
    [4, { amount: 4, unit: 'servings' }],
    ['4 servings', { amount: 4, unit: 'servings' }],
    ['Serves 4-6', { amount: 4, unit: 'servings' }],
    ['Makes 12 cookies', { amount: 12, unit: 'cookies' }],
    [['4', '4 people'], { amount: 4, unit: 'servings' }],
    [['8', '1 loaf'], { amount: 1, unit: 'loaf' }],
  ])('reads %j', (value, expected) => {
    expect(parseYield(value)).toEqual(expected);
  });

  it('says nothing when there’s nothing to read', () => {
    expect(parseYield(undefined)).toBeUndefined();
    expect(parseYield('a crowd')).toBeUndefined();
    expect(parseYield('0')).toBeUndefined();
  });
});

function fail(): never {
  throw new Error('Expected a value.');
}

const ld = (data: unknown, head = '') =>
  `<html><head>${head}<script type="application/ld+json">${JSON.stringify(data)}</script></head><body></body></html>`;
const read = (html: string, url = 'https://cook.example/pancakes') =>
  readRecipe(pageData(html), html, url);

describe('a recipe page', () => {
  it('reads a whole schema.org Recipe, the shape most sites use', () => {
    const html = ld(
      {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'Cook Example' },
          {
            '@type': 'Recipe',
            name: 'Fluffy &amp; light pancakes',
            description: '<p>Easy weekend <b>pancakes</b>.</p>',
            image: [{ '@type': 'ImageObject', url: '/img/pancakes.jpg' }],
            author: { '@type': 'Person', name: 'Ada' },
            recipeYield: ['4', '4 servings'],
            prepTime: 'PT10M',
            cookTime: 'PT20M',
            recipeCuisine: ['American'],
            recipeCategory: 'Breakfast',
            keywords: 'pancakes, breakfast, Pancakes, easy',
            recipeIngredient: ['200g plain flour', '2 eggs', '300ml milk'],
            recipeInstructions: [
              {
                '@type': 'HowToSection',
                name: 'Batter',
                itemListElement: [
                  { '@type': 'HowToStep', text: 'Whisk everything together.' },
                  { '@type': 'HowToStep', text: 'Rest for 10 minutes.' },
                ],
              },
              { '@type': 'HowToStep', name: 'Cook', text: '3. Cook for 2 minutes a side.' },
            ],
            nutrition: { calories: '250', proteinContent: '9 g', '@type': 'NutritionInformation' },
            aggregateRating: { ratingValue: '4.7', ratingCount: '1203' },
          },
        ],
      },
      '<meta property="og:site_name" content="Cook Example">',
    );
    const recipe = read(html) ?? fail();
    expect(recipe).toMatchObject({
      title: 'Fluffy & light pancakes',
      source: { site: 'Cook Example', url: 'https://cook.example/pancakes' },
      description: 'Easy weekend pancakes .',
      author: 'Ada',
      yield: { amount: 4, unit: 'servings' },
      times: { prep: 600, cook: 1200, total: 1800 },
      cuisine: 'American',
      category: 'Breakfast',
      tags: ['pancakes', 'breakfast', 'easy'],
      image: 'https://cook.example/img/pancakes.jpg',
      nutrition: [
        { label: 'Calories', value: '250 kcal' },
        { label: 'Protein', value: '9 g' },
      ],
      rating: { value: 4.7, count: 1203 },
    });
    expect(recipe.ingredients.map((i) => i.quantity)).toEqual([200, 2, 300]);
    expect(recipe.steps).toEqual([
      { text: 'Whisk everything together.', section: 'Batter', timers: [] },
      {
        text: 'Rest for 10 minutes.',
        section: 'Batter',
        timers: [{ start: 9, end: 19, seconds: 600 }],
      },
      { text: 'Cook for 2 minutes a side.', timers: [{ start: 9, end: 18, seconds: 120 }] },
    ]);
    const { image: _image, ...card } = recipe;
    expect(Recipe.safeParse(card).success).toBe(true);
  });

  it('splits method written as one block of text', () => {
    const lines =
      read(
        ld({
          '@type': ['Recipe'],
          name: 'Toast',
          recipeIngredient: ['1 slice bread'],
          recipeInstructions: 'Toast the bread.<br>Butter it.\nEat.',
        }),
      ) ?? fail();
    expect(lines.steps.map((s) => s.text)).toEqual(['Toast the bread.', 'Butter it.', 'Eat.']);
    const numbered =
      read(
        ld({
          '@type': 'Recipe',
          name: 'Tea',
          recipeIngredient: ['1 tea bag'],
          recipeInstructions: '1. Boil the kettle. 2. Steep for 3 minutes. 3. Add milk.',
        }),
      ) ?? fail();
    expect(numbered.steps.map((s) => s.text)).toEqual([
      'Boil the kettle.',
      'Steep for 3 minutes.',
      'Add milk.',
    ]);
    const plainOne =
      read(
        ld({
          '@type': 'Recipe',
          name: 'Oven',
          recipeIngredient: ['1 tray'],
          recipeInstructions: ['Heat the oven to 200. Line a tray.'],
        }),
      ) ?? fail();
    expect(plainOne.steps.map((s) => s.text)).toEqual(['Heat the oven to 200. Line a tray.']);
  });

  it('falls back to microdata and the card tags when there’s no JSON-LD', () => {
    const html = `<html><head><title>Soup | Site</title>
      <meta property="og:title" content="Tomato soup">
      <meta property="og:image" content="https://img.example/soup.jpg">
      <meta property="og:description" content="Warming.">
      </head><body><ul>
      <li itemprop="recipeIngredient">1 kg tomatoes</li>
      <li itemprop="recipeIngredient">1 onion</li></ul>
      <div itemprop="recipeInstructions">Simmer for 30 minutes.</div></body></html>`;
    expect(read(html, 'https://www.soup.example/t')).toMatchObject({
      title: 'Tomato soup',
      description: 'Warming.',
      source: { site: 'soup.example', url: 'https://www.soup.example/t' },
      image: 'https://img.example/soup.jpg',
      ingredients: [
        { quantity: 1, unit: 'kg', item: 'tomatoes' },
        { quantity: 1, item: 'onion' },
      ],
      steps: [{ text: 'Simmer for 30 minutes.', timers: [{ seconds: 1800 }] }],
    });
  });

  it('finds nothing to cook on a page without a recipe, or an insecure one', () => {
    expect(read('<html><title>News</title></html>')).toBeUndefined();
    expect(read(ld({ '@type': 'Recipe', name: 'Empty' }))).toBeUndefined();
    expect(
      read(
        ld({ '@type': 'Recipe', name: 'X', recipeIngredient: ['1 egg'] }),
        'http://cook.example/',
      ),
    ).toBeUndefined();
  });

  it('drops a picture that isn’t https, and ratings out of their scale', () => {
    const recipe =
      read(
        ld({
          '@type': 'Recipe',
          name: 'X',
          image: 'http://img.example/x.jpg',
          recipeIngredient: ['1 egg'],
          aggregateRating: { ratingValue: 9, bestRating: 10, ratingCount: 3 },
        }),
      ) ?? fail();
    expect(recipe.image).toBeUndefined();
    expect(recipe.rating).toEqual({ value: 4.5, count: 3 });
  });

  it('caps what a hostile page could stuff in', () => {
    const recipe =
      read(
        ld({
          '@type': 'Recipe',
          name: 'n'.repeat(5000),
          recipeIngredient: Array.from({ length: 500 }, () => '1 egg'),
          recipeInstructions: Array.from({ length: 100 }, () => 'Stir. '.repeat(500)),
        }),
      ) ?? fail();
    expect(recipe.title).toHaveLength(200);
    expect(recipe.ingredients).toHaveLength(80);
    expect(recipe.steps).toHaveLength(60);
    expect(recipe.steps[0]?.text.length ?? 0).toBeLessThanOrEqual(2000);
    const { image: _image, ...card } = recipe;
    expect(Recipe.safeParse(card).success).toBe(true);
  });
});
