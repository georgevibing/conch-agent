import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { NeverList } from './Learning';

describe('Things Conch won’t learn again', () => {
  const items = [
    { id: 'n1', text: 'Prefers dark mode', when: 'Taken back 3 days ago' },
    { id: 'n2', text: 'Works weekends' },
  ];

  it('names what each Remove would allow again, and says when it was taken back', async () => {
    const onRemove = vi.fn();
    const { container } = renderNacre(<NeverList items={items} onRemove={onRemove} />);
    const list = screen.getByRole('list', { name: 'Things Conch won’t learn again' });
    expect(list).toHaveTextContent('Taken back 3 days ago');
    await userEvent.click(
      screen.getByRole('button', { name: 'Let Conch learn “Prefers dark mode” again' }),
    );
    expect(onRemove).toHaveBeenCalledWith('n1');
    await expectAccessible(container);
  });

  it('shows no buttons when there is nothing to do', () => {
    renderNacre(<NeverList items={items} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
