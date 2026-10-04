import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderNacre } from '../../test/render';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('appears on focus, is described-by linked, and dismisses on Escape', async () => {
    renderNacre(
      <Tooltip content="Copy message" shortcut="mod+c">
        <button type="button">Copy</button>
      </Tooltip>,
    );
    await userEvent.tab();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Copy message');
    expect(screen.getByRole('button')).toHaveAttribute('aria-describedby');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('stays away on a touch-only screen, where focus moves by itself', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...original(query),
      matches: query === '(hover: none) and (pointer: coarse)',
    })) as typeof window.matchMedia;
    try {
      renderNacre(
        <Tooltip content="New chat" shortcut="mod+shift+o">
          <button type="button">New chat</button>
        </Tooltip>,
      );
      await userEvent.tab();
      expect(screen.getByRole('button')).toHaveFocus();
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('renders only the trigger when disabled', () => {
    renderNacre(
      <Tooltip content="Hidden" disabled defaultOpen>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
