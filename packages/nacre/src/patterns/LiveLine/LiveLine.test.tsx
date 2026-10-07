import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { LiveLine } from './LiveLine';

/** The words on show (the leaving ones are hidden from assistive tech, and from this). */
const shown = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-entering], span:not([data-leaving])')]
    .filter((el) => !el.classList.contains('nc-visually-hidden') && el.children.length === 0)
    .map((el) => el.textContent)
    .filter((t) => t && !t.startsWith(' '));

describe('LiveLine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('changes in place, coalescing changes that come too fast to read', async () => {
    const { container, rerender } = renderNacre(<LiveLine text="Reading Transcript.tsx" />);
    await act(async () => vi.advanceTimersByTime(1000));
    rerender(<LiveLine text="Reading TranscriptItems.tsx" />);
    await act(async () => vi.advanceTimersByTime(10));
    expect(shown(container)).toContain('Reading TranscriptItems.tsx');

    // Three changes inside the throttle: only the last is shown, once.
    rerender(<LiveLine text="Reading reducer.ts" />);
    rerender(<LiveLine text="Reading activity.ts" />);
    rerender(<LiveLine text="Running the tests" />);
    await act(async () => vi.advanceTimersByTime(100));
    expect(shown(container)).not.toContain('Running the tests');
    await act(async () => vi.advanceTimersByTime(600));
    expect(shown(container)).toContain('Running the tests');
    expect(container.textContent).not.toContain('Reading reducer.ts');
    expect(container.textContent).not.toContain('Reading activity.ts');
  });

  it('tells a screen reader only once the line holds still', async () => {
    const { rerender } = renderNacre(<LiveLine text="Reading Transcript.tsx" />);
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).toHaveTextContent('Reading Transcript.tsx');
    await act(async () => vi.advanceTimersByTime(1000));
    rerender(<LiveLine text="Running the tests" />);
    await act(async () => vi.advanceTimersByTime(700));
    expect(region).toHaveTextContent('Reading Transcript.tsx');
    await act(async () => vi.advanceTimersByTime(1600));
    expect(region).toHaveTextContent('Running the tests');
  });

  it('can stay quiet when something nearby already speaks', () => {
    renderNacre(<LiveLine text="Running the tests" announce={false} />);
    expect(document.querySelector('[aria-live]')).toBeNull();
    expect(screen.getByText('Running the tests')).toBeInTheDocument();
  });

  it('is accessible', async () => {
    vi.useRealTimers();
    const { container } = renderNacre(
      <LiveLine text="Let me check the tests." source="provider" />,
    );
    expect(container.querySelector('[data-source="provider"]')).toBeInTheDocument();
    await expectAccessible(container);
  });
});
