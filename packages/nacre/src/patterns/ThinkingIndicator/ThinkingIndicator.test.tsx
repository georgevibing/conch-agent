import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import {
  formatElapsed,
  formatWorked,
  ThinkingIndicator,
  tokensLive,
  verbAt,
  WorkedFor,
} from './ThinkingIndicator';

describe('ThinkingIndicator', () => {
  it('is a polite status with its label', async () => {
    const { container } = renderNacre(<ThinkingIndicator label="Reading files" detail="a.ts" />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading files');
    expect(screen.getByRole('status')).toHaveTextContent('a.ts');
    await expectAccessible(container);
  });

  it('shows elapsed time', () => {
    const { container } = renderNacre(<ThinkingIndicator startedAt={Date.now() - 12_000} />);
    expect(container.querySelector('[data-value]')).toHaveAttribute('data-value', '12s');
  });

  it('counts this stretch, not the whole turn, and what it has written', () => {
    const now = Date.now();
    const { container } = renderNacre(
      <ThinkingIndicator startedAt={now - 75 * 60_000} clockFrom={now - 64_000} tokens={4_200} />,
    );
    const shown = [...container.querySelectorAll('[data-value]')].map((e) =>
      e.getAttribute('data-value'),
    );
    // This stretch's minute, never the turn's 75; and what it wrote, every token.
    expect(shown).toEqual(['1m 04s', '4.2k']);
    expect(container).toHaveTextContent('tokens');
  });

  it('formats elapsed durations', () => {
    expect(formatElapsed(900)).toBe('0s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
    expect(formatElapsed(76 * 60_000)).toBe('1h 16m');
    expect(tokensLive(887)).toBe('887');
    expect(tokensLive(42_340)).toBe('42.3k');
    expect(tokensLive(412_699)).toBe('412.6k');
    expect(tokensLive(1_234_567)).toBe('1.2M');
    expect(formatWorked(42_000)).toBe('42s');
    expect(formatWorked(192_000)).toBe('3m 12s');
    expect(formatWorked(75 * 60_000 + 55_000)).toBe('1h 15m');
  });

  it('says what a long turn took, once it’s over', () => {
    renderNacre(<WorkedFor ms={12 * 60_000} tokens={412_000} />);
    expect(screen.getByLabelText('Worked for 12m, wrote 412k tokens')).toHaveTextContent(
      'Worked 12m · 412k tokens',
    );
  });

  it('announces a stable label while verbs change, and shows the thought trail', async () => {
    const { container } = renderNacre(
      <ThinkingIndicator
        verbs={['Listening', 'Untangling it']}
        srLabel="Claude is thinking"
        trail="Weighing the options"
        orb={false}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Claude is thinking');
    expect(container.querySelector('[aria-hidden] [class*="word"]')).toHaveTextContent('Listening');
    await expectAccessible(container);
  });

  it('opens with the first verb briefly, then cycles the rest from the clock', () => {
    expect(verbAt(0, 3, 3000).index).toBe(0);
    expect(verbAt(1600, 3, 3000).index).toBe(1);
    expect(verbAt(4600, 3, 3000).index).toBe(2);
    expect(verbAt(7600, 3, 3000).index).toBe(1);
    expect(verbAt(1600, 3, 3000).next).toBe(2900);
    expect(verbAt(99_000, 1, 3000).index).toBe(0);
  });
});

describe('ThinkingIndicator taking over from another', () => {
  it('carries the verb, the bubbles and the orb on from where they were', () => {
    const startedAt = Date.now() - 1_000;
    const { container } = renderNacre(
      <ThinkingIndicator verbs={['Listening', 'Thinking']} startedAt={startedAt} />,
    );
    const root = screen.getByRole('status');
    expect(Number.parseInt(root.style.getPropertyValue('--age'), 10)).toBeGreaterThanOrEqual(1_000);
    const word = container.querySelector<HTMLElement>('[style*="--since"]');
    // One second into "Listening": its letters are already in.
    expect(
      Number.parseInt(word?.style.getPropertyValue('--since') ?? '', 10),
    ).toBeGreaterThanOrEqual(1_000);
  });

  it('plays a new verb’s entrance from the start', () => {
    const { container } = renderNacre(<ThinkingIndicator verbs={['Listening', 'Thinking']} />);
    expect(container.querySelector('[style*="--since"]')).toBeNull();
  });
});
