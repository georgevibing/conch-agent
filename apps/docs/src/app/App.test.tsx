import { NacreProvider } from '@conch/nacre';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import reference from 'virtual:conch-reference';

import { Home } from '../home/Home';
import { Landing } from '../landing/Landing';
import { DocPage } from '../pages/DocPage';
import { Layout } from '../shell/Layout';
import { SECTIONS } from '../site/config';

function open(path: string) {
  return render(
    <NacreProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Landing />} />
            <Route path="docs" element={<Home />} />
            <Route path="*" element={<DocPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </NacreProvider>,
  );
}

/** Contrast needs real layout, which jsdom lacks: `pnpm a11y` and the eye cover it. */
const accessible = async (container: Element) =>
  expect(
    (await axe(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
  ).toEqual([]);

describe('the documentation’s front page', () => {
  it('says what the pages are, how to install Conch, and where everything is', async () => {
    const { container } = open('/docs');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Everything Conch does, in plain words.',
    );
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute(
      'href',
      '/start/install',
    );
    // Every section, provider and connectable channel the code has is one press away.
    for (const section of SECTIONS)
      expect(
        screen.getAllByRole('link', { name: new RegExp(`^${section.title}`) }).length,
      ).toBeGreaterThan(0);
    // ("Codex" and "Codex CLI" both start "Codex": each has its own page.)
    for (const provider of reference.providers)
      expect(
        screen
          .getAllByRole('link', { name: new RegExp(`^${provider.name}`) })
          .map((link) => link.getAttribute('href')),
      ).toContain(`/providers/${provider.id}`);
    await accessible(container);
  });
});

describe('a page', () => {
  it('shows its title, its words, the contents and its own headings', async () => {
    const { container } = open('/start/install');
    expect(screen.getByRole('heading', { level: 1, name: 'Install' })).toBeInTheDocument();
    const contents = screen.getByRole('navigation', { name: 'Documentation' });
    expect(within(contents).getByRole('link', { name: 'Install' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const onThisPage = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(onThisPage).getByRole('link', { name: 'From a checkout' })).toHaveAttribute(
      'href',
      '#from-a-checkout',
    );
    expect(screen.getByRole('link', { name: /Next:\s*The app/ })).toHaveAttribute(
      'href',
      '/start/app',
    );
    expect(document.title).toBe('Install · Conch');
    await accessible(container);
  });

  it('about a provider leads with what the code says about it', () => {
    open('/providers/codex-cli');
    const codex = reference.providers.find((provider) => provider.id === 'codex-cli');
    expect(screen.getByRole('heading', { level: 1, name: codex?.name })).toBeInTheDocument();
    const facts = screen.getByRole('region', { name: `${codex?.name} at a glance` });
    expect(facts).toHaveTextContent(codex?.description ?? '');
    for (const limit of codex?.limits ?? []) expect(facts).toHaveTextContent(limit);
  });

  it('renders direct Google catalog entries with guided user-owned setup and no hosted broker', () => {
    open('/features/apps');
    const google = reference.integrations.filter((app) => app.auth === 'google');
    expect(google.map((app) => app.id)).toEqual(
      expect.arrayContaining(['gmail', 'google-calendar', 'google-drive']),
    );
    expect(screen.getAllByText('Google sign-in · setup required')).toHaveLength(google.length);
    expect(
      screen.getByRole('heading', { name: /One-time setup, with no hosted connection service/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You need your own Google Cloud project/)).toHaveTextContent(
      'Desktop app',
    );
    expect(
      screen.getByText(/The same credential file works for a local Conch and a self-hosted server/),
    ).toBeInTheDocument();
  });

  it('about a channel leads with what the code says about it', () => {
    open('/channels/telegram');
    const telegram = reference.channels.find((channel) => channel.id === 'telegram');
    expect(screen.getByRole('heading', { level: 1, name: 'Telegram' })).toBeInTheDocument();
    expect(screen.getByText(telegram?.tagline ?? '')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Telegram at a glance' })).toHaveTextContent(
      `About ${telegram?.minutes} minutes`,
    );
  });

  it('lists the generated reference under headings the contents can reach', () => {
    open('/reference/cli');
    const onThisPage = screen.getByRole('navigation', { name: 'On this page' });
    for (const group of new Set(reference.cli.map((command) => command.group)))
      expect(within(onThisPage).getByRole('link', { name: group })).toBeInTheDocument();
    for (const command of reference.cli)
      expect(screen.getAllByRole('term').some((term) => term.textContent === command.usage)).toBe(
        true,
      );
  });

  it('moves to the next page from the contents', async () => {
    open('/start/install');
    const contents = screen.getByRole('navigation', { name: 'Documentation' });
    await userEvent.click(within(contents).getByRole('link', { name: 'Your first minute' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your first minute' }),
    ).toBeInTheDocument();
  });

  it('about privacy lives at /privacy, out of the sidebar and the front page’s footer links to it', async () => {
    const { container } = open('/privacy');
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.getByText(/We set no cookies/)).toBeInTheDocument();
    // No section, so no crumb: it isn't a decision record.
    expect(within(screen.getByRole('main')).queryByRole('link', { name: 'Decisions' })).toBeNull();
    const sidebar = screen.getByRole('navigation', { name: 'Documentation' });
    expect(within(sidebar).queryByRole('link', { name: 'Privacy policy' })).toBeNull();
    await accessible(container);
  });

  it('that doesn’t exist says so and offers the way back', () => {
    open('/no/such/page');
    expect(screen.getByRole('heading', { name: 'There’s no page here' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the start' })).toHaveAttribute('href', '/');
  });
});

describe('search', () => {
  it('opens from the bar and finds a command by what it does', async () => {
    const user = userEvent.setup();
    open('/');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const dialog = await screen.findByRole('dialog', { name: 'Search the documentation' });
    await user.type(within(dialog).getByRole('combobox'), 'forgot password');
    const hit = await within(dialog).findByRole('option', { name: /reset/ });
    await user.click(hit);
    expect(await screen.findByRole('heading', { level: 1, name: 'Command line' })).toBeVisible();
  });
});
