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

  it('puts a row’s action beside it, not inside its button', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onUndo = vi.fn();
    const { container } = renderNacre(
      <ActivityTimeline
        onOpen={onOpen}
        groups={[
          {
            label: 'Today',
            rows: [
              {
                id: 'a',
                kind: 'file',
                status: 'done',
                title: 'Changed notes.md',
                time: '9:40 AM',
                where: 'Tidy',
                action: <button onClick={onUndo}>Undo</button>,
              },
            ],
          },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    await expectAccessible(container);
  });
});
