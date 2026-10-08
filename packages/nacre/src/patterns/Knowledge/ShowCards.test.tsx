import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { lowtide, NOW, shows } from './fixtures';
import { nextEpisodeWords, ShowCards } from './ShowCards';

describe('ShowCards', () => {
  it('puts the posters in one row: one tab stop, arrows along it, each opens its page', async () => {
    const { container } = renderNacre(<ShowCards shows={shows} now={NOW} />);
    expect(screen.getByRole('toolbar', { name: 'Shows' })).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links[0]).toHaveAttribute('href', 'https://www.tvmaze.com/shows/1/lowtide');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    await userEvent.tab();
    expect(links[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(links[1]).toHaveFocus();
    await expectAccessible(container);
  });

  it('says the rating in words and when the next episode comes', () => {
    renderNacre(<ShowCards shows={shows} now={NOW} />);
    expect(screen.getAllByText('out of 10', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText('Episode in 3 days')).toBeInTheDocument();
    expect(screen.getByText('Episode today')).toBeInTheDocument();
  });

  it('words the next episode by the calendar', () => {
    const now = new Date(2026, 9, 8, 22).getTime();
    const at = (d: number, h = 9) => ({ at: new Date(2026, 9, d, h).toISOString() });
    expect(nextEpisodeWords(at(8, 23), now)).toBe('Next episode today');
    expect(nextEpisodeWords(at(9, 1), now)).toBe('Next episode tomorrow');
    expect(nextEpisodeWords(at(12), now)).toBe('Next episode in 4 days');
    expect(nextEpisodeWords(at(29), now, 'en-GB')).toBe('Next episode on 29 Oct');
    expect(nextEpisodeWords(at(7), now)).toBeUndefined();
    expect(nextEpisodeWords({ at: 'soon' }, now)).toBeUndefined();
  });

  it('shows one show in full, with its summary and episode', async () => {
    const { container } = renderNacre(<ShowCards shows={[lowtide]} now={NOW} />);
    expect(screen.getByRole('region', { name: 'Show' })).toBeInTheDocument();
    expect(screen.getByText(/fishing town/)).toBeInTheDocument();
    expect(screen.getByText('S3 E4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on TVmaze' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('draws outside words as text and never opens a link that isn’t secure', () => {
    const { container } = renderNacre(
      <ShowCards
        shows={[{ ...lowtide, summary: '<b onclick="x()">Bold</b>', url: 'http://tv.example' }]}
        now={NOW}
      />,
    );
    expect(container.querySelector('b')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
