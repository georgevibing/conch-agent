/** Agents taking turns in the transcript (ADR 0112): the round's card, handovers, outside words. */
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TranscriptItem } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Transcript } from './Transcript';

afterEach(() => vi.unstubAllGlobals());

const reply = (id: string, text: string, at: number): TranscriptItem => ({
  kind: 'assistant',
  id,
  messageId: id,
  continuation: false,
  text,
  thinking: '',
  done: true,
  startedAt: at,
});

const items = (ended: boolean): TranscriptItem[] => [
  { kind: 'user', id: 'u1', text: '@Researcher find flights, @Travel book, @Writer sum up', at: 1 },
  {
    kind: 'round',
    id: 'round-r1',
    seq: 1,
    roundId: 'r1',
    speakers: [
      { id: 'ag_research', name: 'Researcher' },
      { id: 'oa_travel1', name: 'Travel', outside: true },
      { id: 'ag_writer1', name: 'Writer' },
    ],
    passes: ['ag_research', 'oa_travel1', 'ag_writer1'],
    at: Date.now(),
    ...(ended && { ended: { reason: 'loop' as const, turns: 3 } }),
  },
  reply('m1', 'Dates: 3 to 5 May.', 2),
  {
    kind: 'peer',
    id: 'peer-4',
    seq: 4,
    outsideId: 'oa_travel1',
    name: 'Travel',
    text: 'Booked-ready: flight at 9. ![x](https://evil.example/pixel.png)',
  },
  {
    kind: 'agent',
    id: 'agent-5',
    seq: 5,
    agentId: 'ag_writer1',
    name: 'Writer',
    opening: false,
    round: { roundId: 'r1', turn: 3 },
  },
  reply('m2', 'In short: fly at 9.', 6),
];

function show(ended: boolean, status: 'idle' | 'running' = 'idle') {
  mockFetch({ 'GET /api/state': () => appState() });
  return renderApp(
    <Transcript
      view={{ lastSeq: 6, status, items: items(ended) }}
      pending={[]}
      name="Researcher"
      onRespond={() => {}}
      onRetry={() => {}}
    />,
  );
}

describe('a round in the transcript', () => {
  it('draws the round going, whose turn it is, and the outside agent’s words as theirs', () => {
    const { container } = show(false, 'running');
    expect(screen.getByRole('region', { name: 'Agents taking turns' })).toBeInTheDocument();
    expect(screen.getByText('Writer is answering')).toBeInTheDocument();
    expect(screen.getByText('Writer’s turn')).toBeInTheDocument();
    expect(
      screen.getByRole('article', { name: 'Travel, an outside agent, said' }),
    ).toHaveTextContent('flight at 9');
    // Someone else's words load nothing from elsewhere.
    expect(container.querySelector('img[src^="https://evil.example"]')).toBeNull();
    expect(screen.getByRole('article', { name: 'Writer said:' })).toHaveTextContent('fly at 9');
  });

  it('folds the round to a line once it’s over, saying why', () => {
    show(true);
    expect(screen.getByRole('region', { name: 'Agents took turns' })).toBeInTheDocument();
    expect(screen.getByText(/going back and forth/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});
