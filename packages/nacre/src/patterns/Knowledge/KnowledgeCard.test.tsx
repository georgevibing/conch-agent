import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ada, lisbon } from './fixtures';
import { KnowledgeCard } from './KnowledgeCard';

/** jsdom has no layout: say the opening is taller than its four lines. */
function overflowing() {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(96);
}

afterEach(() => vi.restoreAllMocks());

describe('KnowledgeCard', () => {
  it('names the subject, says what it is, and lists its facts', async () => {
    const { container } = renderNacre(<KnowledgeCard {...ada} />);
    expect(screen.getByRole('article', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('English mathematician and writer (1815–1852)')).toBeInTheDocument();
    expect(screen.getByText('Born').tagName).toBe('DT');
    expect(screen.getByText('10 December 1815, London').tagName).toBe('DD');
    await expectAccessible(container);
  });

  it('opens the source in a tab of its own, and its related pages too', () => {
    renderNacre(<KnowledgeCard {...ada} />);
    const source = screen.getByRole('link', { name: 'Read on Wikipedia' });
    expect(source).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Ada_Lovelace');
    expect(source).toHaveAttribute('target', '_blank');
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('navigation', { name: 'See also' })).toBeInTheDocument();
  });

  it('draws outside words as text and never links anything but https', () => {
    const { container } = renderNacre(
      <KnowledgeCard
        {...lisbon}
        extract={'<img src=x onerror="alert(1)"> Lisbon'}
        url="javascript:alert(1)"
        related={[{ title: 'Plain', url: 'http://example.org' }]}
      />,
    );
    expect(container.querySelector('img[onerror]')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('reads more by keyboard, and says whether it is open', async () => {
    overflowing();
    renderNacre(<KnowledgeCard {...ada} />);
    const more = screen.getByRole('button', { name: 'Read more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.tab();
    expect(more).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('offers no Read more when the opening fits', () => {
    renderNacre(<KnowledgeCard {...lisbon} extract="Short." />);
    expect(screen.queryByRole('button', { name: 'Read more' })).toBeNull();
  });

  it('lays a picture out by its shape', () => {
    const { container, rerender } = renderNacre(<KnowledgeCard {...ada} />);
    expect(container.querySelector('article')).toHaveAttribute('data-shape', 'portrait');
    rerender(<KnowledgeCard {...lisbon} />);
    expect(container.querySelector('article')).toHaveAttribute('data-shape', 'landscape');
    rerender(<KnowledgeCard {...lisbon} picture={undefined} />);
    expect(container.querySelector('article')).toHaveAttribute('data-shape', 'none');
  });

  it('keeps at most eight facts', () => {
    const facts = Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }));
    renderNacre(<KnowledgeCard {...lisbon} facts={facts} />);
    expect(screen.getAllByRole('term')).toHaveLength(8);
  });
});
