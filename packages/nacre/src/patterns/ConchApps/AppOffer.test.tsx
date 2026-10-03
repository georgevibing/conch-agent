import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { IntegrationCard } from '../Integrations/IntegrationCard';
import { AppIcon } from './AppIcon';
import { AppMadeBadge } from './AppMadeBadge';
import { AppOffer, type AppOfferProps } from './AppOffer';
import {
  coffeeTab,
  coffeeTools,
  coffeeWords,
  plantDiary,
  plantTools,
  plantWords,
} from './fixtures';
import { APP_GLYPH_ICONS, APP_GLYPHS, appColor, appGlyphIcon } from './glyphs';

const offer = (over: Partial<AppOfferProps> = {}): AppOfferProps => ({
  action: 'add',
  manifest: plantDiary,
  tools: plantTools,
  source: { kind: 'made' },
  signature: { state: 'unsigned' },
  words: plantWords,
  state: 'ready',
  summary: 'I made you a plant diary.',
  ...over,
});

describe('AppIcon', () => {
  it('draws every glyph an app may choose', () => {
    for (const glyph of APP_GLYPHS) expect(APP_GLYPH_ICONS[glyph]).toBeTruthy();
    // Something odd from an old file gets the sparkle and slate, never nothing.
    expect(appGlyphIcon('constructor')).toBe(APP_GLYPH_ICONS.sparkles);
    expect(appGlyphIcon('nope')).toBe(APP_GLYPH_ICONS.sparkles);
    expect(appColor('mauve')).toBe('slate');
    expect(appColor('teal')).toBe('teal');
  });

  it('is named when it stands alone, and quiet beside its name', async () => {
    const { container } = renderNacre(
      <>
        <AppIcon glyph="sprout" color="green" label="Plant diary" />
        <AppIcon glyph="coffee" color="amber" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Plant diary' })).toHaveAttribute(
      'data-app-color',
      'green',
    );
    expect(container.querySelectorAll('[aria-hidden="true"][data-app-color="amber"]')).toHaveLength(
      1,
    );
    await expectAccessible(container);
  });

  it('sits on an integration card with its badge, and the card still opens', async () => {
    const onOpen = vi.fn();
    const { container } = renderNacre(
      <IntegrationCard
        variant="connected"
        name="Plant diary"
        app={{ glyph: 'sprout', color: 'green' }}
        badge={<AppMadeBadge kind="made" />}
        state="ok"
        meta="3 tools"
        enabled
        onToggle={() => {}}
        onOpen={onOpen}
      />,
    );
    expect(container.querySelector('[data-app-color="green"]')).not.toBeNull();
    expect(screen.getByText('Made by you')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Plant diary' }));
    expect(onOpen).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });
});

describe('AppOffer', () => {
  it('says what the app can do and adds it with what the person typed', async () => {
    const onAdd = vi.fn();
    const onOpenPage = vi.fn();
    const { container } = renderNacre(
      <AppOffer {...offer()} onAdd={onAdd} onOpenPage={onOpenPage} onNotNow={() => {}} />,
    );
    const card = screen.getByRole('group', { name: 'Plant diary' });
    expect(card).toHaveTextContent('Made by you · 1.0.0');
    expect(card).toHaveTextContent('I made you a plant diary.');
    const can = screen.getByRole('list', { name: 'What Plant diary can do' });
    expect(
      within(can)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([...plantWords.abilities.map((a) => a.text), 'A page: My plants']);

    // The secret is masked, kept from autofill, and can be shown.
    const key = screen.getByLabelText('Weather API key');
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveAttribute('autocomplete', 'off');
    await userEvent.type(key, '  sk-123  ');
    await userEvent.click(screen.getByRole('button', { name: 'Show Weather API key' }));
    expect(key).toHaveAttribute('type', 'text');
    // Get it opens the page that makes one, in its own tab, telling it nothing.
    const getIt = screen.getByRole('link', { name: 'Get Weather API key (opens in a new tab)' });
    expect(getIt).toHaveAttribute('href', 'https://open-meteo.com/en/pricing');
    expect(getIt).toHaveAttribute('target', '_blank');
    expect(getIt.getAttribute('rel')).toContain('noreferrer');

    await userEvent.click(screen.getByRole('button', { name: 'Open the page' }));
    expect(onOpenPage).toHaveBeenCalledWith('main');
    await userEvent.click(screen.getByRole('button', { name: 'Add Plant diary to my apps' }));
    // Trimmed, and only what was typed: the empty city isn't sent.
    expect(onAdd).toHaveBeenCalledWith({ weatherKey: 'sk-123' });
    await expectAccessible(container);
  });

  it('lists its tools on request, changes first', async () => {
    renderNacre(<AppOffer {...offer()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Its 3 tools' }));
    const list = screen.getByText('Changes things').closest('ul') as HTMLElement;
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.firstElementChild?.firstElementChild?.textContent)).toEqual([
      'Log watering',
      'Find plants',
      'When last watered',
    ]);
    expect(screen.getByText('Changes things')).toBeInTheDocument();
    expect(screen.getAllByText('Looks')).toHaveLength(2);
  });

  it('never links a setting anywhere but https', () => {
    renderNacre(
      <AppOffer
        {...offer({
          manifest: {
            ...plantDiary,
            settings: [{ key: 'k', label: 'Key', link: 'javascript:alert(1)', secret: true }],
          },
        })}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('holds still while it’s being added', () => {
    renderNacre(<AppOffer {...offer({ busy: true })} onAdd={() => {}} onNotNow={() => {}} />);
    expect(screen.getByRole('group', { name: 'Plant diary' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Add Plant diary to my apps' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled();
    expect(screen.getByLabelText('City')).toBeDisabled();
  });

  it('shows an update’s changes first, and asks only for settings without a value', async () => {
    const onAdd = vi.fn();
    const { container } = renderNacre(
      <AppOffer
        {...offer({
          action: 'update',
          manifest: { ...plantDiary, version: '1.1.0' },
          changes: { from: '1.0.0', to: '1.1.0', reachesAdded: ['api.gbif.org'] },
          words: { ...plantWords, changes: ['Now also reaches api.gbif.org', 'New: Name a plant'] },
          saved: ['weatherKey'],
        })}
        onAdd={onAdd}
      />,
    );
    const news = screen.getByRole('region', { name: 'What’s new in 1.1.0' });
    const lines = within(news).getAllByRole('listitem');
    expect(lines[0]).toHaveTextContent('Now also reaches api.gbif.org');
    expect(lines[0]).toHaveAttribute('data-marked');
    expect(lines[1]).not.toHaveAttribute('data-marked');
    expect(screen.queryByLabelText('Weather API key')).toBeNull();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Update Plant diary' }));
    expect(onAdd).toHaveBeenCalledWith({});
    await expectAccessible(container);
  });

  it('names who signed someone else’s app', () => {
    renderNacre(
      <AppOffer
        {...offer({
          manifest: coffeeTab,
          tools: coffeeTools,
          words: coffeeWords,
          source: { kind: 'github' },
          signature: { state: 'untrusted', publisher: 'Ada Lovelace' },
        })}
      />,
    );
    expect(screen.getByText('Signed by Ada Lovelace · 2.1.0')).toBeInTheDocument();
    expect(
      screen.getByRole('region', {
        name: 'Signed by Ada Lovelace, who you haven’t said you trust',
      }),
    ).toHaveTextContent('on their apps');
  });

  it('welcomes it once added, with its examples to try and a way in', async () => {
    const onTry = vi.fn();
    const onOpenApp = vi.fn();
    const { container, rerender } = renderNacre(
      <AppOffer {...offer()} onAdd={() => {}} onTry={onTry} onOpenApp={onOpenApp} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add Plant diary to my apps' }));
    rerender(<AppOffer {...offer({ state: 'added' })} onTry={onTry} onOpenApp={onOpenApp} />);
    expect(screen.getByRole('status')).toHaveTextContent('Plant diary is in your apps');
    // Focus doesn't fall to the page: it lands on the way in.
    expect(screen.getByRole('button', { name: 'Open Plant diary' })).toHaveFocus();
    expect(container.querySelector('[data-arrived]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open Plant diary' }));
    expect(onOpenApp).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'I watered the fern' }));
    await vi.waitFor(() => expect(onTry).toHaveBeenCalledWith('I watered the fern'));
    await expectAccessible(container);
  });

  it('opened from history, the welcome doesn’t play again', () => {
    const { container } = renderNacre(<AppOffer {...offer({ state: 'added' })} />);
    expect(container.querySelector('[data-arrived]')).toBeNull();
  });

  it('says an update landed with its version', () => {
    renderNacre(
      <AppOffer
        {...offer({
          state: 'updated',
          action: 'update',
          manifest: { ...plantDiary, version: '1.1.0' },
        })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Plant diary is updated to 1.1.0');
  });

  it('folds to one quiet line when a newer version overtakes it, or it’s declined', async () => {
    const { rerender, container } = renderNacre(<AppOffer {...offer({ state: 'stale' })} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Plant diary 1.0.0·A newer version is below',
    );
    expect(screen.queryByRole('button')).toBeNull();
    await expectAccessible(container);
    rerender(<AppOffer {...offer({ state: 'declined' })} />);
    expect(screen.getByRole('note')).toHaveTextContent('Didn’t add Plant diary');
  });

  it('says why it failed in one sentence, and tries again with the same settings', async () => {
    const onAdd = vi.fn();
    const { rerender } = renderNacre(<AppOffer {...offer()} onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText('City'), 'Lisbon');
    rerender(
      <AppOffer
        {...offer({ state: 'failed', message: 'It changed since this card was shown.' })}
        onAdd={onAdd}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('It changed since this card was shown.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onAdd).toHaveBeenCalledWith({ city: 'Lisbon' });
  });

  it('takes a protocol offer spread straight in, without leaking its ids to the page', () => {
    const { container } = renderNacre(
      <AppOffer {...offer()} offerId="o1" from="draft" draftId="d1" hash="abc" />,
    );
    expect(container.innerHTML).not.toContain('o1');
    expect(container.innerHTML).not.toContain('abc');
  });
});
