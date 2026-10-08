import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { BookShelf } from './BookShelf';
import { books, lathe, leftHand } from './fixtures';

describe('BookShelf', () => {
  it('stands the books on one shelf, one tab stop, arrows along it', async () => {
    const { container } = renderNacre(<BookShelf books={books} />);
    expect(screen.getByRole('toolbar', { name: 'Books' })).toBeInTheDocument();
    const first = screen.getByRole('button', {
      name: 'The Left Hand of Darkness, by Ursula K. Le Guin, 1969',
    });
    await userEvent.tab();
    expect(first).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /^A Wizard of Earthsea/ })).toHaveFocus();
    await userEvent.tab();
    expect(document.activeElement?.closest('[role="toolbar"]')).toBeNull();
    await expectAccessible(container);
  });

  it('opens a book’s details on press, and closes them with Escape', async () => {
    renderNacre(<BookShelf books={books} locale="en-GB" />);
    const wizard = screen.getByRole('button', { name: /^A Wizard of Earthsea/ });
    await userEvent.click(wizard);
    const details = await screen.findByRole('dialog', { name: 'A Wizard of Earthsea' });
    expect(details).toHaveTextContent('183 pages');
    expect(details).toHaveTextContent('4.0 out of 5');
    expect(details).toHaveTextContent('(2,410 ratings)');
    const open = screen.getByRole('link', { name: 'Open on Open Library' });
    expect(open).toHaveAttribute('href', 'https://openlibrary.org/works/OL59863W');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    await expectAccessible(document.body);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(wizard).toHaveFocus();
  });

  it('draws a cover from the title when there is none', () => {
    renderNacre(<BookShelf books={[lathe, leftHand]} />);
    expect(screen.getAllByText('The Lathe of Heaven').length).toBeGreaterThan(0);
  });

  it('shows a single book open beside its details', async () => {
    const { container } = renderNacre(<BookShelf books={[leftHand]} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.getByText('304 pages', { exact: false })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('never links a book anywhere but https', () => {
    renderNacre(<BookShelf books={[{ ...leftHand, url: 'javascript:alert(1)' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
