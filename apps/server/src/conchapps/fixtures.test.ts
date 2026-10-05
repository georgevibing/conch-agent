import { describe, expect, it } from 'vitest';
import { scratchFixture } from './fixtures';
const files = new Map([
  [
    'fixtures.json',
    Buffer.from(
      JSON.stringify({
        fixtures: {
          day: {
            settings: { email: 'fake@example.com' },
            responses: [{ url: 'https://api.example.com/day', json: { energy: 357 } }],
          },
        },
      }),
    ),
  ],
]);
const request = (url: string) => ({ url, method: 'GET' as const, headers: {} });
it('supplies fake settings, exact responses and refuses unlisted requests without network', async () => {
  const fake = scratchFixture(files, 'day');
  expect(fake.settings.email).toBe('fake@example.com');
  const signal = new AbortController().signal;
  expect(
    await fake.fetcher(
      { id: 'test', reaches: ['api.example.com'] },
      request('https://api.example.com/day'),
      signal,
    ),
  ).toMatchObject({ body: '{"energy":357}' });
  expect(
    await fake.fetcher(
      { id: 'test', reaches: ['api.example.com'] },
      request('https://api.example.com/other'),
      signal,
    ),
  ).toMatchObject({ refused: expect.stringContaining('No network') });
  expect(
    await fake.fetcher({ id: 'test', reaches: [] }, request('https://api.example.com/day'), signal),
  ).toMatchObject({ refused: expect.stringContaining('outside') });
});
describe('fixture names', () => {
  it('refuses traversal and unknown fixtures', () => {
    expect(() => scratchFixture(files, '../day')).toThrow();
    expect(() => scratchFixture(files, 'unknown')).toThrow('No scratch fixture');
  });
});
