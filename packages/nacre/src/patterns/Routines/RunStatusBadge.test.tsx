import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { RunStatusBadge, runStatusMeta } from './RunStatusBadge';

describe('RunStatusBadge', () => {
  it('uses plain words for every status', async () => {
    const { container } = renderNacre(
      <>
        {Object.keys(runStatusMeta).map((s) => (
          <RunStatusBadge key={s} status={s as keyof typeof runStatusMeta} />
        ))}
      </>,
    );
    for (const label of [
      'Running…',
      'Needs you',
      'Done',
      'Nothing to do',
      'Didn’t finish',
      'Skipped',
      'Missed',
      'Stopped',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    await expectAccessible(container);
  });
});
