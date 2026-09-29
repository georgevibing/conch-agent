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

  it('renders only the trigger when disabled', () => {
    renderNacre(
      <Tooltip content="Hidden" disabled defaultOpen>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
