import { describe, expect, it } from 'vitest';

import { artifactProblem, DataSource, LiveDataRequest } from './artifacts';

const chart = (spec: unknown) => JSON.stringify(spec, null, 2);

describe('what’s wrong with an artifact, in plain words', () => {
  it('a chart: where the JSON broke, and what doesn’t fit', () => {
    expect(artifactProblem('chart', '{\n  "type": "bar"\n  "labels": []\n}')).toMatch(
      /^The chart’s JSON has a mistake on line 3, near column \d+: look for a missing comma/,
    );
    expect(artifactProblem('chart', chart({ type: 'donut', labels: ['a'], series: [] }))).toBe(
      'A chart’s "type" is one of "bar", "line", "area" or "pie".',
    );
    expect(
      artifactProblem(
        'chart',
        chart({ type: 'bar', labels: ['a', 'b'], series: [{ name: 'S', values: [1, 'x'] }] }),
      ),
    ).toBe('Value 2 of series 1 isn’t a number.');
    expect(
      artifactProblem(
        'chart',
        chart({ type: 'bar', labels: ['a', 'b'], series: [{ name: 'Visitors', values: [1] }] }),
      ),
    ).toBe('Each series needs one value per label: “Visitors” has 1 and there are 2 labels.');
    expect(
      artifactProblem(
        'chart',
        chart({ type: 'bar', labels: ['a'], series: [{ name: 'S', values: [1] }] }),
      ),
    ).toBeUndefined();
  });

  it('a table: the line with the wrong number of values, or an open quote', () => {
    expect(artifactProblem('table', 'Item,Cost\nRent,1200\nFood,400,extra')).toBe(
      'Line 3 has 3 values, but the header has 2.',
    );
    expect(artifactProblem('table', 'Item,Cost\n"Rent,1200\nFood,400')).toBe(
      'A quote on line 2 is never closed.',
    );
    expect(artifactProblem('table', 'Item,Cost')).toMatch(/header row and at least one row/);
    // Quoted commas and line breaks are one value; blank lines don't count.
    expect(artifactProblem('table', 'Item,Note\n"Rent, flat","two\nlines"\n\nFood,ok\n')).toBe(
      undefined,
    );
    expect(artifactProblem('table', 'a;b\n1;2')).toBeUndefined();
  });

  it('anything: empty, too big; an svg is svg', () => {
    expect(artifactProblem('markdown', '  ')).toMatch(/empty/);
    expect(artifactProblem('markdown', 'x'.repeat(400_001))).toMatch(/more than 400,000/);
    expect(artifactProblem('svg', '<div>')).toMatch(/<svg/);
    expect(artifactProblem('html', '<h1>Hi</h1>')).toBeUndefined();
  });
});

describe('live data, as a page declares and asks for it', () => {
  it('a source is an address, what may fill it, and how often', () => {
    expect(
      DataSource.safeParse({
        url: 'https://api.example.com/v1/weather?city={city}',
        params: { city: { choices: ['berlin', 'lisbon'] } },
        every: 600,
      }).success,
    ).toBe(true);
    // Unknown fields, a refresh faster than a minute, free text: no.
    expect(DataSource.safeParse({ url: 'https://a.example/x', headers: {} }).success).toBe(false);
    expect(DataSource.safeParse({ url: 'https://a.example/x', every: 5 }).success).toBe(false);
    expect(
      DataSource.safeParse({ url: 'https://a.example/{q}', params: { q: { text: true } } }).success,
    ).toBe(false);
  });

  it('a request names a source and short values, nothing else', () => {
    expect(
      LiveDataRequest.safeParse({ source: 'weather', params: { city: 'berlin' } }).success,
    ).toBe(true);
    expect(
      LiveDataRequest.safeParse({ source: 'weather', params: { city: 'x'.repeat(65) } }).success,
    ).toBe(false);
    expect(LiveDataRequest.safeParse({ source: '../etc' }).success).toBe(false);
  });
});
