import { describe, expect, it } from 'vitest';

import type { PublishedRelease } from '../../publishing/schema';
import { llmsFullTxt, llmsTxt, releasesFeed } from './discovery';
import type { Page } from './pages';

const SITE = 'https://conchagent.com';
const page = (over: Partial<Page>): Page => ({
  path: '/start/install',
  section: 'start',
  title: 'Install Conch',
  nav: 'Install',
  description: 'One line in a terminal, or the app.',
  order: 1,
  body: 'Run the install line.\n\n## Then\n\nSay hello.',
  headings: [],
  file: 'apps/docs/content/start/install.md',
  listed: true,
  ...over,
});
const sections = [
  { id: 'start', title: 'Get started', about: 'Install it, say hello.' },
  { id: 'providers', title: 'Providers', about: 'The models Conch drives.' },
];
const pages = [
  page({
    path: '/start/hello',
    title: 'Say hello',
    order: 2,
    description: 'Your first chat.\nTwo lines.',
  }),
  page({}),
  page({
    path: '/decisions/0127-releasing',
    section: 'decisions',
    title: '0127 — Releasing',
    description: 'Why release-please.',
  }),
];
const about = { siteUrl: SITE, summary: 'Conch is an open-source AI assistant.', sections, pages };

describe('llms.txt (llmstxt.org)', () => {
  it('is a title, a summary, and each section’s pages in order, decisions as optional', () => {
    const text = llmsTxt(about);
    expect(text.startsWith('# Conch\n\n> Conch is an open-source AI assistant.\n')).toBe(true);
    expect(text).toContain(
      '## Get started\n\nInstall it, say hello.\n\n- [Install Conch](https://conchagent.com/start/install/): One line in a terminal, or the app.\n- [Say hello](https://conchagent.com/start/hello/): Your first chat. Two lines.',
    );
    // A section with no pages isn't listed.
    expect(text).not.toContain('## Providers');
    expect(text).toContain(
      '## Optional\n\n- [0127 — Releasing](https://conchagent.com/decisions/0127-releasing/)',
    );
    expect(text).toContain(`${SITE}/llms-full.txt`);
  });

  it('puts every guide’s words in one file, without the decision records', () => {
    const full = llmsFullTxt(about);
    expect(full).toContain(
      '# Install Conch\n\nSource: https://conchagent.com/start/install/\n\nRun the install line.',
    );
    expect(full.indexOf('# Install Conch')).toBeLessThan(full.indexOf('# Say hello'));
    expect(full).not.toContain('Why release-please');
  });
});

describe('the releases feed (Atom)', () => {
  const release = (over: Partial<PublishedRelease>): PublishedRelease => ({
    tag: 'v0.1.0',
    version: '0.1.0',
    channel: 'stable',
    commit: 'a'.repeat(40),
    name: 'Conch 0.1.0',
    notes: '### New\n\n- Edit pages <by hand> & more',
    published: '2026-10-01T10:00:00Z',
    downloads: true,
    ...over,
  });

  it('lists releases newest first, escaped, with their channel', () => {
    const feed = releasesFeed({
      siteUrl: SITE,
      repository: 'https://github.com/georgevibing/conch-agent',
      releases: [
        release({}),
        release({
          tag: 'v0.2.0-beta.1',
          version: '0.2.0-beta.1',
          channel: 'beta',
          published: '2026-10-05T10:00:00Z',
        }),
      ],
    });
    expect(
      feed.startsWith(
        '<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">',
      ),
    ).toBe(true);
    expect(feed).toContain('<updated>2026-10-05T10:00:00Z</updated>');
    expect(feed.indexOf('Conch 0.2.0-beta.1 (beta)')).toBeLessThan(
      feed.indexOf('<title>Conch 0.1.0</title>'),
    );
    expect(feed).toContain('<category term="beta" label="Beta"/>');
    expect(feed).toContain('Edit pages &lt;by hand&gt; &amp; more');
    expect(feed).toContain(
      'href="https://github.com/georgevibing/conch-agent/releases/tag/v0.1.0"',
    );
    expect(feed).toContain(
      '<link rel="self" type="application/atom+xml" href="https://conchagent.com/releases/feed.xml"/>',
    );
  });

  it('is a valid, empty feed before the first release', () => {
    const feed = releasesFeed({
      siteUrl: SITE,
      repository: 'https://github.com/x/y',
      releases: [],
    });
    expect(feed).not.toContain('<entry>');
    expect(feed).toContain('<updated>1970-01-01T00:00:00Z</updated>');
  });
});
