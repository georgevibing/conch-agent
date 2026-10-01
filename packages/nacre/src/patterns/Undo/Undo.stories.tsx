import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../../components/Stack';
import { FilesChanged } from './FilesChanged';
import { UndoPreview } from './UndoPreview';

const diff =
  '--- a/notes.md\n+++ b/notes.md\n@@ -1,3 +1,2 @@\n # Notes\n-Ship the release on Friday.\n+Ship it.\n';

const meta = {
  title: 'Patterns/Undo/UndoPreview',
  component: UndoPreview,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Exactly what Undo (or Redo) will do before it does it: each file, what happens to it, the change as a diff, and anything in the way — a file you changed since (replaced only if you say so), or one that can’t be put back. Shown inside a dialog by the app.',
      },
    },
  },
  args: {
    direction: 'undo',
    files: [
      { path: 'notes.md', action: 'restore', diff },
      { path: 'src/new-helper.ts', action: 'remove' },
      {
        path: 'old.txt',
        action: 'recreate',
        diff: '--- a/old.txt\n+++ b/old.txt\n@@ -0,0 +1,1 @@\n+still useful\n',
      },
    ],
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof UndoPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
export const Conflict: Story = {
  args: {
    files: [
      {
        path: 'notes.md',
        action: 'restore',
        diff,
        conflict: 'It changed since. Undoing replaces those later changes too.',
      },
      {
        path: '~/.zshrc',
        action: 'restore',
        blocked: 'It’s a link now, so Conch won’t write through it.',
      },
      { path: 'logo.png', action: 'restore', binary: true },
    ],
  },
};

export const InTheChat: StoryObj<typeof FilesChanged> = {
  render: () => (
    <Stack gap={2} style={{ maxInlineSize: 640 }}>
      <FilesChanged
        files={[{ path: 'notes.md', kind: 'changed' }]}
        state="applied"
        onUndo={() => undefined}
      />
      <FilesChanged
        files={[
          { path: 'src/app.ts', kind: 'changed' },
          { path: 'src/new.ts', kind: 'created' },
          { path: 'old.txt', kind: 'deleted' },
          { path: 'README.md', kind: 'changed' },
        ]}
        state="applied"
        onUndo={() => undefined}
      />
      <FilesChanged
        files={[{ path: 'notes.md', kind: 'changed' }]}
        state="undone"
        onRedo={() => undefined}
      />
      <FilesChanged files={[{ path: 'notes.md', kind: 'changed' }]} state="expired" />
    </Stack>
  ),
};
