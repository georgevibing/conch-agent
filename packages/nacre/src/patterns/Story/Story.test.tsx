import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { codingRun, files, readSteps, shipSteps, shirts, shopSteps, testSteps } from './fixtures';
import { storyDuration } from './format';
import { Story, type StoryProps } from './Story';
import { StoryStack } from './StoryStack';

const tests: StoryProps = {
  headline: 'Ran the server tests',
  outcome: '241 files',
  family: 'verify',
  status: 'done',
  steps: testSteps,
  durationMs: 38_200,
};

describe('Story', () => {
  it('reads as one line and opens to its steps from the keyboard', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <Story
        headline="Read Transcript.tsx and 3 other files"
        family="explore"
        status="done"
        steps={readSteps}
        chips={files}
        durationMs={1_300}
      />,
    );
    const row = screen.getByRole('button', { name: /^Read Transcript\.tsx and 3 other files/ });
    expect(row).toHaveAccessibleName(expect.stringContaining('4 steps') as unknown as string);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await expectAccessible(container);

    await user.tab();
    expect(row).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(row.getAttribute('aria-controls') ?? '')).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('list', { name: 'What it looked at' })).toHaveTextContent(
      'Transcript.tsx',
    );
    await expectAccessible(container);

    await user.keyboard(' ');
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('says its outcome, its status and how long it took', () => {
    renderNacre(<Story {...tests} status="failed" outcome="3 failed" />);
    const row = screen.getByRole('button', { name: /^Ran the server tests/ });
    expect(row.textContent).toContain('3 failed');
    expect(row.textContent).toContain('didn’t work');
    expect(row.textContent).toContain('took 38s');
  });

  it('opens a step to its raw call', async () => {
    const user = userEvent.setup();
    renderNacre(<Story {...tests} defaultOpen renderRaw={(id) => <pre>raw output of {id}</pre>} />);
    const step = screen.getByRole('button', { name: /^Ran the server tests\s+7,388 passed/ });
    expect(screen.queryByText('raw output of toolu_tests')).toBeNull();
    await user.click(step);
    expect(step).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('raw output of toolu_tests')).toBeInTheDocument();
  });

  it('shows what a step found under it', () => {
    renderNacre(<Story {...tests} defaultOpen renderFound={(id) => <p>found by {id}</p>} />);
    expect(screen.getByText('found by toolu_tests')).toBeInTheDocument();
  });

  it('asks why, shows it is asking, then the answer', async () => {
    const user = userEvent.setup();
    let answer: (text: string) => void = () => {};
    const onExplain = vi.fn(() => new Promise<string>((resolve) => (answer = resolve)));
    const { container } = renderNacre(<Story {...tests} defaultOpen onExplain={onExplain} />);
    const why = screen.getByRole('button', { name: 'Why?' });
    expect(why).toHaveAccessibleDescription('Ran the server tests');
    await user.click(why);
    expect(onExplain).toHaveBeenCalledWith('toolu_tests');
    expect(why).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Finding out why…')).toBeInTheDocument();
    await act(async () => answer('So nothing broken reaches main.'));
    // Its words arrive one by one, each its own span.
    expect(
      await screen.findByText(
        (_, el) => el?.tagName === 'P' && /nothing broken reaches main/.test(el.textContent ?? ''),
      ),
    ).toBeInTheDocument();
    await expectAccessible(container);
    // Asked once: closing and opening again shows the same answer.
    await user.click(why);
    await user.click(why);
    expect(onExplain).toHaveBeenCalledTimes(1);
  });

  it('says plainly when there is no answer, or asking failed', async () => {
    const user = userEvent.setup();
    const { unmount } = renderNacre(
      <Story
        {...tests}
        defaultOpen
        onExplain={async () => ({ unavailable: 'None of your providers can answer this.' })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Why?' }));
    expect(await screen.findByText('None of your providers can answer this.')).toBeInTheDocument();
    unmount();

    renderNacre(
      <Story {...tests} defaultOpen onExplain={() => Promise.reject(new Error('offline'))} />,
    );
    await user.click(screen.getByRole('button', { name: 'Why?' }));
    expect(await screen.findByText('Couldn’t ask just now.')).toBeInTheDocument();
  });

  it('announces when it starts and when it ends, only while arriving', () => {
    const running: StoryProps = {
      ...tests,
      headline: 'Running the server tests',
      outcome: undefined,
      status: 'running',
      live: 'Running 241 test files',
      arriving: true,
    };
    const { rerender } = renderNacre(<Story {...running} />);
    expect(screen.getByRole('status')).toHaveTextContent('Started: Running the server tests');
    rerender(<Story {...running} live="Still running" />);
    expect(screen.getByRole('status')).toHaveTextContent('Started: Running the server tests');
    rerender(<Story {...tests} arriving />);
    expect(screen.getByRole('status')).toHaveTextContent('Done: Ran the server tests, 241 files');
  });

  it('is still in history: nothing is announced', () => {
    renderNacre(<Story {...tests} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('morphs to a new headline in place', () => {
    const { rerender } = renderNacre(
      <Story {...tests} headline="Ran 2 git commands" headlineSource="rule" arriving />,
    );
    rerender(
      <Story {...tests} headline="Pushed the fixes to main" headlineSource="model" arriving />,
    );
    const row = screen.getByRole('button', { name: /^Pushed the fixes to main/ });
    // The old words are on their way out, hidden from assistive tech.
    const hidden = [...row.querySelectorAll('[aria-hidden]')].map((el) => el.textContent);
    expect(hidden).toContain('Ran 2 git commands');
  });

  it('moves only the words that changed, and is done with the old ones within 360ms', () => {
    vi.useFakeTimers();
    try {
      const { rerender, container } = renderNacre(
        <Story {...tests} headline="Read 3 files" headlineSource="rule" arriving />,
      );
      rerender(<Story {...tests} headline="Read 4 files" headlineSource="rule" arriving />);
      const fresh = [...container.querySelectorAll('[data-fresh]')].map((el) => el.textContent);
      // "Read" holds still; the rest rises in, in the line's own box.
      expect(fresh).toEqual(['4', 'files']);
      expect(container.querySelector('[data-same]')?.textContent).toBe('Read');
      act(() => vi.advanceTimersByTime(360));
      expect(container.querySelector('[aria-hidden] [data-same]')).toBeNull();
      expect(container.querySelector('[data-fresh]')).toBeNull();
      expect(container.querySelector('[class*="morphOut"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the live line while running, and the stuck note in its place', () => {
    const { rerender } = renderNacre(
      <Story {...tests} status="running" live="Running 241 test files" />,
    );
    expect(screen.getByText('Running 241 test files')).toBeInTheDocument();
    rerender(<Story {...tests} status="running" stuck="Still waiting for the tests to start." />);
    expect(screen.getByText('Still waiting for the tests to start.')).toBeInTheDocument();
  });

  it('holds as it was while working between two steps of a run that goes on', () => {
    vi.useFakeTimers();
    try {
      const working: StoryProps = {
        ...tests,
        headline: 'Running the server tests',
        outcome: undefined,
        status: 'running',
        live: 'Running 241 test files',
        startedAt: Date.now() - 5_000,
        durationMs: undefined,
        arriving: true,
      };
      const { rerender, container } = renderNacre(<Story {...working} />);
      const root = container.querySelector<HTMLElement>('[data-family]');
      const line = () => container.querySelector('[class*="below"]');
      expect(line()).toHaveAttribute('data-shown');

      // The step ended, the next hasn't started: the rules' words are past tense already.
      rerender(<Story {...tests} durationMs={5_000} arriving continuing />);
      expect(container.querySelector('[data-family]')).toBe(root);
      expect(root).toHaveAttribute('data-status', 'running');
      expect(line()).toHaveAttribute('data-shown');
      // Its working words stay, no badge lands, and nothing says it's done.
      expect(screen.getByRole('button', { name: /^Running the server tests/ })).toBeInTheDocument();
      expect(container.querySelector('[class*="badge"]')).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent('Started: Running the server tests');
      act(() => vi.advanceTimersByTime(700));
      expect(line()).toHaveTextContent('Thinking…');

      // The next step starts: the same row, its line moves on.
      rerender(<Story {...working} live="Running the type check" />);
      act(() => vi.advanceTimersByTime(700));
      expect(container.querySelector('[data-family]')).toBe(root);
      expect(line()).toHaveTextContent('Running the type check');

      // The run is over: it lands, and its line folds away.
      rerender(<Story {...tests} arriving />);
      expect(root).toHaveAttribute('data-status', 'done');
      expect(line()).not.toHaveAttribute('data-shown');
      expect(screen.getByRole('status')).toHaveTextContent('Done: Ran the server tests');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps its line while a step runs, even with nothing else to say', () => {
    const { container } = renderNacre(
      <Story
        {...tests}
        status="running"
        steps={testSteps.map((s) => ({
          ...s,
          status: 'running',
          text: 'Running the server tests',
        }))}
      />,
    );
    expect(container.querySelector('[class*="below"]')).toHaveAttribute('data-shown');
    expect(container.querySelector('[class*="below"]')).toHaveTextContent(
      'Running the server tests',
    );
  });

  it('opens only web links, in a new tab', () => {
    renderNacre(
      <Story
        {...tests}
        defaultOpen
        chips={[
          ...shirts.slice(0, 2),
          { kind: 'site', label: 'bad', href: 'javascript:alert(1)' },
          { kind: 'file', label: 'notes.md', href: '/home/me/notes.md' },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'What it looked at' });
    const links = within(list).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.amazon.de/',
      'https://www.amazon.de/dp/B0C1OXFORD',
    ]);
    for (const a of links) expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('marks a line ×N only when it’s one thing done again', () => {
    const { container, rerender } = renderNacre(
      <Story {...tests} steps={tests.steps?.slice(0, 1)} repeats={1} />,
    );
    expect(container.textContent).toContain('×2');
    rerender(<Story {...tests} steps={readSteps} repeats={1} />);
    expect(container.textContent).not.toContain('×2');
  });

  it('folds repeats and says so', () => {
    renderNacre(<Story {...tests} repeats={2} defaultOpen />);
    expect(screen.getByText('+2 repeats folded')).toBeInTheDocument();
  });

  it('cannot open with nothing inside', () => {
    renderNacre(<Story {...tests} steps={[]} />);
    expect(screen.getByRole('button', { name: /^Ran the server tests/ })).toBeDisabled();
  });

  it('says durations for a glance', () => {
    expect(storyDuration(40)).toBe('0.1s');
    expect(storyDuration(4_240)).toBe('4.2s');
    expect(storyDuration(38_200)).toBe('38s');
    expect(storyDuration(192_000)).toBe('3m 12s');
    expect(storyDuration(3_840_000)).toBe('1h 04m');
  });
});

describe('StoryStack', () => {
  it('folds the earlier stories into a line that opens to them', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<StoryStack stories={codingRun} />);
    const fold = screen.getByRole('button', { name: /^3 earlier steps/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /^Made a plan/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Committed and pushed to main/ })).toBeVisible();
    await expectAccessible(container);
    await user.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Made a plan/ })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('shows a short run whole', () => {
    renderNacre(<StoryStack stories={codingRun.slice(0, 4)} />);
    expect(screen.queryByRole('button', { name: /earlier/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('gives every story the stack’s callbacks', async () => {
    const user = userEvent.setup();
    const onExplain = vi.fn(async () => 'Because.');
    renderNacre(
      <StoryStack
        stories={[
          {
            id: 'shop',
            headline: 'Compared 3 shirts on amazon.de',
            family: 'browse',
            status: 'done',
            steps: shopSteps,
            defaultOpen: true,
          },
        ]}
        onExplain={onExplain}
      />,
    );
    const [first] = screen.getAllByRole('button', { name: 'Why?' });
    if (first) await user.click(first);
    expect(onExplain).toHaveBeenCalledWith('toolu_search');
  });

  it('says a step you said no to was not run, neither done nor failed', async () => {
    const push = shipSteps[1] as (typeof shipSteps)[number];
    const { container } = renderNacre(
      <Story
        headline="Pushed to main"
        outcome="You said no"
        family="ship"
        status="declined"
        steps={[{ ...push, status: 'declined', outcome: 'You said no' }]}
        defaultOpen
      />,
    );
    const row = screen.getByRole('button', { name: /^Pushed to main/ });
    expect(row).toHaveAccessibleName(expect.stringContaining('not run') as unknown as string);
    expect(row).not.toHaveAccessibleName(
      expect.stringContaining('didn’t work') as unknown as string,
    );
    const step = container.querySelector('li[data-status="declined"]');
    expect(step).not.toBeNull();
    expect(step).not.toHaveAttribute('data-failed');
    expect(step).toHaveTextContent('You said no');
    expect(container.querySelector('[data-status="failed"]')).toBeNull();
    expect(container.querySelector('[data-status="done"]')).toBeNull();
    await expectAccessible(container);
  });

  it('asks no Why? of a step said by its own event, and still draws what it found', async () => {
    const { container } = renderNacre(
      <Story
        headline="Looked at a diary in Yazio and remembered something"
        family="connect"
        status="done"
        steps={[
          { id: 'call', text: 'Looked at a diary in Yazio', status: 'success', family: 'connect' },
          {
            id: 'mem',
            text: 'Remembered something',
            status: 'success',
            family: 'remember',
            explainable: false,
          },
        ]}
        defaultOpen
        onExplain={async () => 'To see the diary.'}
        renderFound={(id) => (id === 'mem' ? <p>George weighed 82.4 kg</p> : undefined)}
      />,
    );
    // One timeline, both steps; Why? only on the call.
    expect(
      within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Why?' })).toHaveLength(1);
    expect(screen.getByText('George weighed 82.4 kg')).toBeVisible();
    await expectAccessible(container);
  });
});
