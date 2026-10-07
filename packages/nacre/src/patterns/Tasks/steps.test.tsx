import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { groupSteps } from './steps';
import { TaskSteps } from './TaskSteps';

const STEPS = [
  'Tool returned: Read a.ts',
  'Tool returned: Read b.ts',
  'Tool returned: Read c.ts',
  'Tool returned: Run `npm test`',
  'Tool returned: Read command progress',
  'Tool returned: Read command progress',
  'Tool returned: Read command progress',
  'Tool failed: Edit a.ts',
  'Tool returned: Edit a.ts',
];

describe('groupSteps', () => {
  it('drops the gateway’s prefix, says a repeat once, and folds long runs of one kind', () => {
    expect(groupSteps(STEPS)).toEqual([
      {
        failed: false,
        lines: [
          { label: 'Read a.ts', failed: false, times: 1 },
          { label: 'Read b.ts', failed: false, times: 1 },
          { label: 'Read c.ts', failed: false, times: 1 },
        ],
      },
      { label: 'Run `npm test`', failed: false, times: 1 },
      { label: 'Read command progress', failed: false, times: 3 },
      { label: 'Edit a.ts', failed: true, times: 1 },
      { label: 'Edit a.ts', failed: false, times: 1 },
    ]);
  });

  it('leaves short runs as they are', () => {
    expect(groupSteps(['Read a.ts', 'Read b.ts'])).toHaveLength(2);
  });
});

describe('TaskSteps', () => {
  it('reads calmly, and opens a folded run to each step', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<TaskSteps steps={STEPS} />);
    const list = screen.getByRole('list', { name: 'What it did' });
    expect(list).toHaveTextContent('Read a.ts and 2 more');
    expect(list).toHaveTextContent('Read command progress×3');
    expect(list).toHaveTextContent('Didn’t work: Edit a.ts');
    expect(list).not.toHaveTextContent('Tool returned');
    await user.click(screen.getByRole('button', { name: /Read a\.ts and 2 more/ }));
    const run = screen.getByRole('list', { name: 'Steps like it' });
    expect(within(run).getAllByRole('listitem')).toHaveLength(3);
    await expectAccessible(container);
  });

  it('shows only the last few while it works', () => {
    renderNacre(<TaskSteps steps={STEPS} last={2} />);
    const items = within(screen.getByRole('list', { name: 'What it did' })).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.textContent)).toEqual(['Didn’t work: Edit a.ts', 'Edit a.ts']);
  });
});
