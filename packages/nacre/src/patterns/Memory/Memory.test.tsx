import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
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

  it('says plainly when it refused, and folds to a line once answered', async () => {
    const { container, rerender } = renderNacre(
      <MemoryCheck refused content="Token abcd" reasons={['It looks like a password.']} />,
    );
    expect(screen.getByRole('region', { name: 'I didn’t remember this' })).toHaveAttribute(
      'data-refused',
    );
    await expectAccessible(container);
    rerender(<MemoryCheck settled="dismissed" content="Token abcd" reasons={[]} />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByText(/Not remembered: Token abcd/)).toBeInTheDocument();
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
