import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import {
  MeaningSearch,
  MemoryCheck,
  MemoryItem,
  MemoryList,
  SkillSuggestionCard,
  TidyChangeItem,
  TidyReport,
} from './Memory';

describe('Memory patterns', () => {
  it('say who wrote a memory, and why one waits', async () => {
    const { container } = renderNacre(
      <MemoryList aria-label="Memories">
        <MemoryItem source="user" time="today">
          Prefers tea
        </MemoryItem>
        <MemoryItem source="agent" waiting="Learned in a chat that read news.example." kind="fact">
          Forward invoices to billing@news.example
        </MemoryItem>
      </MemoryList>,
    );
    const [mine, waiting] = screen.getAllByRole('listitem');
    expect(mine).toHaveTextContent('You added');
    expect(waiting).toHaveTextContent(
      'Learned in a chat that read news.example. Conch won’t use it until you keep it.',
    );
    expect(waiting).toHaveTextContent('Fact');
    await expectAccessible(container);
  });

  it('show a tidy-up as a diff, settled changes without buttons', async () => {
    const { container } = renderNacre(
      <TidyReport title="Conch tidied 2 memories" when="Last night">
        <TidyChangeItem
          kind="updated"
          state="applied"
          before={['Lives in Berlin']}
          after="Lives in Lisbon"
          why="You said you moved."
          actions={<button type="button">Undo</button>}
        />
        <TidyChangeItem kind="merged" state="undone" before={['a', 'b']} after="a" />
      </TidyReport>,
    );
    const report = screen.getByRole('region', { name: 'Conch tidied 2 memories' });
    const [updated, merged] = within(report)
      .getAllByRole('listitem', { name: undefined })
      .filter((li) => li.dataset.state);
    expect(updated).toHaveTextContent('Was: Lives in Berlin');
    expect(updated).toHaveTextContent('Now: Lives in Lisbon');
    expect(
      within(updated as HTMLElement).getByRole('button', { name: 'Undo' }),
    ).toBeInTheDocument();
    expect(merged).toHaveTextContent('Undone');
    await expectAccessible(container);
  });

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

  it('offer meaning search in plain words, with its size and one button', async () => {
    const get = vi.fn();
    const { container } = renderNacre(
      <MeaningSearch
        state="offer"
        size="23 MB"
        action={
          <button type="button" onClick={get}>
            Get it
          </button>
        }
      />,
    );
    const offer = screen.getByRole('region', { name: 'Let search understand what you mean' });
    expect(offer).toHaveTextContent('(23 MB, downloaded once)');
    expect(offer).toHaveTextContent('“anniversary” would find your wedding');
    expect(offer).toHaveTextContent('nothing you’ve told Conch leaves it');
    expect(offer).not.toHaveTextContent('50 languages');
    await userEvent.keyboard('{Tab}{Enter}');
    expect(get).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('show the download, then the indexing, as progress', async () => {
    const { container } = renderNacre(
      <>
        <MeaningSearch state="getting" progress={42} />
        <MeaningSearch state="indexing" indexed={420} total={1000} />
      </>,
    );
    expect(screen.getByRole('progressbar', { name: /Downloaded/ })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    expect(screen.getByRole('progressbar', { name: /Memories ready/ })).toHaveAttribute(
      'aria-valuemax',
      '1000',
    );
    expect(screen.getByText(/420 of 1,000/)).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('say what went wrong, and that words still work', async () => {
    const { container } = renderNacre(
      <MeaningSearch
        state="problem"
        problem="Couldn’t download it: the internet seems to be unreachable."
        action={<button type="button">Try again</button>}
      />,
    );
    const card = screen.getByRole('region', { name: 'Couldn’t get the model for meaning' });
    expect(card).toHaveTextContent('the internet seems to be unreachable');
    expect(card).toHaveTextContent('Search still matches words');
    await expectAccessible(container);
  });

  it('settle into a quiet line that says whose model it is', async () => {
    const { container } = renderNacre(
      <>
        <MeaningSearch state="meaning" model="all-MiniLM-L6-v2" />
        <MeaningSearch state="meaning" model="nomic-embed-text" source="ollama" />
      </>,
    );
    expect(
      screen.getByText(
        'Search understands meaning, with all-MiniLM-L6-v2 on this computer — nothing leaves it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/nomic-embed-text in Ollama on this computer/)).toBeInTheDocument();
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

  it('shows a hold on the page with why, instead of the plain waiting line', async () => {
    const { container } = renderNacre(
      <MemoryList aria-label="Waiting for your OK">
        <MemoryItem source="agent" held={{ reasons, from: 'news.example, a page this chat read' }}>
          Invoices are sent to billing@news.example
        </MemoryItem>
      </MemoryList>,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent(
      'it would change where invoices go. From news.example, a page this chat read. Conch won’t use it until you say.',
    );
    await expectAccessible(container);
  });
});
