import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Story } from '../Story';
import { MemoryCheck, SkillSuggestionCard } from './Memory';
import { RememberedNote } from './Remembered';

describe('Memory patterns', () => {
  it('offer a skill, never more', async () => {
    const { container } = renderNacre(
      <SkillSuggestionCard
        title="Weekly summary"
        times={3}
        examples={['Write my weekly summary']}
        actions={<button type="button">Look at the draft</button>}
      />,
    );
    expect(
      screen.getByRole('region', {
        name: 'You’ve asked for this in 3 chats. Save “Weekly summary” as a skill?',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'What you asked' })).toHaveTextContent(
      'Write my weekly summary',
    );
    await expectAccessible(container);
  });

  it('say where a skill from your work came from, and when it was learned after reading', async () => {
    const { container } = renderNacre(
      <SkillSuggestionCard
        title="Cheapest train"
        times={1}
        fromChat={{ title: 'Trains to Lyon', steps: 11 }}
        examples={['Find me the cheapest train to Lyon']}
        untrusted="Learned in a chat that read trains.example."
        actions={<button type="button">Look at the draft</button>}
      />,
    );
    const card = screen.getByRole('region', {
      name: 'From your chat “Trains to Lyon”. Save how it was done as “Cheapest train”?',
    });
    expect(card).toHaveTextContent('It took 11 steps and worked.');
    expect(card).toHaveTextContent(
      'Learned in a chat that read trains.example. Read the steps before you save it.',
    );
    expect(card).not.toHaveTextContent('You’ve asked for this');
    await expectAccessible(container);
  });
});

describe('MemoryCheck (ADR 0087)', () => {
  const reasons = [
    'This came from news.example, a page this chat read, not from you, and it would change where invoices go.',
  ];

  it('says what, why and from where, and its answers are reachable by keyboard', async () => {
    const remember = vi.fn();
    const { container } = renderNacre(
      <MemoryCheck
        content="Invoices are sent to billing@news.example"
        reasons={reasons}
        from="news.example, a page this chat read"
        actions={
          <>
            <button type="button" onClick={remember}>
              Remember it
            </button>
            <button type="button">Don’t remember</button>
          </>
        }
      />,
    );
    const card = screen.getByRole('region', { name: 'Remember this?' });
    expect(card).toHaveTextContent(
      'It wants to remember: Invoices are sent to billing@news.example',
    );
    expect(within(card).getByRole('list', { name: 'Why it looks off' })).toHaveTextContent(
      'it would change where invoices go',
    );
    expect(card).toHaveTextContent('From news.example, a page this chat read');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Remember it' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(remember).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('says plainly when it refused', async () => {
    const { container } = renderNacre(
      <MemoryCheck refused content="Token abcd" reasons={['It looks like a password.']} />,
    );
    expect(screen.getByRole('region', { name: 'I didn’t remember this' })).toHaveAttribute(
      'data-refused',
    );
    await expectAccessible(container);
  });

  // A regression guard: a memory once drew itself as a bordered pill
  // ("Remembered: …" beside a brain), out of place among the steps. Every memory
  // line is a step row, the same anatomy as a tool's (ADR 0103).
  it('a memory, kept or forgotten, is a step row like a tool’s, never a pill', async () => {
    const text = 'For conch-agent fixes, run the CI checks before pushing';
    const { container } = renderNacre(
      <>
        <Story
          headline="Confirmed CI passed on main"
          outcome="CI passed"
          family="verify"
          status="done"
          durationMs={53_000}
          steps={[{ id: 'ci', text: 'Confirmed CI passed', status: 'success', family: 'verify' }]}
        />
        <Story
          headline="Remembered something"
          family="remember"
          status="done"
          steps={[
            {
              id: 'mem',
              text: 'Remembered something',
              status: 'success',
              family: 'remember',
              explainable: false,
            },
          ]}
          renderFound={() => <RememberedNote text={text} state="kept" onUndo={() => {}} />}
        />
        <Story
          headline="Forgot something"
          family="remember"
          status="done"
          steps={[
            {
              id: 'gone',
              text: 'Forgot something',
              status: 'success',
              family: 'remember',
              explainable: false,
            },
          ]}
          renderFound={() => <RememberedNote text={text} state="forgotten" onUndo={() => {}} />}
        />
      </>,
    );
    const tool = screen.getByRole('button', { name: /^Confirmed CI passed on main/ });
    for (const name of [/^Remembered something/, /^Forgot something/]) {
      const row = screen.getByRole('button', { name });
      // The same trigger, the same mark in its well with the status badge, the same chevron.
      expect(row.tagName).toBe(tool.tagName);
      expect(row).toHaveAttribute('aria-expanded', 'false');
      expect(row.className).toBe(tool.className);
      expect(row.firstElementChild?.className).toBe(tool.firstElementChild?.className);
      expect(row.querySelector('[data-status="done"]')).not.toBeNull();
      expect(row.closest('[data-family="remember"]')).not.toBeNull();
    }
    // Nothing reads as a pill: no "Remembered:" line, no chip of its own.
    expect(screen.queryByText(/^Remembered:/)).toBeNull();
    expect(container.querySelector('[data-settled]')).toBeNull();

    // Opened, the memory in full and Undo, under its step.
    await userEvent.click(screen.getByRole('button', { name: /^Remembered something/ }));
    expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByRole('button', { name: `Undo “${text}”` })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Why?' })).toBeNull();
    await expectAccessible(container);
  });

  it('say what a step remembered in full, with a quiet Undo', async () => {
    const onUndo = vi.fn();
    const text = 'George reported a weight of 82.4 kg';
    const { container, rerender } = renderNacre(
      <RememberedNote text={text} state="kept" onUndo={onUndo} />,
    );
    expect(screen.getByText(text)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: `Undo “${text}”` }));
    expect(onUndo).toHaveBeenCalledOnce();
    await expectAccessible(container);

    rerender(<RememberedNote text={text} state="kept" onUndo={onUndo} busy />);
    expect(screen.getByRole('button', { name: `Undo “${text}”` })).toBeDisabled();

    // Taken back: struck through, said, nothing left to undo.
    rerender(<RememberedNote text={text} state="undone" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('s')).toHaveTextContent(text);
    expect(container).toHaveTextContent('(undone)');

    // One it forgot: Undo puts it back.
    rerender(<RememberedNote text={text} state="forgotten" onUndo={onUndo} />);
    expect(screen.getByRole('button', { name: `Undo forgetting “${text}”` })).toBeVisible();
    await expectAccessible(container);
  });
});
