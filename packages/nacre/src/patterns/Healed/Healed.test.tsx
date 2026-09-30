import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ago, HealedNotes } from './HealedNotes';

describe('HealedNotes', () => {
  it('lists what was fixed, newest first, as a quiet named region', async () => {
    const now = Date.now();
    const { container } = renderNacre(
      <HealedNotes
        notes={[
          { at: now - 10_000, message: 'Search was rebuilt.' },
          { at: now - 3 * 3_600_000, message: 'Notion is answering again.' },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: 'Fixed on its own' });
    expect(region).toHaveTextContent('Search was rebuilt.just now');
    expect(region).toHaveTextContent('Notion is answering again.3 h ago');
    await expectAccessible(container);
  });

  it('says nothing when nothing was fixed', () => {
    renderNacre(<HealedNotes notes={[]} />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByText('Fixed on its own')).toBeNull();
  });

  it('says how long ago in plain words', () => {
    const now = 1_000_000_000;
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 2 * 86_400_000, now)).toBe('2 d ago');
  });
});
