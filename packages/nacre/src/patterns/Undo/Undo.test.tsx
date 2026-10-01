import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { FilesChanged } from './FilesChanged';
import { UndoPreview } from './UndoPreview';

describe('UndoPreview', () => {
  it('names each file, what happens to it, and what stands in the way', async () => {
    const { container } = renderNacre(
      <UndoPreview
        direction="undo"
        files={[
          {
            path: 'notes.md',
            action: 'restore',
            diff: '--- a/n\n+++ b/n\n@@ -1,1 +1,1 @@\n-new\n+old\n',
            conflict: 'It changed since.',
          },
          { path: 'made.ts', action: 'remove' },
          { path: '~/.zshrc', action: 'restore', blocked: 'It’s a link now.' },
        ]}
      />,
    );
    expect(screen.getByRole('region', { name: 'notes.md' })).toHaveTextContent('It changed since.');
    expect(screen.getByRole('region', { name: 'made.ts' })).toHaveTextContent(
      'Removed: the assistant made it',
    );
    expect(screen.getByRole('region', { name: '~/.zshrc' })).toHaveTextContent('It’s a link now.');
    await expectAccessible(container);
  });
});

describe('FilesChanged', () => {
  it('undoes, then offers Redo', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const { rerender, container } = renderNacre(
      <FilesChanged
        files={[{ path: 'notes.md', kind: 'changed' }]}
        state="applied"
        onUndo={onUndo}
      />,
    );
    expect(container).toHaveTextContent('Changed notes.md');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalled();
    rerender(
      <FilesChanged
        files={[{ path: 'notes.md', kind: 'changed' }]}
        state="undone"
        onRedo={() => undefined}
      />,
    );
    expect(container).toHaveTextContent('Undone · Changed notes.md');
    expect(screen.getByRole('button', { name: 'Redo' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
