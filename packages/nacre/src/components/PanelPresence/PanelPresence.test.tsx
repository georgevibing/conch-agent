import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { PanelPresence } from './PanelPresence';

function panel() {
  return document.querySelector<HTMLElement>('[data-nc-panel]');
}

describe('PanelPresence', () => {
  afterEach(() => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations;
  });

  it('arrives from its side with the glint, and is accessible', async () => {
    const { container } = renderNacre(
      <PanelPresence open side="bottom" aria-label="Terminal" role="region">
        <p>Shell</p>
      </PanelPresence>,
    );
    const el = panel();
    expect(el).toHaveAttribute('data-side', 'bottom');
    expect(el).toHaveAttribute('data-state', 'open');
    expect(el).toHaveAttribute('data-animate');
    expect(el?.querySelector('[data-nc-glint]')).toHaveAttribute('aria-hidden', 'true');
    await expectAccessible(container);
  });

  it("doesn't play for a panel already open when it first draws, with appear off", () => {
    renderNacre(
      <PanelPresence open appear={false}>
        <p>Sidebar</p>
      </PanelPresence>,
    );
    expect(panel()).not.toHaveAttribute('data-animate');
  });

  it('goes at once when there is nothing to play', () => {
    const { rerender } = renderNacre(
      <PanelPresence open>
        <p>Browser</p>
      </PanelPresence>,
    );
    rerender(
      <PanelPresence open={false}>
        <p>Browser</p>
      </PanelPresence>,
    );
    expect(panel()).toBeNull();
    expect(screen.queryByText('Browser')).toBeNull();
  });

  it('keeps what it showed on screen until the exit has played', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    HTMLElement.prototype.getAnimations = vi.fn(() => [{ finished } as unknown as Animation]);

    const { rerender } = renderNacre(
      <PanelPresence open>
        <p>Made for you</p>
      </PanelPresence>,
    );
    // The caller empties the panel as it closes; what it showed stays.
    rerender(<PanelPresence open={false}>{null}</PanelPresence>);
    expect(panel()).toHaveAttribute('data-state', 'closed');
    expect(screen.getByText('Made for you')).toBeInTheDocument();

    await act(async () => {
      finish();
      await finished;
    });
    expect(panel()).toBeNull();
  });

  it('stays in the page while closed with keepMounted', () => {
    const { rerender } = renderNacre(
      <PanelPresence open keepMounted appear={false} side="left">
        <p>Chats</p>
      </PanelPresence>,
    );
    rerender(
      <PanelPresence open={false} keepMounted appear={false} side="left">
        <p>Chats</p>
      </PanelPresence>,
    );
    expect(panel()).toHaveAttribute('data-state', 'closed');
    expect(panel()).toHaveAttribute('data-animate');
    expect(screen.getByText('Chats')).toBeInTheDocument();
  });
});
