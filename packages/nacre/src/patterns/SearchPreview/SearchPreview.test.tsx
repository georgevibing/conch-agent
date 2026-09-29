import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { SearchPreview } from './SearchPreview';

describe('SearchPreview', () => {
  it('shows messages with marked matches and the focused one', async () => {
    const { container } = renderNacre(
      <SearchPreview
        title="Infra"
        meta="4 messages"
        messages={[
          { id: 'a', from: 'user', author: 'You', text: 'hello' },
          {
            id: 'b',
            from: 'assistant',
            author: 'Conch',
            text: 'redeploy now',
            ranges: [[0, 8]],
            focus: true,
          },
        ]}
      />,
    );
    expect(screen.getByRole('region', { name: 'Preview' })).toHaveTextContent('Infra');
    expect(container.querySelector('[data-focus] mark')?.textContent).toBe('redeploy');
    await expectAccessible(container);
  });

  it('shows a skeleton while loading', () => {
    const { container } = renderNacre(<SearchPreview title="…" loading />);
    expect(container.querySelectorAll('article')).toHaveLength(0);
  });
});
