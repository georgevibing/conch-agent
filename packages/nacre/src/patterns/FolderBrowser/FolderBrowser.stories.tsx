import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../../components/Button';
import { FolderBrowser, type FolderBrowserProps } from './FolderBrowser';
import { guessOf, HOME, listingOf, PLACES, RECENT, TREE } from './fixtures';

const meta = {
  title: 'Patterns/FolderBrowser',
  component: FolderBrowser,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Choosing a folder on the computer Conch runs on, from any device — a phone across the room included. The places people start from, the trail to where you are, the folders in it filtered as you type, a new folder where you are, and, tucked away behind its button, typing a path with suggestions. Every folder is one press to go into; **Choose** takes the one you’re in. The desktop app shows the system’s own Open dialog instead.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: () => undefined,
    onOpenFolder: () => undefined,
    onChoose: () => undefined,
  },
} satisfies Meta<typeof FolderBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The browser over a pretend home folder: everything works but the disk. */
function Live(props: Partial<FolderBrowserProps> & { start?: string }) {
  const [open, setOpen] = useState(true);
  const [path, setPath] = useState(props.start ?? HOME);
  const [hidden, setHidden] = useState(false);
  const [chosen, setChosen] = useState<string>();
  const [loading, setLoading] = useState(false);
  const file = props.kind === 'file';
  const found = listingOf(path, { hidden, files: file });
  // A folder that can't be read: the last one that could stays, to go back to.
  const listing = found ?? listingOf(HOME, { hidden, files: file });
  return (
    <>
      <Button variant="surface" onClick={() => setOpen(true)}>
        {chosen ? `Chose ${chosen}` : 'Choose a folder…'}
      </Button>
      <FolderBrowser
        description="Where your assistant reads and writes files."
        places={PLACES}
        recent={RECENT}
        onGuess={(typed) => Promise.resolve(guessOf(typed))}
        onCreateFolder={(name) => {
          if (!name || /\//.test(name))
            return Promise.reject(new Error('A folder’s name can’t have / or \\ in it.'));
          TREE[path]?.folders.push(name);
          TREE[`${path}/${name}`] = { folders: [] };
          setPath(`${path}/${name}`);
          return Promise.resolve();
        }}
        {...props}
        open={open}
        onOpenChange={setOpen}
        listing={listing}
        loading={loading}
        problem={
          found
            ? undefined
            : 'macOS hasn’t let Conch look in there. Allow it in System Settings → Privacy & Security → Files & Folders.'
        }
        showHidden={hidden}
        onShowHiddenChange={setHidden}
        onOpenFolder={(next) => {
          setLoading(true);
          setTimeout(() => {
            setPath(next);
            setLoading(false);
          }, 120);
        }}
        onChoose={(picked) => {
          setChosen(picked);
          setOpen(false);
        }}
      />
    </>
  );
}

/** Choosing the folder your assistant works in. */
export const Playground: Story = { render: () => <Live /> };

/** Deeper in: the trail is the way back, a step at a time. */
export const InAProject: Story = { render: () => <Live start={`${HOME}/Projects/conch`} /> };

/** Choosing a file: KeePassXC's database, among the folders. */
export const AFile: Story = {
  render: () => (
    <Live
      kind="file"
      title="Choose your KeePassXC database"
      description={undefined}
      start={`${HOME}/Documents/Passwords`}
    />
  ),
};

/** A folder the computer won't open: one sentence, one way on. */
export const CantLook: Story = { render: () => <Live start={`${HOME}/Library`} /> };

/** The first look, before the gateway answers. */
export const Loading: Story = {
  args: { places: PLACES, loading: true },
};

/** On a phone: the places are a row to swipe through. */
export const Phone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  globals: { viewport: { value: 'mobile1' } },
  render: () => <Live start={`${HOME}/Projects`} />,
};
