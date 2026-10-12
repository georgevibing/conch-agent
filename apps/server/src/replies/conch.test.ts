import { describe, expect, it } from 'vitest';

import { chartable, conchReplies, isNumber, markdownTables, RULES, type ConchRule } from './conch';

const table = (rows: string[]) => rows.join('\n');

const SALES = table([
  'Here are this year’s sales by quarter:',
  '',
  '| Quarter | Revenue | Growth |',
  '| --- | ---: | ---: |',
  '| Q1 | $1,200 | 4% |',
  '| Q2 | $1,450 | 21% |',
  '| Q3 | $1,380 | −5% |',
  '',
  'Q2 was the best so far.',
]);

describe('reading tables from a reply', () => {
  it('finds a table with its header and rows', () => {
    expect(markdownTables(SALES)).toEqual([
      {
        header: ['Quarter', 'Revenue', 'Growth'],
        rows: [
          ['Q1', '$1,200', '4%'],
          ['Q2', '$1,450', '21%'],
          ['Q3', '$1,380', '−5%'],
        ],
      },
    ]);
  });

  it('reads tables without the outer pipes, and keeps escaped pipes in a cell', () => {
    const [found] = markdownTables(
      table(['Name | Score', '--- | ---', 'a \\| b | 3', 'c | 4', 'not a row']),
    );
    expect(found?.header).toEqual(['Name', 'Score']);
    expect(found?.rows).toEqual([
      ['a \\| b', '3'],
      ['c', '4'],
    ]);
  });

  it('leaves out tables inside code blocks', () => {
    expect(
      markdownTables(['```md', '| A | B |', '| --- | --- |', '| x | 1 |', '```'].join('\n')),
    ).toEqual([]);
  });

  it('needs the divider row: pipes in prose are not a table', () => {
    expect(markdownTables('Use a | b to pipe one into the other.\nThen c | d.')).toEqual([]);
  });
});

describe('what counts as a number in a table', () => {
  it.each([
    '12',
    '1,200',
    '−3.5',
    '-3.5',
    '$12k',
    '48%',
    '4.2 kg',
    '£1.1m',
    '**7**',
    '1 200',
    '21°C',
  ])('%s is a number', (cell) => expect(isNumber(cell)).toBe(true));

  it.each(['Q1', '2026-10-03', '10:30', 'v1.2.3', 'three', '3 days', '', '1.2.3'])(
    '%s is not',
    (cell) => expect(isNumber(cell)).toBe(false),
  );
});

describe('a table worth a chart', () => {
  it('has three rows or more and a column of numbers after the first', () => {
    expect(
      chartable({
        header: ['Year', 'Visitors'],
        rows: [
          ['2024', '1,200'],
          ['2025', '1,800'],
          ['2026', '2,100'],
        ],
      }),
    ).toBe(true);
  });

  it('is not two numbers: they read as well as they’d draw', () => {
    expect(
      chartable({
        header: ['Year', 'Visitors'],
        rows: [
          ['2024', '1,200'],
          ['2025', '1,800'],
        ],
      }),
    ).toBe(false);
  });

  it('is not a list whose only numbers name the rows', () => {
    expect(
      chartable({
        header: ['Year', 'What happened'],
        rows: [
          ['2024', 'Moved to Lisbon'],
          ['2025', 'Started the shop'],
        ],
      }),
    ).toBe(false);
  });

  it('is not one row, or a column with words in it', () => {
    expect(chartable({ header: ['Plan', 'Price'], rows: [['Pro', '$20']] })).toBe(false);
    expect(
      chartable({
        header: ['Plan', 'Price'],
        rows: [
          ['Pro', '$20'],
          ['Team', 'Ask us'],
        ],
      }),
    ).toBe(false);
  });

  it('reads a dash or an empty cell as a gap', () => {
    expect(
      chartable({
        header: ['Month', 'Rain (mm)'],
        rows: [
          ['Jan', '80'],
          ['Feb', '—'],
          ['Mar', '64'],
          ['Apr', '51'],
        ],
      }),
    ).toBe(true);
  });
});

