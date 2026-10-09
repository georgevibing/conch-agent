import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { joinMeta, META_SEP, MetaList } from './MetaList';

describe('MetaList', () => {
  it('is a list of the facts, without the dots in the words', async () => {
    const { container } = renderNacre(
      <MetaList aria-label="About" items={['Ubuntu 24.04.4 LTS', '8 cores', 'Up 29 days']} />,
    );
    const list = screen.getByRole('list', { name: 'About' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Ubuntu 24.04.4 LTS',
      '8 cores',
      'Up 29 days',
    ]);
    await expectAccessible(container);
  });

  it('leaves out empty facts, and draws nothing with none', () => {
    const { container, rerender } = renderNacre(
      <MetaList items={['8 cores', null, false, '', 'Up 3 days']} />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    rerender(<MetaList items={[null, '']} />);
    expect(container.querySelector('ul')).toBeNull();
  });
});

describe('joinMeta', () => {
  it('binds each dot to the fact before it, so a line never starts with one', () => {
    const line = joinMeta(['15 GB memory', 'Up 29 days']);
    // A no-break space before the dot, an ordinary one after: the line can
    // break after the dot, never before it.
    expect(line).toBe('15 GB memory\u00a0\u00b7 Up 29 days');
    expect(META_SEP).toBe('\u00a0\u00b7 ');
  });

  it('leaves out empty parts', () => {
    expect(joinMeta(['PDF', undefined, null, false, '', 3])).toBe(`PDF${META_SEP}3`);
    expect(joinMeta([])).toBe('');
  });
});
