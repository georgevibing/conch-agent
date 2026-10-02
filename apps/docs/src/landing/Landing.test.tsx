import { NacreProvider } from '@conch/nacre';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import reference from 'virtual:conch-reference';

import { pageAt } from '../site/pages';
import { Landing, LANDING_LINKS } from './Landing';

function open() {
  return render(
    <NacreProvider>
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    </NacreProvider>,
  );
}

const channels = reference.channels.filter((channel) => channel.available);

describe('the front page', () => {
  it('says what Conch is, and the one line that installs it', async () => {
    const { container } = open();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /A calm home for your AI agents\.\s*On your own computer\./,
    );
    expect(screen.getAllByRole('button', { name: 'Copy command' }).length).toBeGreaterThan(0);
    for (const link of screen.getAllByRole('link', { name: 'Get started' }))
      expect(link).toHaveAttribute('href', LANDING_LINKS.start);
    expect(document.title).toContain('Conch');
    const { violations } = await axe(container, {
      // Contrast needs real layout, which jsdom lacks: scripts/a11y.mjs covers it.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(violations).toEqual([]);
  });

  it('counts what the code has, and never types a number', () => {
    open();
    const numbers = within(screen.getByLabelText('Conch in numbers'))
      .getAllByRole('definition')
      .map((value) => value.textContent);
    expect(numbers).toEqual([
      String(reference.providers.length),
      String(channels.length),
      String(reference.integrations.length),
      '0',
    ]);
  });

  it('names every provider, chat app and app the code has', () => {
    const { container } = open();
    const words = container.textContent ?? '';
    for (const provider of reference.providers) expect(words).toContain(provider.name);
    for (const channel of channels) expect(words).toContain(channel.name);
    for (const app of reference.integrations) expect(words).toContain(app.name);
    expect(words).toContain(`${reference.integrations.length} apps, for every model`);
  });

  it('says the version, and what a local model can’t do, in the code’s own words', () => {
    open();
    const honest = screen.getByRole('heading', { name: 'The honest part' }).closest('section');
    expect(honest).toHaveTextContent(`This is version ${reference.version}.`);
    const local = reference.providers.find((provider) => provider.can.offline);
    expect(honest).toHaveTextContent(local?.limits[0] ?? '');
  });

  it('claims nothing about how many people use it', () => {
    const { container } = open();
    const words = (container.textContent ?? '').toLowerCase();
    // Conch counts nobody, so the page has nothing of this kind to say.
    for (const boast of [
      'trusted by',
      'loved by',
      'thousands',
      'millions',
      'downloads',
      'stars',
      'world-class',
      'revolutionary',
      'best-in-class',
      'industry-leading',
      'testimonial',
    ])
      expect(words, `the front page says “${boast}”`).not.toContain(boast);
  });

  it('shows the product as pictures: each has a sentence for a name, and nothing in one can be pressed', () => {
    const { container } = open();
    const pictures = screen
      .getAllByRole('figure')
      .filter((figure) => figure.getAttribute('aria-label'));
    expect(pictures.length).toBeGreaterThanOrEqual(9);
    for (const picture of pictures) {
      expect(picture.getAttribute('aria-label')?.length).toBeGreaterThan(20);
      expect(within(picture).queryAllByRole('button')).toEqual([]);
    }
    // The app's own controls are in there, drawn but out of reach.
    expect(container.querySelectorAll('[inert] button').length).toBeGreaterThan(0);
  });

  it('leads only to pages that exist', () => {
    for (const [name, path] of Object.entries(LANDING_LINKS))
      expect(
        path === '/docs' || pageAt(path),
        `LANDING_LINKS.${name} points at ${path}, which isn't a page: fix it in apps/docs/src/landing/Landing.tsx.`,
      ).toBeTruthy();
    open();
    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      if (href.startsWith('/')) expect(href === '/docs' || pageAt(href), href).toBeTruthy();
    }
  });
});
