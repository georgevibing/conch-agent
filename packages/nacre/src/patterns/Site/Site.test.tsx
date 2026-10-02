import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Bento } from './Bento';
import { Facts } from './Facts';
import { LogoChip } from './LogoChip';
import { Marquee } from './Marquee';
import { Reveal } from './Reveal';
import { Scene } from './Scene';
import { Stage } from './Stage';
import { Statement } from './Statement';
import { Steady } from './Steady';
import { TextLink } from './TextLink';

afterEach(() => vi.unstubAllGlobals());

/** A browser that can tell what's in view, with the moment it says so in the test's hands. */
function watchedViewport() {
  const observers: { callback: IntersectionObserverCallback; disconnected: boolean }[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      #entry: { callback: IntersectionObserverCallback; disconnected: boolean };
      constructor(callback: IntersectionObserverCallback) {
        this.#entry = { callback, disconnected: false };
        observers.push(this.#entry);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        this.#entry.disconnected = true;
      }
    },
  );
  return {
    observers,
    scroll(isIntersecting: boolean) {
      act(() => {
        for (const observer of observers)
          if (!observer.disconnected)
            observer.callback(
              [{ isIntersecting } as IntersectionObserverEntry],
              {} as IntersectionObserver,
            );
      });
    },
  };
}

describe('Reveal', () => {
  it('shows its content at once where the browser can’t say what’s in view', () => {
    renderNacre(<Reveal>Words</Reveal>);
    expect(screen.getByText('Words')).toHaveAttribute('data-shown');
  });

  it('surfaces when it scrolls into view, once, and stops watching', () => {
    const viewport = watchedViewport();
    renderNacre(<Reveal>Words</Reveal>);
    const words = screen.getByText('Words');
    // In the page from the start, for a screen reader; not yet surfaced.
    expect(words).not.toHaveAttribute('data-shown');
    viewport.scroll(true);
    expect(words).toHaveAttribute('data-shown');
    expect(viewport.observers.every((observer) => observer.disconnected)).toBe(true);
  });

  it('merges onto its child with asChild', () => {
    renderNacre(
      <Reveal asChild>
        <section aria-label="Part">Words</section>
      </Reveal>,
    );
    expect(screen.getByRole('region', { name: 'Part' })).toHaveAttribute('data-shown');
  });
});

describe('Stage', () => {
  it('is a picture with a sentence for a name; nothing inside is read or reachable', async () => {
    const { container } = renderNacre(
      <Stage label="A question answered in Conch" bar="Claude Code">
        <button type="button">Allow</button>
      </Stage>,
    );
    const picture = screen.getByRole('figure', { name: 'A question answered in Conch' });
    expect(within(picture).queryByRole('button')).toBeNull();
    const button = container.querySelector('button');
    expect(button?.closest('[inert]')).not.toBeNull();
    expect(button?.closest('[aria-hidden="true"]')).not.toBeNull();
    await expectAccessible(container);
  });

  it('orbits its rim only while something is happening', () => {
    const { container, rerender } = renderNacre(<Stage label="Still">x</Stage>);
    expect(container.querySelector('[data-lustre-ambient]')).toBeNull();
    rerender(
      <Stage label="Working" alive>
        x
      </Stage>,
    );
    expect(container.querySelector('[data-lustre-ambient]')).not.toBeNull();
  });
});