describe('a table whose numbers aren’t the point', () => {
  const offered = (rows: string[]) =>
    conchReplies(table(rows), { tools: true }).some((r) => r.text === 'Show it as a chart');

  it('is not a list of things to buy with a reason and a price for each', () => {
    expect(
      offered([
        'Here’s a revamp:',
        '',
        '| Item | Why | Price |',
        '|---|---|---|',
        '| Navy blazer | Works with everything | $180 |',
        '| White oxford shirt | Classic base | $45 |',
        '| Chelsea boots | Smart-casual | $220 |',
        '| Dark jeans | Dresses up or down | $90 |',
      ]),
    ).toBe(false);
  });

  it('is not amounts in different units, like a recipe', () => {
    expect(
      offered([
        '| Ingredient | Amount |',
        '|---|---|',
        '| Flour | 200 g |',
        '| Sugar | 50 g |',
        '| Eggs | 2 |',
        '| Milk | 250 ml |',
      ]),
    ).toBe(false);
  });

  it('is not the same number in every row', () => {
    expect(
      offered(['| Room | Beds |', '|---|---|', '| Blue | 2 |', '| Green | 2 |', '| Yellow | 2 |']),
    ).toBe(false);
  });

  it.each([
    ['sizes', ['| Piece | Size |', '|---|---|', '| Jeans | 32 |', '| Shirt | 40 |']],
    ['steps', ['| Step | Minutes |', '|---|---|', '| Preheat | 10 |', '| Bake | 25 |']],
    [
      'opening hours and phones',
      ['| Store | Opens | Phone |', '|---|---|---|', '| A | 9 | 555 |', '| B | 10 | 556 |'],
    ],
  ])('is not two rows of %s', (_, rows) => expect(offered(rows)).toBe(false));

  it('still offers real data: money by year, scores by team, spend by month', () => {
    expect(
      offered([
        '| Year | Revenue |',
        '|---|---|',
        '| 2022 | $1.2m |',
        '| 2023 | $1.8m |',
        '| 2024 | $2.4m |',
      ]),
    ).toBe(true);
    expect(
      offered([
        '| Team | Played | Points |',
        '|---|---|---|',
        '| Lions | 10 | 24 |',
        '| Tigers | 10 | 19 |',
        '| Bears | 10 | 12 |',
      ]),
    ).toBe(true);
    expect(
      offered([
        '| Month | Groceries | Eating out | Note |',
        '|---|---|---|---|',
        '| Jan | €320 | €140 | |',
        '| Feb | €295 | €210 | birthday |',
        '| Mar | €310 | €95 | |',
      ]),
    ).toBe(true);
  });
});

describe('Conch’s own replies', () => {
  it('offers a chart under a table of numbers', () => {
    expect(conchReplies(SALES, { tools: true })).toEqual([{ text: 'Show it as a chart' }]);
  });

  it('leaves alone a reply with no table, or a table of words', () => {
    expect(conchReplies('Sure — here’s a short poem about the sea.', { tools: true })).toEqual([]);
    expect(
      conchReplies(
        table(['| Name | Role |', '| --- | --- |', '| Ada | Lead |', '| Sam | Design |']),
        { tools: true },
      ),
    ).toEqual([]);
    expect(conchReplies('', { tools: true })).toEqual([]);
  });

  it('doesn’t offer a model that can only chat what it can’t do', () => {
    expect(conchReplies(SALES, { tools: false })).toEqual([]);
  });

  it('runs every rule in order, once each, three at most', () => {
    const always = (id: string, text = id): ConchRule => ({ id, text, fits: () => true });
    const rules = [always('a'), always('b'), always('a2', 'a'), always('c'), always('d')];
    expect(conchReplies('anything', { tools: true }, rules).map((r) => r.text)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps every rule’s words fit for a chip', () => {
    for (const rule of RULES) {
      expect(rule.text.length).toBeLessThanOrEqual(120);
      expect(rule.text).toBe(rule.text.trim());
    }
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
});
