import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Prose } from './Prose';

describe('Prose', () => {
  it('renders semantic content accessibly', async () => {
    const { container } = renderNacre(
      <Prose as="article" measure size="sm">
        <h2>Title</h2>
        <p>
          Body with <a href="#x">a link</a> and <code>code</code>.
        </p>
        <ul>
          <li>One</li>
        </ul>
      </Prose>,
    );
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('data-measure');
    expect(article).toHaveAttribute('data-size', 'sm');
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
