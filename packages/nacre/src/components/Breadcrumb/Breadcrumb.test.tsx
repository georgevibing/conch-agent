import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Breadcrumb } from './Breadcrumb';

describe('Breadcrumb', () => {
  it('is a labelled list of steps, the last read as the current page', async () => {
    const { container } = renderNacre(
      <Breadcrumb>
        <Breadcrumb.Item onClick={() => {}}>Settings</Breadcrumb.Item>
        <Breadcrumb.Item onClick={() => {}}>Memory</Breadcrumb.Item>
        <Breadcrumb.Item current>What Conch knows</Breadcrumb.Item>
      </Breadcrumb>,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByText('What Conch knows')).toHaveAttribute('aria-current', 'page');
    // The page you're on isn't a step anywhere.
    expect(screen.queryByRole('button', { name: 'What Conch knows' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    await expectAccessible(container);
  });

  it('steps back by click and by keyboard', async () => {
    const user = userEvent.setup();
    const back = vi.fn();
    renderNacre(
      <Breadcrumb aria-label="Where you are">
        <Breadcrumb.Item onClick={back}>Providers</Breadcrumb.Item>
        <Breadcrumb.Item current>Ollama Cloud</Breadcrumb.Item>
      </Breadcrumb>,
    );
    expect(screen.getByRole('navigation', { name: 'Where you are' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Providers' }));
    expect(back).toHaveBeenCalledTimes(1);
    (document.activeElement as HTMLElement).blur();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Providers' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(back).toHaveBeenCalledTimes(2);
    // The current page takes no focus.
    await user.tab();
    expect(document.body).toHaveFocus();
  });

  it('renders links, or your own link element', async () => {
    const { container } = renderNacre(
      <Breadcrumb>
        <Breadcrumb.Item href="/skills">Skills</Breadcrumb.Item>
        <Breadcrumb.Item asChild>
          <a href="/skills/discover">Discover</a>
        </Breadcrumb.Item>
        <Breadcrumb.Item current>Frontend design</Breadcrumb.Item>
      </Breadcrumb>,
    );
    expect(screen.getByRole('link', { name: 'Skills' })).toHaveAttribute('href', '/skills');
    expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute(
      'href',
      '/skills/discover',
    );
    await expectAccessible(container);
  });

  it('lets the page you’re on take the focus on arrival, never a Tab stop', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <Breadcrumb>
        <Breadcrumb.Item href="/apps">Apps</Breadcrumb.Item>
        <Breadcrumb.Item current tabIndex={-1}>
          Gmail
        </Breadcrumb.Item>
      </Breadcrumb>,
    );
    const here = screen.getByText('Gmail');
    here.focus();
    expect(here).toHaveFocus();
    // One step back to the way out.
    await user.tab({ shift: true });
    expect(screen.getByRole('link', { name: 'Apps' })).toHaveFocus();
    await user.tab();
    expect(here).not.toHaveFocus();
    await expectAccessible(container);
  });

  it('keeps the whole name for a step that may be cut short', () => {
    renderNacre(
      <Breadcrumb>
        <Breadcrumb.Item onClick={() => {}}>Memory</Breadcrumb.Item>
        <Breadcrumb.Item current>Bring your things from OpenClaw</Breadcrumb.Item>
      </Breadcrumb>,
    );
    expect(screen.getByRole('button', { name: 'Memory' })).toHaveAttribute('title', 'Memory');
    expect(screen.getByText('Bring your things from OpenClaw')).toHaveAttribute(
      'title',
      'Bring your things from OpenClaw',
    );
  });
});
