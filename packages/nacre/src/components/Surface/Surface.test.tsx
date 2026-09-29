import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Card, Surface } from './Surface';

describe('Surface', () => {
  it('maps props to data attributes', () => {
    renderNacre(
      <Surface data-testid="s" lustre="ambient" variant="sunken" padding={4}>
        x
      </Surface>,
    );
    const el = screen.getByTestId('s');
    expect(el).toHaveAttribute('data-variant', 'sunken');
    expect(el).toHaveAttribute('data-lustre');
    expect(el).toHaveAttribute('data-lustre-ambient');
    expect(el.style.padding).toBe('var(--nc-space-4)');
  });

  it('defaults raised surfaces to elevation 2', () => {
    renderNacre(<Surface data-testid="s">x</Surface>);
    expect(screen.getByTestId('s')).toHaveAttribute('data-elevation', '2');
  });

  it('renders an accessible card', async () => {
    const { container } = renderNacre(
      <Card as="article">
        <Card.Header>
          <Card.Title>Session</Card.Title>
          <Card.Description>Details</Card.Description>
        </Card.Header>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Session' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
