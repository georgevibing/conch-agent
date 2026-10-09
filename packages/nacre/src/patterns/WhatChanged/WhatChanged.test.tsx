import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { changesSaid, WhatChanged, type WhatChangedGroup } from './WhatChanged';

const GROUPS: WhatChangedGroup[] = [
  {
    kind: 'file',
    text: 'Changed 2 files',
    items: [
      { kind: 'file', text: 'Changed Transcript.tsx', target: 'Transcript.tsx', undo: 'cs-1' },
      { kind: 'file', text: 'Made stories.ts', target: 'stories.ts', undo: 'cs-2' },
    ],
  },
  { kind: 'commit', text: 'Committed', items: [{ kind: 'commit', text: 'Committed “fix”' }] },
  { kind: 'push', text: 'Pushed to main', items: [{ kind: 'push', text: 'Pushed 1 commit' }] },
];

function Live({ onUndo }: { onUndo: (id: string) => void }) {
  const [undone, setUndone] = useState(new Set<string>());
  return (
    <WhatChanged
      groups={GROUPS}
      undone={undone}
      onUndo={async (id) => {
        onUndo(id);
        setUndone((u) => new Set(u).add(id));
      }}
      onRedo={async (id) => {
        setUndone((u) => {
          const next = new Set(u);
          next.delete(id);
          return next;
        });
      }}
    />
  );
}

describe('WhatChanged', () => {
  it('says the turn in one line, in the order it happened', () => {
    expect(changesSaid(GROUPS)).toBe('Changed 2 files\u00a0· committed\u00a0· pushed to main');
    expect(
      changesSaid([
        { kind: 'send', text: 'Sent an email to Ana', items: [] },
        { kind: 'other', text: 'PR opened', items: [] },
      ]),
    ).toBe('Sent an email to Ana\u00a0· PR opened');
  });

  it('opens to every change, consequential first, with Undo and Redo', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const { container } = renderNacre(<Live onUndo={onUndo} />);
    const card = screen.getByRole('region', { name: 'What changed' });
    const row = within(card).getByRole('button', { name: /^Changed 2 files\s· committed/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await expectAccessible(container);

    await user.click(row);
    const items = within(card).getAllByRole('listitem');
    // The push leads, though it happened last.
    expect(items[0]).toHaveTextContent('Pushed 1 commit');
    await expectAccessible(container);

    await user.click(screen.getByRole('button', { name: 'Undo: Changed Transcript.tsx' }));
    expect(onUndo).toHaveBeenCalledWith('cs-1');
    expect(
      await screen.findByRole('button', { name: 'Redo: Changed Transcript.tsx' }),
    ).toBeVisible();
    expect(screen.getByText(/Undone ·/)).toBeInTheDocument();
    // One change set left: no "Undo all".
    expect(screen.queryByRole('button', { name: /Undo all/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Redo: Changed Transcript.tsx' }));
    expect(await screen.findByRole('button', { name: /Undo all 2 changes/ })).toBeVisible();
  });

  it('undoes everything at once, and says so folded', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    renderNacre(<Live onUndo={onUndo} />);
    await user.click(screen.getByRole('button', { name: /^Changed 2 files/ }));
    await user.click(screen.getByRole('button', { name: /Undo all 2 changes/ }));
    expect(onUndo.mock.calls.map(([id]) => id as string)).toEqual(['cs-1', 'cs-2']);
    await user.click(screen.getByRole('button', { name: /Changed 2 files/ }));
    expect(screen.getByRole('button', { name: /^Undone\s· Changed 2 files/ })).toBeVisible();
  });

  it('says when an undo didn’t go through', async () => {
    const user = userEvent.setup();
    renderNacre(
      <WhatChanged groups={GROUPS} defaultOpen onUndo={() => Promise.reject(new Error('gone'))} />,
    );
    await user.click(screen.getByRole('button', { name: 'Undo: Made stories.ts' }));
    expect(await screen.findByText(/didn’t go back/)).toBeInTheDocument();
  });
});
