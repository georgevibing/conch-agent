import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { GuardNote, TaintNotice, TaintReads, taintSummary, type TaintRead } from './TaintNotice';

describe('TaintNotice and GuardNote', () => {
  it('say what was read and what changes, quietly', async () => {
    const { container, rerender } = renderNacre(<TaintNotice read="news.example" />);
    expect(container).toHaveTextContent(
      'Read news.example. From here on, I’ll check with you before running commands or sending anything.',
    );
    rerender(<TaintNotice read="things in Gmail" first={false} />);
    expect(container).toHaveTextContent('Read things in Gmail.');
    expect(container).not.toHaveTextContent('From here on');
    rerender(<GuardNote>This chat read news.example.</GuardNote>);
    expect(screen.getByText('This chat read news.example.')).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('TaintReads', () => {
  const docs: TaintRead = { kind: 'web', label: 'docs.example' };
  const news: TaintRead = { kind: 'web', label: 'news.example' };
  const docsDownload: TaintRead = { kind: 'download', label: 'docs.example' };
  const reads: TaintRead[] = [
    docs,
    { kind: 'download', label: 'files.example' },
    news,
    docsDownload,
    { kind: 'app', label: 'your chat “Trip plans”' },
    { kind: 'app', label: 'your chat “Taxes”' },
  ];

  it('says several reads as one line, a page and its download once, and opens to each', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<TaintReads reads={reads} />);
    const summary = screen.getByRole('button', { name: /Read 3 sites and 2 of your chats\./ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(container).toHaveTextContent('From here on, I’ll check with you');
    await user.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'What it read' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'docs.example',
      'something downloaded from files.example',
      'news.example',
      'things in your chat “Trip plans”',
      'things in your chat “Taxes”',
    ]);
    await expectAccessible(container);
  });

  it('says one read as one line, with nothing to open', () => {
    renderNacre(<TaintReads reads={[docs, docsDownload]} first={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Read docs.example.')).toBeInTheDocument();
  });

  it('says where carried reads came from, and that the care comes with them', () => {
    const { container, rerender } = renderNacre(
      <TaintReads reads={reads} from="chat" first={false} />,
    );
    expect(container).toHaveTextContent(
      'The chat it came from had read 3 sites and 2 of your chats, so I’ll check with you',
    );
    rerender(<TaintReads reads={[news]} from="task" first={false} />);
    expect(container).toHaveTextContent('Its task read news.example.');
    expect(container).not.toHaveTextContent('check with you');
  });

  it('sums up apps and people in plain words', () => {
    expect(
      taintSummary([
        { kind: 'app', label: 'Gmail' },
        { kind: 'person', label: 'Ana' },
        { kind: 'person', label: 'Bo' },
      ]),
    ).toBe('things in Gmail and 2 messages from other people');
  });
});