describe('Scene', () => {
  it('is a section named by its claim, with the words before the picture', async () => {
    const { container } = renderNacre(
      <Scene
        kicker="Providers"
        title="Every provider. One picker."
        points={['A chat can move between them.', 'Keys can live in 1Password.']}
        stage={<Stage label="The model picker">x</Stage>}
      >
        <p>Connect as many as you like.</p>
      </Scene>,
    );
    const scene = screen.getByRole('region', { name: 'Every provider. One picker.' });
    expect(within(scene).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Every provider. One picker.',
    );
    expect(within(scene).getAllByRole('listitem')).toHaveLength(2);
    const words = within(scene).getByText('Connect as many as you like.');
    const picture = within(scene).getByRole('figure', { name: 'The model picker' });
    // Words first in the page, whichever side the picture is drawn on.
    expect(words.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expectAccessible(container);
  });

  it('keeps the words first in the page when the picture is drawn first', () => {
    renderNacre(
      <Scene flip title="Safe hands" stage={<Stage label="An approval">x</Stage>}>
        <p>It asks first.</p>
      </Scene>,
    );
    const words = screen.getByText('It asks first.');
    const picture = screen.getByRole('figure', { name: 'An approval' });
    expect(words.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Bento', () => {
  it('makes each tile an article named by its title, with its picture described', async () => {
    const { container } = renderNacre(
      <Bento>
        <Bento.Tile
          span={4}
          title="Undo"
          text="Every file can be put back."
          picture="A file put back"
        >
          <button type="button">Undo</button>
        </Bento.Tile>
        <Bento.Tile title="Show me" />
      </Bento>,
    );
    const undo = screen.getByRole('article', { name: 'Undo' });
    expect(undo).toHaveAttribute('data-span', '4');
    expect(undo).toHaveTextContent('Every file can be put back.');
    expect(within(undo).getByRole('figure', { name: 'A file put back' })).toBeInTheDocument();
    expect(within(undo).queryByRole('button')).toBeNull();
    expect(screen.getByRole('article', { name: 'Show me' })).toHaveAttribute('data-span', '2');
    await expectAccessible(container);
  });
});

describe('Marquee', () => {
  it('reads its items once, though it draws them twice to have no end', async () => {
    const { container } = renderNacre(
      <Marquee
        label="Chat apps"
        items={[<LogoChip key="a">Telegram</LogoChip>, <LogoChip key="b">Signal</LogoChip>]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Chat apps' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(container.querySelectorAll('ul')).toHaveLength(2);
    await expectAccessible(container);
  });

  it('can drift the other way, at its own pace', () => {
    const { container } = renderNacre(<Marquee label="Apps" items={['a']} reverse seconds={60} />);
    const root = container.querySelector('[data-reverse]') as HTMLElement;
    expect(root.style.getPropertyValue('--mq-seconds')).toBe('60s');
  });
});

describe('LogoChip', () => {
  it('says in words when something isn’t here yet', () => {
    renderNacre(<LogoChip soon>iMessage</LogoChip>);
    expect(screen.getByText('iMessage').parentElement).toHaveTextContent('iMessagesoon');
  });
});

describe('Facts', () => {
  it('pairs each number with what it counts', async () => {
    const { container } = renderNacre(
      <Facts label="Conch in numbers">
        <Facts.Item value="5" label="providers" />
        <Facts.Item value="0" label="accounts to make" />
      </Facts>,
    );
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'providers',
      'accounts to make',
    ]);
    expect(screen.getAllByRole('definition').map((value) => value.textContent)).toEqual(['5', '0']);
    await expectAccessible(container);
  });
});

describe('Statement', () => {
  it('is a quotation with who said it, when it is one', async () => {
    const { container } = renderNacre(
      <Statement variant="quote" from="The person who built it">
        <p>I built this for myself.</p>
      </Statement>,
    );
    const figure = screen.getByRole('figure');
    expect(figure.querySelector('blockquote')).toHaveTextContent('I built this for myself.');
    expect(figure.querySelector('figcaption')).toHaveTextContent('The person who built it');
    await expectAccessible(container);
  });

  it('is the page’s own voice otherwise', () => {
    renderNacre(<Statement>Whoever holds the conch gets to speak.</Statement>);
    expect(screen.getByRole('figure').querySelector('blockquote')).toBeNull();
  });
});

describe('TextLink', () => {
  it('is a link by its words alone, arrow or not', async () => {
    const { container } = renderNacre(
      <p>
        Read <TextLink href="/security">how it’s protected</TextLink> first.{' '}
        <TextLink href="/providers" arrow="forward">
          Compare the providers
        </TextLink>
      </p>,
    );
    expect(screen.getByRole('link', { name: 'how it’s protected' })).toHaveAttribute(
      'href',
      '/security',
    );
    const onward = screen.getByRole('link', { name: 'Compare the providers' });
    expect(onward).toHaveAttribute('data-arrow', 'forward');
    expect(onward.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await expectAccessible(container);
  });

  it('renders a router’s own link with asChild, arrow included', () => {
    renderNacre(
      <TextLink asChild arrow="away">
        <a href="https://example.com" data-router="">
          GitHub
        </a>
      </TextLink>,
    );
    const link = screen.getByRole('link', { name: 'GitHub' });
    expect(link).toHaveAttribute('data-router');
    expect(link.querySelector('svg')).not.toBeNull();
  });
});

describe('Steady', () => {
  it('holds room for its tallest moments, unseen and out of reach', async () => {
    const { container } = renderNacre(
      <Steady
        align="end"
        holds={[
          <div key="all">
            <button type="button">Turn on</button>
            <p>Every line the script will ever show</p>
          </div>,
        ]}
      >
        <p>The first line</p>
      </Steady>,
    );
    // What's showing is there to read; what holds the room is not.
    expect(screen.getByText('The first line')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
    const hold = screen.getByText('Every line the script will ever show').closest('[inert]');
    expect(hold).toHaveAttribute('aria-hidden', 'true');
    expect(hold?.parentElement).toHaveAttribute('data-align', 'end');
    await expectAccessible(container);
  });
});

describe('Bento.Tile live', () => {
  it('leaves the real thing in reach instead of making a picture of it', async () => {
    const { container } = renderNacre(
      <Bento>
        <Bento.Tile title="Show me" text="A chart you can turn into a table." live>
          <button type="button">Table</button>
        </Bento.Tile>
        <Bento.Tile title="Undo" picture="Three files put back with one press">
          <button type="button">Undo</button>
        </Bento.Tile>
      </Bento>,
    );
    expect(screen.getByRole('button', { name: 'Table' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('figure')).toHaveLength(1);
    await expectAccessible(container);
  });
});
