import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AwayDigest, type AwayDigestItem } from './AwayDigest';

const ITEMS: AwayDigestItem[] = [
  {
    id: 'read',
    headline: 'Read Transcript.tsx and 3 other files',
    family: 'explore',
    status: 'done',
  },
  {
    id: 'tests',
    headline: 'Ran the server tests',
    outcome: '3 failed',
    family: 'verify',
    status: 'failed',
  },
  { id: 'fix', headline: 'Fixing the failing tests', family: 'edit', status: 'running' },
];

describe('AwayDigest', () => {
  it('says what happened while you were away, a press from each story', async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    const { container } = renderNacre(
      <AwayDigest items={ITEMS} durationMs={760_000} onJump={onJump} onDismiss={() => {}} />,
    );
    expect(screen.getByRole('region', { name: 'While you were away' })).toBeInTheDocument();
    expect(
      screen.getByText('Worked 12m · 3 steps · 1 didn’t work · still going'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /^Ran the server tests 3 failed, didn’t work/ }),
    );
    expect(onJump).toHaveBeenCalledWith('tests');
    await expectAccessible(container);
  });

  it('folds away before it’s dismissed', async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    renderNacre(<AwayDigest items={ITEMS} onDismiss={onDismiss} />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    await act(async () => dismiss.click());
    expect(screen.getByRole('region')).toHaveAttribute('data-leaving');
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(300));
    expect(onDismiss).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('keeps the latest in view and folds the earliest', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      headline: `Story ${i}`,
      family: 'run' as const,
      status: 'done' as const,
    }));
    renderNacre(<AwayDigest items={many} />);
    expect(screen.getByText('3 earlier steps')).toBeInTheDocument();
    expect(screen.queryByText('Story 2')).toBeNull();
    expect(screen.getByText('Story 7')).toBeInTheDocument();
  });
});
