import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Brain } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { CommandLine } from './CommandLine';
import { Definitions } from './Definitions';
import { DocsHero } from './DocsHero';
import { DocsNav } from './DocsNav';
import { DocsPager } from './DocsPager';
import { DocsToc } from './DocsToc';
import { LinkCard } from './LinkCard';
import { OsMark } from './OsMark';
import { Steps } from './Steps';
import { Tick } from './Tick';

describe('DocsNav', () => {
  it('groups links under headings and marks the page being read', async () => {
    const { container } = renderNacre(
      <DocsNav label="Documentation">
        <DocsNav.Section title="Get started">
          <DocsNav.Link href="/install">Install</DocsNav.Link>
          <DocsNav.Link href="/first-chat" active>
            Your first chat
          </DocsNav.Link>
        </DocsNav.Section>
        <DocsNav.Section title="Reference">
          <DocsNav.Link href="/cli">Command line</DocsNav.Link>
        </DocsNav.Section>
      </DocsNav>,
    );
    const nav = screen.getByRole('navigation', { name: 'Documentation' });
    const group = within(nav).getByRole('region', { name: 'Get started' });
    expect(within(group).getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Your first chat' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Install' })).not.toHaveAttribute('aria-current');
    await expectAccessible(container);
  });

  it('renders a router’s own link with asChild, keeping its name', () => {
    renderNacre(
      <DocsNav label="Documentation">
        <DocsNav.Section title="Get started">
          <DocsNav.Link asChild active>
            <a href="/install" data-router="">
              Install
            </a>
          </DocsNav.Link>
        </DocsNav.Section>
      </DocsNav>,
    );
    const link = screen.getByRole('link', { name: 'Install' });
    expect(link).toHaveAttribute('data-router');
    expect(link).toHaveAttribute('href', '/install');
    expect(link).toHaveAttribute('aria-current', 'page');
  });
});

describe('DocsToc', () => {
  const items = [
    { id: 'one-line', text: 'One line', level: 2 },
    { id: 'what-it-does', text: 'What it does', level: 3 },
  ] as const;

  it('links to each heading and says which one is in view', async () => {
    const { container } = renderNacre(<DocsToc items={items} activeId="what-it-does" />);
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(nav).getByRole('link', { name: 'One line' })).toHaveAttribute(
      'href',
      '#one-line',
    );
    expect(within(nav).getByRole('link', { name: 'What it does' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    await expectAccessible(container);
  });

  it('is nothing at all for a page with no headings', () => {
    const { container } = renderNacre(<DocsToc items={[]} />);
    expect(container.querySelector('nav')).toBeNull();
  });
});

describe('DocsPager', () => {
  it('names each direction with the page it leads to', async () => {
    const { container } = renderNacre(
      <DocsPager>
        <DocsPager.Link direction="previous" title="Install" href="/install" />
        <DocsPager.Link direction="next" title="On your phone" href="/phone" />
      </DocsPager>,
    );
    expect(screen.getByRole('link', { name: /Previous:\s*Install/ })).toHaveAttribute(
      'href',
      '/install',
    );
    expect(screen.getByRole('link', { name: /Next:\s*On your phone/ })).toHaveAttribute(
      'href',
      '/phone',
    );
    await expectAccessible(container);
  });
});

describe('LinkCard', () => {
  it('is one link that carries its title, facts and description', async () => {
    const { container } = renderNacre(
      <LinkCard
        href="/memory"
        icon={<Brain />}
        title="Memory"
        meta="2 min"
        description="Small files you can read."
      />,
    );
    const link = screen.getByRole('link', { name: /Memory/ });
    expect(link).toHaveAttribute('href', '/memory');
    expect(link).toHaveTextContent('2 min');
    expect(link).toHaveTextContent('Small files you can read.');
    await expectAccessible(container);
  });
});

describe('CommandLine', () => {
  it('shows the whole command and copies it without the prompt', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = renderNacre(<CommandLine command="pnpm start" typed />);
    expect(screen.getByRole('group', { name: 'Command' })).toHaveTextContent('pnpm start');
    await user.click(screen.getByRole('button', { name: 'Copy command' }));
    expect(writeText).toHaveBeenCalledWith('pnpm start');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('can be scrolled from the keyboard when the line runs on', () => {
    renderNacre(<CommandLine command="curl -fsSL https://example.com/install.sh | sh" />);
    expect(screen.getByRole('group', { name: 'Command' })).toHaveAttribute('tabindex', '0');
  });
});

describe('Definitions', () => {
  it('pairs each term with what it means', async () => {
    const { container } = renderNacre(
      <Definitions label="Settings">
        <Definitions.Item term="CONCH_PORT" meta="Unset: 4317">
          Pins the port.
        </Definitions.Item>
        <Definitions.Item term="CONCH_HOME">Where Conch keeps its files.</Definitions.Item>
      </Definitions>,
    );
    const terms = screen.getAllByRole('term');
    expect(terms).toHaveLength(2);
    expect(terms[0]).toHaveTextContent('CONCH_PORT');
    expect(terms[0]).toHaveTextContent('Unset: 4317');
    expect(screen.getAllByRole('definition')[0]).toHaveTextContent('Pins the port.');
    await expectAccessible(container);
  });
});

describe('Steps', () => {
  it('is an ordered list, in order, with optional headings', async () => {
    const { container } = renderNacre(
      <Steps>
        <Steps.Step>Open BotFather.</Steps.Step>
        <Steps.Step title="Say hello">Open the link.</Steps.Step>
      </Steps>,
    );
    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent('Open BotFather.');
    expect(steps[1]).toHaveTextContent('Say hello');
    await expectAccessible(container);
  });
});

describe('Tick', () => {
  it('says yes or no in words, not only with a mark', () => {
    renderNacre(
      <>
        <Tick value />
        <Tick value={false} />
        <Tick value label="Works offline" />
      </>,
    );
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('Works offline')).toBeInTheDocument();
  });
});

describe('DocsHero', () => {
  it('is the page’s one top heading, with what to do first', async () => {
    const { container } = renderNacre(
      <DocsHero
        eyebrow="Conch documentation"
        title="Whoever holds the conch gets to speak."
        lede="A calm home for your assistants."
        actions={<a href="/start">Get started</a>}
        media={<img src="" alt="Conch answering a question" />}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Whoever holds the conch gets to speak.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Conch answering a question' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('OsMark', () => {
  it('decorates the system’s name, and is only read out when it stands alone', async () => {
    const { container } = renderNacre(
      <p>
        <OsMark os="macos" /> macOS and <OsMark os="linux" /> Linux, or{' '}
        <OsMark os="windows" label="Windows" />
      </p>,
    );
    const marks = container.querySelectorAll('svg');
    expect(marks).toHaveLength(3);
    expect(marks[0]).toHaveAttribute('aria-hidden', 'true');
    expect(marks[1]).toHaveAttribute('data-os', 'linux');
    for (const mark of marks) expect(mark.querySelector('path')?.getAttribute('d')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Windows' })).toBe(marks[2]);
    await expectAccessible(container);
  });
});
