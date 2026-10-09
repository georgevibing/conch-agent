import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders a heading at the requested level with description and actions', async () => {
    const { container } = renderNacre(
      <EmptyState
        headingLevel={3}
        icon={<svg />}
        title="Nothing yet"
        description="Start a session."
        actions={<button type="button">New</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Nothing yet' })).toBeInTheDocument();
    expect(screen.getByText('Start a session.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('sits deeper in the outline inside a section of a section', () => {
    renderNacre(<EmptyState headingLevel={5} title="Nothing paired yet" />);
    expect(screen.getByRole('heading', { level: 5, name: 'Nothing paired yet' })).toBeVisible();
  });

  it('prefers media over icon', () => {
    renderNacre(<EmptyState title="x" icon={<span>icon</span>} media={<span>media</span>} />);
    expect(screen.getByText('media')).toBeInTheDocument();
    expect(screen.queryByText('icon')).toBeNull();
  });
});
