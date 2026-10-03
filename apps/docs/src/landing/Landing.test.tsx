import { NacreProvider } from '@conch/nacre';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('says what’s worth knowing before installing, and no more', () => {
    const { container } = open();
    const know = screen.getByRole('heading', { name: 'Good to know' }).closest('section');
    for (const system of ['macOS', 'Linux', 'Windows']) expect(know).toHaveTextContent(system);
    expect(
      within(know as HTMLElement).getByRole('link', { name: 'how it’s protected' }),
    ).toHaveAttribute('href', LANDING_LINKS.security);
    // What a local model can't do, in the code's own words.
    const local = reference.providers.find((provider) => provider.can.offline);
    expect(know).toHaveTextContent(local?.limits[0] ?? '');
    // True, and not a confession: nothing about who made it or how few use it.
    const words = (container.textContent ?? '').toLowerCase();
    for (const apology of ['nobody is counting', 'one person built', 'no company', 'will break'])
      expect(words, `the front page says “${apology}”`).not.toContain(apology);
  });

  it('lets you use the one picture that is the real thing: the chart turns into its table', async () => {
    open();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: '29 Sep' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Chart' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the chat carrying on once an app is on, with what that app really suggests next', () => {
    open();
    const calendar = reference.integrations.find((app) => app.id === 'google-calendar');
    const picture = screen.getByRole('figure', { name: /offers to connect Google Calendar/ });
    expect(picture).toHaveTextContent(`Connected ${calendar?.name}`);
    expect(picture).toHaveTextContent('carrying on');
    // The chips under the answer are the catalog's own examples, never typed here.
    for (const example of calendar?.examples ?? []) expect(picture).toHaveTextContent(example);
  });

  it('names the computer on each install tab, with its mark', () => {
    open();
    for (const tab of screen.getAllByRole('tab', { name: 'macOS and Linux' }))
      expect(tab.querySelectorAll('svg[data-os]')).toHaveLength(2);
    for (const tab of screen.getAllByRole('tab', { name: 'Windows' }))
      expect(tab.querySelector('svg[data-os="windows"]')).not.toBeNull();
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
    // (The chart is the exception, and names itself: see the test above.)
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
