import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderNacre } from '../../test/render';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('announces itself as a status by default', () => {
    renderNacre(<Spinner />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('is hidden from assistive tech when label is null', () => {
    const { container } = renderNacre(<Spinner label={null} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
