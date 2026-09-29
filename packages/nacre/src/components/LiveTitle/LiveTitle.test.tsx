import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { LiveTitle } from './LiveTitle';

describe('LiveTitle', () => {
  it('marks a pending title as busy', async () => {
    const { container } = renderNacre(<LiveTitle pending>Hi conch how are you</LiveTitle>);
    const title = screen.getByText('Hi conch how are you');
    expect(title).toHaveAttribute('aria-busy', 'true');
    expect(title).toHaveAttribute('data-pending');
    await expectAccessible(container);
  });

  it('reveals the real title once it arrives', () => {
    const { rerender } = renderNacre(<LiveTitle pending>Hi conch how are you</LiveTitle>);
    rerender(<LiveTitle>Friendly check-in</LiveTitle>);
    const title = screen.getByText('Friendly check-in');
    expect(title).not.toHaveAttribute('aria-busy');
    expect(title).not.toHaveAttribute('data-pending');
    expect(title).toHaveAttribute('data-revealed');
  });

  it('settles quietly when the placeholder is kept', () => {
    const { rerender } = renderNacre(<LiveTitle pending>Explain monads</LiveTitle>);
    rerender(<LiveTitle>Explain monads</LiveTitle>);
    expect(screen.getByText('Explain monads')).not.toHaveAttribute('data-revealed');
  });

  it('does not animate ordinary changes such as a rename', () => {
    const { rerender } = renderNacre(<LiveTitle>Old name</LiveTitle>);
    rerender(<LiveTitle>New name</LiveTitle>);
    expect(screen.getByText('New name')).not.toHaveAttribute('data-revealed');
  });
});
