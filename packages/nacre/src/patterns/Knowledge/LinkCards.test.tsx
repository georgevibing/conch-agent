import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { links, quarterly, tram } from './fixtures';
import { LinkCards } from './LinkCards';

describe('LinkCards', () => {
  it('shows one link as a large card that opens the page safely', async () => {
    const { container } = renderNacre(<LinkCards links={[quarterly]} locale="en-GB" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', quarterly.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('The tides of the Tagus');
    expect(link).toHaveTextContent('The Quarterly');
    expect(screen.getByText('6 Oct 2026')).toHaveAttribute('datetime', quarterly.published);
    await userEvent.tab();
    expect(link).toHaveFocus();
    await expectAccessible(container);
  });

  it('says what kind of page it is in words, not only a mark', () => {
    renderNacre(<LinkCards links={[tram]} />);
    expect(screen.getByText('Video')).toBeInTheDocument();
  });

  it('shows several as rows in a list, each its own link', async () => {
    const { container } = renderNacre(<LinkCards links={links} />);
    expect(screen.getByRole('region', { name: 'Link previews, 4 pages' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getAllByRole('link')).toHaveLength(4);
    await expectAccessible(container);
  });

  it('never opens a link that isn’t secure, and says so', () => {
    renderNacre(<LinkCards links={[{ ...quarterly, url: 'http://quarterly.example/x' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/doesn’t open/)).toBeInTheDocument();
  });

  it('draws outside words as text', () => {
    const { container } = renderNacre(
      <LinkCards links={[{ ...quarterly, title: '<script>x()</script>Title' }]} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>x()</script>Title')).toBeInTheDocument();
  });

  it('shows nothing for no links', () => {
    const { container } = renderNacre(<LinkCards links={[]} />);
    expect(container.querySelector('section')).toBeNull();
  });
});
