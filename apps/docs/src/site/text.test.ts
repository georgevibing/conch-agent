import { describe, expect, it } from 'vitest';

import {
  createSlugger,
  embeds,
  firstParagraph,
  frontMatter,
  headings,
  links,
  plain,
  segments,
  slugify,
  splitTitle,
} from './text';

describe('slugify', () => {
  it('makes the anchors GitHub makes', () => {
    expect(slugify('Security model')).toBe('security-model');
    expect(slugify('Web app (`apps/web`)')).toBe('web-app-appsweb');
    expect(slugify('What Conch warns you about')).toBe('what-conch-warns-you-about');
    expect(slugify('Forgot your password? Lost a key?')).toBe('forgot-your-password-lost-a-key');
  });

  it('numbers a heading that repeats on a page', () => {
    const slug = createSlugger();
    expect([slug('Setup'), slug('Setup'), slug('Setup')]).toEqual(['setup', 'setup-1', 'setup-2']);
  });
});

describe('frontMatter', () => {
  it('reads the keys at the top of a file and leaves the rest', () => {
    const { meta, body } = frontMatter(
      '---\ntitle: Install\ndescription: "One line: done."\norder: 1\n---\n\nHello.\n',
    );
    expect(meta).toEqual({ title: 'Install', description: 'One line: done.', order: '1' });
    expect(body.trim()).toBe('Hello.');
  });

  it('takes a file with none as it is, whatever its line endings', () => {
    expect(frontMatter('# Title\r\n\r\nWords.')).toEqual({ meta: {}, body: '# Title\n\nWords.' });
  });
});

describe('reading a page', () => {
  it('splits the top heading from the words', () => {
    expect(splitTitle('# The `browser`\n\nConch has one.')).toEqual({
      title: 'The browser',
      rest: 'Conch has one.',
    });
    expect(splitTitle('No heading here.')).toEqual({ rest: 'No heading here.' });
  });

  it('takes Markdown’s marks off', () => {
    expect(plain('**Bold**, `code` and [a link](./x.md) <kbd>K</kbd>')).toBe(
      'Bold, code and a link K',
    );
  });

  it('lists second- and third-level headings, and never ones inside code', () => {
    const body = ['## One', '```bash', '## not a heading', '```', '### Two `x`', '#### Three'].join(
      '\n',
    );
    expect(headings(body)).toEqual([
      { id: 'one', text: 'One', level: 2 },
      { id: 'two-x', text: 'Two x', level: 3 },
    ]);
  });

  it('finds a first paragraph to describe a page nobody described', () => {
    expect(firstParagraph('- Status: accepted\n\n## Context\n\nConch **lives** here.\n')).toBe(
      'Conch lives here.',
    );
  });

  it('finds links, but not ones written as code', () => {
    const body = 'See [a](./a.md#x) and [b](https://b.example "B").\n\n`[c](./c.md)`\n';
    expect(links(body)).toEqual(['./a.md#x', 'https://b.example']);
  });
});

describe('generated parts', () => {
  const body = [
    'Before.',
    '',
    '<!-- conch:cli -->',
    '',
    '## After',
    '',
    '```md',
    '<!-- conch:env -->',
    '```',
    '',
    '<!-- conch:channel-scene telegram key -->',
    '',
    '## After',
  ].join('\n');

  it('are comments on a line of their own, with what they were asked for', () => {
    expect(embeds(body)).toEqual([
      { name: 'cli', args: [] },
      { name: 'channel-scene', args: ['telegram', 'key'] },
    ]);
  });

  it('split a page into words and parts, in order, with anchors that carry on', () => {
    const parts = segments(body);
    expect(parts.map((part) => part.kind)).toEqual(['text', 'embed', 'text', 'embed', 'text']);
    expect(parts[1]).toEqual({ kind: 'embed', name: 'cli', args: [] });
    // The example inside the code block stays with the words around it.
    expect(parts[2]).toMatchObject({ kind: 'text', seen: [] });
    expect(parts[2]?.kind === 'text' && parts[2].text).toContain('<!-- conch:env -->');
    // The second "After" knows the first one took the anchor.
    expect(parts[4]).toMatchObject({ kind: 'text', seen: [['after', 1]] });
  });
});
