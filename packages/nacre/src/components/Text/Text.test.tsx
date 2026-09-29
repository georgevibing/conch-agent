import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderNacre } from '../../test/render';
import { Heading, Text } from './Text';

describe('Text / Heading', () => {
  it('renders the chosen element', () => {
    renderNacre(<Text as="span">hello</Text>);
    expect(screen.getByText('hello').tagName).toBe('SPAN');
  });

  it('maps heading level to element and default size', () => {
    renderNacre(<Heading level={3}>Title</Heading>);
    const h = screen.getByRole('heading', { level: 3, name: 'Title' });
    expect(h).toHaveAttribute('data-size', 'xl');
  });

  it('sets line clamp for multi-line truncation', () => {
    renderNacre(<Text truncate={3}>long</Text>);
    expect(screen.getByText('long')).toHaveAttribute('data-truncate', '3');
  });
});
