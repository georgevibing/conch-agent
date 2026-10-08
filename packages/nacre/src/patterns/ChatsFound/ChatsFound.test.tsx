import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../../components/Button';
import { expectAccessible, renderNacre } from '../../test/render';
import { ChatsFound, listWords } from './ChatsFound';
import { PastChatReader } from './PastChatReader';

const sources = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    logo: 'claude' as const,
    count: 1031,
    projects: [
      { name: 'shop', count: 412 },
      { name: 'garden', count: 220 },
      { name: 'dotfiles', count: 98 },
      { name: 'blog', count: 61 },
    ],
    when: 'since March 2025',
  },
  { id: 'codex', label: 'Codex', logo: 'openai' as const, count: 253 },
];

describe('ChatsFound', () => {
  it('says how many it found, from where, and offers one press', async () => {
    const bring = vi.fn();
    const { container } = renderNacre(
      <ChatsFound sources={sources} action={<Button onClick={bring}>Bring them in</Button>} />,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('1,284');
    expect(screen.getByText('from Claude Code and Codex. Bring them in?')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Where they’re from' });
    expect(list).toHaveTextContent('1,031 chats');
    expect(list).toHaveTextContent('shop412');
    expect(list).toHaveTextContent('and 1 more');
    expect(list).toHaveTextContent('since March 2025');
    await userEvent.click(screen.getByRole('button', { name: 'Bring them in' }));
    expect(bring).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('shows how far bringing them in is', async () => {
    const { container } = renderNacre(
      <ChatsFound
        sources={sources}
        phase="bringing"
        progress={{ done: 400, total: 1284, current: 'Reading Codex' }}
      />,
    );
    expect(screen.getByRole('progressbar', { name: 'Bringing them in' })).toBeInTheDocument();
    expect(screen.getByText('400 of 1,284')).toBeInTheDocument();
    expect(screen.getByText('Reading Codex')).toBeInTheDocument();
    expect(container.querySelector('section')).toHaveAttribute('aria-busy', 'true');
    await expectAccessible(container);
  });

  it('takes its own words once they’re here', () => {
    renderNacre(
      <ChatsFound
        sources={sources}
        phase="done"
        title={(count) => <>{count} conversations are here</>}
        lead="Search them with ⌘K."
      />,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('conversations are here');
    expect(screen.getByText('Search them with ⌘K.')).toBeInTheDocument();
  });

  it('lists app names the way people say them', () => {
    expect(listWords(['Claude Code'])).toBe('Claude Code');
    expect(listWords(['Claude Code', 'Codex', 'Hermes'])).toBe('Claude Code, Codex and Hermes');
  });
});

describe('PastChatReader', () => {
  it('shows a past chat as read-only, with one press to carry it on', async () => {
    const carry = vi.fn();
    const { container } = renderNacre(
      <PastChatReader
        title="Checkout double charge"
        source="Claude Code"
        logo="claude"
        meta="shop · 3 messages"
        messages={[
          { id: '1', from: 'user', children: 'Why does it double-charge?' },
          { id: '2', from: 'assistant', children: 'The retry runs first.' },
        ]}
        note="Claude Code picks it up here."
        action={<Button onClick={carry}>Carry on here</Button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Checkout double charge' })).toBeInTheDocument();
    expect(screen.getByText(/A past chat from Claude Code/)).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Past chat from Claude Code' })).toHaveTextContent(
      'The retry runs first.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Carry on here' }));
    expect(carry).toHaveBeenCalled();
    await expectAccessible(container);
  });
});
