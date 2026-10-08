import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { REPLAY_STEPS, REPLAY_TURNS } from './fixtures';
import { replayPositions, replayTally, RunReplay } from './RunReplay';
import { RunSave } from './RunSave';

const now = () => screen.getByRole('heading', { level: 3 });

describe('RunReplay', () => {
  it('opens at the last step, with the whole tally', async () => {
    const { container } = renderNacre(
      <RunReplay steps={REPLAY_STEPS} turns={REPLAY_TURNS} speaker="Pearl" />,
    );
    expect(now()).toHaveTextContent('Pearl: Pushed to main.');
    expect(screen.getByText('In all')).toBeInTheDocument();
    expect(screen.getByText('15 of 15 steps')).toBeInTheDocument();
    expect(screen.getByText('$0.13')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('steps with the arrow keys and a turn at a time with Page Up', async () => {
    const user = userEvent.setup();
    renderNacre(<RunReplay steps={REPLAY_STEPS} turns={REPLAY_TURNS} />);
    const slider = screen.getByRole('slider', { name: 'Step' });
    slider.focus();
    await user.keyboard('{ArrowLeft}');
    expect(now()).toHaveTextContent('Pushed to main');
    expect(slider).toHaveAttribute('aria-valuetext', 'Step 14 of 15: Pushed to main');
    await user.keyboard('{PageUp}');
    expect(now()).toHaveTextContent('You: Great, commit and push it');
    await user.keyboard('{PageUp}');
    expect(now()).toHaveTextContent('You: Fix the login test');
    expect(screen.getByText('By here')).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(now()).toHaveTextContent('Pushed to main.');
  });

  it('shows what a step changed and found, and opens the chat there', async () => {
    const onJump = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <RunReplay steps={REPLAY_STEPS} turns={REPLAY_TURNS} onJump={onJump} initialStep={5} />,
    );
    expect(now()).toHaveTextContent('Changed login.ts');
    expect(screen.getByText(/req\.session = newSession/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show in chat/ }));
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ anchor: 't3' }));
    // A row in the list goes there too.
    const [tests] = within(screen.getByRole('list', { name: 'Every step' })).getAllByRole(
      'button',
      {
        name: /Ran the auth tests/,
      },
    );
    if (tests) await user.click(tests);
    expect(screen.getByText('Didn’t work')).toBeInTheDocument();
  });

  it('replays a step at a time, then stops at the end', async () => {
    vi.useFakeTimers();
    try {
      renderNacre(<RunReplay steps={REPLAY_STEPS.slice(0, 3)} turns={REPLAY_TURNS} pace={100} />);
      const slider = screen.getByRole('slider', { name: 'Step' });
      act(() => screen.getByRole('button', { name: 'Replay from the start' }).click());
      expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('Step 1 of 3'));
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
      for (let i = 0; i < 6; i++) await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(slider).toHaveAttribute('aria-valuetext', 'Step 3 of 3: Read login.ts');
      expect(screen.getByRole('button', { name: 'Replay from the start' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when nothing happened yet', () => {
    renderNacre(<RunReplay steps={[]} />);
    expect(screen.getByText(/Nothing happened here yet/)).toBeInTheDocument();
  });

  it('folds a long wait to a break, so the work reads at its own pace', () => {
    const { at, breaks } = replayPositions(REPLAY_STEPS);
    expect(at[0]).toBe(0);
    expect(at.every((x, i) => i === 0 || x > (at[i - 1] ?? 0))).toBe(true);
    // Half an hour between the two turns takes no more room than twenty seconds.
    expect(breaks).toHaveLength(1);
    expect((at[11] ?? 0) - (at[10] ?? 0)).toBeLessThan(0.3);
  });

  it('counts tokens and money once a turn is done', () => {
    expect(replayTally(REPLAY_STEPS, REPLAY_TURNS, 3)).toMatchObject({
      steps: 4,
      tokens: 0,
      usd: 0,
    });
    expect(replayTally(REPLAY_STEPS, REPLAY_TURNS, 10)).toMatchObject({
      tokens: 41_100,
      usd: 0.11,
    });
  });
});

describe('RunSave', () => {
  const formats = [
    { id: 'report', title: 'A page to read', detail: 'Opens in any browser.' },
    { id: 'openai', title: 'OpenAI chat, for training', detail: 'JSONL.' },
  ];

  it('chooses a format, shows what comes out, and saves in one press', async () => {
    const user = userEvent.setup();
    const onFormatChange = vi.fn();
    const onSave = vi.fn();
    const { container } = renderNacre(
      <RunSave
        formats={formats}
        format="report"
        onFormatChange={onFormatChange}
        redact
        onRedactChange={() => {}}
        removed={[{ kind: 'key', label: '2 keys and tokens', examples: ['OPENAI_API_KEY=[key]'] }]}
        folder="~/Downloads"
        onChooseFolder={() => {}}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /OpenAI chat/ }));
    expect(onFormatChange).toHaveBeenCalledWith('openai');
    await user.click(screen.getByRole('button', { name: /Taking out 2 keys and tokens/ }));
    expect(screen.getByText('OPENAI_API_KEY=[key]')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Take out keys/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('says where it was saved', async () => {
    const { container } = renderNacre(
      <RunSave
        formats={formats}
        format="report"
        onFormatChange={() => {}}
        redact
        onRedactChange={() => {}}
        onSave={() => {}}
        saved={{ name: 'Conch – Fix it – 2026-10-08.html', folder: '~/Downloads' }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved in ~/Downloads');
    await expectAccessible(container);
  });
});
