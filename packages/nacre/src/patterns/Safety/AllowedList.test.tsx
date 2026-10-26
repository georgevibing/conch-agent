import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AllowedList } from './AllowedList';

describe('AllowedList', () => {
  it('shows each command as code, where it holds, and forgets one by its ×', async () => {
    const onForget = vi.fn();
    const { container } = renderNacre(
      <AllowedList
        aria-label="Commands Auto never asks about"
        code
        rows={[
          {
            id: 'r1',
            words: 'git push origin feature/*',
            forget: 'Ask again before git push origin feature/*',
            where: 'shop',
          },
        ]}
        onForget={onForget}
      />,
    );
    const list = screen.getByRole('list', { name: 'Commands Auto never asks about' });
    expect(list).toHaveTextContent('git push origin feature/*shop');
    expect(list.querySelector('code')).toHaveTextContent('git push origin feature/*');
    await userEvent.click(
      screen.getByRole('button', { name: 'Ask again before git push origin feature/*' }),
    );
    expect(onForget).toHaveBeenCalledWith('r1');
    await expectAccessible(container);
  });

  it('draws nothing when nothing is lifted', () => {
    const { container } = renderNacre(<AllowedList rows={[]} onForget={() => undefined} />);
    expect(container.querySelector('ul')).toBeNull();
  });
});
