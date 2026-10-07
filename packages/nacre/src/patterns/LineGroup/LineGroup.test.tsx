import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { LineGroup } from './LineGroup';

describe('LineGroup', () => {
  it('says the lines as one, and opens to them from the keyboard', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <LineGroup
        summary="Read 2 sites."
        items={['a.example', 'b.example']}
        label="What it read"
        footnote="I ask before acting on it."
      />,
    );
    const summary = screen.getByRole('button', { name: 'Read 2 sites.' });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).toBeNull();
    await user.tab();
    expect(summary).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: 'What it read' })).toHaveTextContent(
      'a.exampleb.example',
    );
    expect(screen.getByText('I ask before acting on it.')).toBeInTheDocument();
    await expectAccessible(container);
    await user.keyboard(' ');
    expect(summary).toHaveAttribute('aria-expanded', 'false');
  });

  it('can start open', () => {
    renderNacre(
      <LineGroup summary="Ran 3 checks" items={['a', 'b', 'c']} label="Checks" defaultOpen />,
    );
    expect(screen.getByRole('list', { name: 'Checks' })).toBeInTheDocument();
  });
});
