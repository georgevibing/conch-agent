import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderNacre, expectAccessible } from '../../test/render';
import { Sources } from './Sources';

describe('Sources', () => {
  it('shows source titles and excerpts as text and offers safe links accessibly', async () => {
    const { container } = renderNacre(
      <Sources
        sources={[
          {
            title: 'Research',
            url: 'https://example.org/article',
            snippet: '<script>outside text</script>',
          },
        ]}
      />,
    );
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelector('script')).toBeNull();
    await userEvent.tab();
    expect(screen.getByRole('link')).toHaveFocus();
    await expectAccessible(container);
  });
  it('folds long lists and refuses non-web links', async () => {
    renderNacre(
      <Sources
        sources={Array.from({ length: 8 }, (_, i) => ({
          title: `Source ${i}`,
          url: 'javascript:alert(1)',
        }))}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Source 7')).toBeNull();
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(screen.getByText('Source 7')).toBeInTheDocument();
  });
  it('says when there are no results', () => {
    renderNacre(<Sources sources={[]} />);
    expect(screen.getByText('No sources found.')).toBeInTheDocument();
  });
});
