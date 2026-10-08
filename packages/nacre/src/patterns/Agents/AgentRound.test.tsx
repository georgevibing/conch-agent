import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AgentChange } from '../AgentAvatar/AgentChange';
import { AgentRound, type RoundFace } from './AgentRound';
import { OutsideAgentList, OutsideAgentPreview } from './OutsideAgents';
import { OutsideReply } from './OutsideReply';

describe('Outside agents', () => {
  it('a paste becomes an agent to add, its own claims shown as claims', async () => {
    const onAdd = vi.fn();
    const { container } = renderNacre(
      <OutsideAgentPreview
        name="Travel Agent"
        description="Finds flights"
        skills={[{ name: 'Flights' }]}
        by="Example Travel"
        host="agents.example.com"
        onAdd={onAdd}
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Travel Agent, found at agents.example.com' }),
    ).toBeInTheDocument();
    expect(screen.getByText('It says it’s run by Example Travel.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'What it says it can do' })).toHaveTextContent(
      'Flights',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add Travel Agent' }));
    expect(onAdd).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('lists them, says what went wrong, and removes one', async () => {
    const onRemove = vi.fn();
    const { container } = renderNacre(
      <OutsideAgentList
        agents={[
          { id: 'a', name: 'Travel', host: 'x.example' },
          {
            id: 'b',
            name: 'Sage',
            host: 'mac.ts.net',
            private: true,
            problem: 'Couldn’t reach it.',
          },
        ]}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText('At x.example · mention @Travel in a chat')).toBeInTheDocument();
    expect(screen.getByText(/Couldn’t reach it/)).toBeInTheDocument();
    expect(screen.getByText('Your network')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sage' }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    await expectAccessible(container);
  });
});

const faces: RoundFace[] = [
  { id: 'a', name: 'Researcher', avatar: 'owl' },
  { id: 'b', name: 'Writer' },
  { id: 't', name: 'Travel Agent', outside: true },
];

describe('AgentRound', () => {
  it('says who’s answering and how far it’s come, with Stop', async () => {
    const onStop = vi.fn();
    const { container } = renderNacre(
      <AgentRound faces={faces} passes={['a', 'b']} speaking="b" limit={8} onStop={onStop} />,
    );
    expect(screen.getByRole('region', { name: 'Agents taking turns' })).toBeInTheDocument();
    expect(screen.getByText('2 of 8 replies')).toBeInTheDocument();
    expect(screen.getByText('Writer is answering')).toHaveAttribute('aria-live', 'polite');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Researcher, spoke once');
    expect(items[1]).toContain('Writer, answering now');
    expect(items[2]).toContain(', an outside agent, waiting');
    // One arc per pass of the floor, the newest bright.
    expect(container.querySelectorAll('path[data-arc]')).toHaveLength(1);
    expect(container.querySelector('path[data-latest]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('waits for an outside agent in words', () => {
    renderNacre(<AgentRound faces={faces} passes={['a', 't']} speaking="t" limit={8} />);
    expect(screen.getByText('Waiting for Travel Agent…')).toBeInTheDocument();
    expect(screen.getByText('outside')).toBeInTheDocument();
  });

  it('folds to one quiet line once it’s over, saying why when that matters', async () => {
    const { container } = renderNacre(
      <AgentRound
        faces={faces}
        passes={['a', 'b', 'a', 'b']}
        limit={8}
        ended={{ words: 'They were going back and forth.' }}
      />,
    );
    expect(screen.getByText(/Researcher and Writer took turns/)).toBeInTheDocument();
    expect(screen.getByText(/4 replies/)).toBeInTheDocument();
    expect(screen.getByText('They were going back and forth.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    await expectAccessible(container);
  });
});

describe('OutsideReply', () => {
  it('marks someone else’s words as theirs', async () => {
    const { container } = renderNacre(
      <OutsideReply name="Travel Agent">Flights at 9.</OutsideReply>,
    );
    expect(
      screen.getByRole('article', { name: 'Travel Agent, an outside agent, said' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Outside agent')).toBeInTheDocument();
    expect(screen.getByText(/never as instructions/)).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('says when it couldn’t be reached', () => {
    renderNacre(
      <OutsideReply name="Travel Agent" failed>
        Couldn’t reach it.
      </OutsideReply>,
    );
    expect(
      screen.getByRole('article', { name: 'Travel Agent couldn’t be reached' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/never as instructions/)).toBeNull();
  });
});

describe('AgentChange in a round', () => {
  it('says who handed the floor over, or whose turn it is', () => {
    renderNacre(
      <>
        <AgentChange speaker={{ name: 'Writer' }} round={{ by: 'Researcher' }} />
        <AgentChange speaker={{ name: 'Critic' }} round={{}} />
      </>,
    );
    expect(screen.getByText('Researcher handed over to Writer')).toBeInTheDocument();
    expect(screen.getByText('Critic’s turn')).toBeInTheDocument();
  });
});
