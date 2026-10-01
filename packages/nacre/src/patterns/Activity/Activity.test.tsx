import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ActivityTimeline } from './ActivityTimeline';

describe('ActivityTimeline', () => {
  it('lists each day, says how each thing went in words, and opens one', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { container } = renderNacre(
      <ActivityTimeline
        onOpen={onOpen}
        groups={[
          {
            label: 'Today',
            rows: [
              {
                id: 'a',
                kind: 'command',
                status: 'failed',
                title: 'Ran npm test',
                time: '9:40 AM',
                where: 'Fix the build',
              },
              {
                id: 'b',
                kind: 'approval',
                status: 'denied',
                title: 'You said no: run curl',
                time: '9:38 AM',
                where: 'Fix the build',
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByRole('region', { name: 'Today' })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /Ran npm test.*Didn’t work/ });
    await user.click(row);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(
      screen.getByRole('button', { name: /You said no: run curl.*Not allowed/ }),
    ).toBeInTheDocument();
    await expectAccessible(container);
  });
});
