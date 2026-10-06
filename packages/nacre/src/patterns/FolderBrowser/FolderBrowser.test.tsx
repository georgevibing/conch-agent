import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { FolderBrowser, type FolderBrowserProps } from './FolderBrowser';
import { guessOf, HOME, listingOf, PLACES, RECENT } from './fixtures';

function Harness(
  props: Partial<FolderBrowserProps> & { start?: string; onChosen?: (path: string) => void },
) {
  const [path, setPath] = useState(props.start ?? HOME);
  const [hidden, setHidden] = useState(false);
  return (
    <FolderBrowser
      open
      onOpenChange={() => undefined}
      places={PLACES}
      recent={RECENT}
      {...props}
      listing={listingOf(path, { hidden, files: props.kind === 'file' })}
      showHidden={hidden}
      onShowHiddenChange={setHidden}
      onOpenFolder={setPath}
      onChoose={props.onChosen ?? (() => undefined)}
    />
  );
}

describe('FolderBrowser', () => {
  it('goes into a folder with a press, back by the trail, and chooses the one you’re in', async () => {
    const onChosen = vi.fn();
    renderNacre(<Harness onChosen={onChosen} />);
    const dialog = screen.getByRole('dialog', { name: 'Choose a folder' });
    await userEvent.click(within(dialog).getByRole('option', { name: /Projects/ }));
    await userEvent.click(within(dialog).getByRole('option', { name: /conch/ }));
    const trail = within(dialog).getByRole('navigation', { name: 'Where you are' });
    expect(within(trail).getByText('conch')).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(trail).getByRole('button', { name: 'Projects' }));
    expect(within(trail).getByText('Projects')).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Choose “Projects”' }));
    expect(onChosen).toHaveBeenCalledWith(`${HOME}/Projects`);
  });

  it('starts from a place, and says which one you’re in', async () => {
    renderNacre(<Harness />);
    const places = screen.getByRole('navigation', { name: 'Places' });
    await userEvent.click(within(places).getByRole('button', { name: 'Documents' }));
    expect(within(places).getByRole('button', { name: 'Documents' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(screen.getByRole('option', { name: /Taxes 2026/ })).toBeInTheDocument();
    // Recent folders are a list of their own.
    expect(within(places).getByRole('list', { name: 'Recent' })).toBeInTheDocument();
  });

  it('filters as you type, goes in with Enter and up with Backspace', async () => {
    renderNacre(<Harness />);
    const filter = screen.getByRole('combobox', { name: 'Filter folders' });
    await userEvent.type(filter, 'proj');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Projects']);
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('option', { name: /garden-planner/ })).toBeInTheDocument();
    expect(filter).toHaveValue('');
    await userEvent.keyboard('{Backspace}');
    expect(screen.getByRole('option', { name: /Desktop/ })).toBeInTheDocument();
    await userEvent.type(filter, 'zzz');
    expect(screen.getByText('Nothing called “zzz” in here.')).toBeInTheDocument();
  });

  it('shows hidden folders only when asked', async () => {
    renderNacre(<Harness />);
    expect(screen.queryByRole('option', { name: /\.config/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show 2 hidden folders' }));
    expect(screen.getByRole('option', { name: /\.config/ })).toBeInTheDocument();
  });

  it('makes a new folder where you are, and says why it couldn’t', async () => {
    const onCreateFolder = vi
      .fn<(name: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('There’s already something called “notes” here.'))
      .mockResolvedValue(undefined);
    renderNacre(<Harness start={`${HOME}/Projects`} onCreateFolder={onCreateFolder} />);
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const name = screen.getByRole('textbox', { name: 'New folder’s name' });
    await userEvent.type(name, 'notes{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('already something called');
    await userEvent.clear(name);
    await userEvent.type(name, 'garden{Enter}');
    expect(onCreateFolder).toHaveBeenLastCalledWith('garden');
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'New folder’s name' })).not.toBeInTheDocument(),
    );
  });

  it('types a path for the few who want to, with suggestions and words for what’s wrong', async () => {
    const onChosen = vi.fn();
    renderNacre(
      <Harness onChosen={onChosen} onGuess={(typed) => Promise.resolve(guessOf(typed))} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Type a path' }));
    const path = screen.getByRole('combobox', { name: 'Path' });
    await waitFor(() => expect(path).toHaveFocus());
    expect(path).toHaveValue('~/');
    await userEvent.type(path, 'Pro');
    expect(await screen.findByRole('option', { name: /Projects/ })).toBeInTheDocument();
    await userEvent.keyboard('{Tab}');
    expect(path).toHaveValue('~/Projects/');
    await userEvent.type(path, 'nowhere');
    expect(await screen.findByRole('status')).toHaveTextContent('There’s no folder there.');
    await userEvent.clear(path);
    await userEvent.type(path, '~/Projects/conch');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Choose this folder' })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose this folder' }));
    expect(onChosen).toHaveBeenCalledWith(`${HOME}/Projects/conch`);
  });

  it('chooses a file with a press to pick it and a second to take it', async () => {
    const onChosen = vi.fn();
    renderNacre(<Harness kind="file" start={`${HOME}/Documents/Passwords`} onChosen={onChosen} />);
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeDisabled();
    await userEvent.click(screen.getByRole('option', { name: /Main\.kdbx/ }));
    expect(screen.getByRole('button', { name: 'Choose “Main.kdbx”' })).toBeEnabled();
    await userEvent.click(screen.getByRole('option', { name: /Main\.kdbx/ }));
    expect(onChosen).toHaveBeenCalledWith(`${HOME}/Documents/Passwords/Main.kdbx`);
  });

  it('says why a folder couldn’t be opened, with a way on', async () => {
    const onOpenFolder = vi.fn();
    renderNacre(
      <FolderBrowser
        open
        onOpenChange={() => undefined}
        listing={listingOf(`${HOME}/Documents`)}
        problem="macOS hasn’t let Conch look in there."
        onOpenFolder={onOpenFolder}
        onChoose={() => undefined}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('macOS hasn’t let Conch look in there.');
    expect(screen.getByRole('button', { name: /Choose/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Documents' }));
    expect(onOpenFolder).toHaveBeenCalledWith(`${HOME}/Documents`);
  });

  it('is accessible', async () => {
    renderNacre(
      <Harness
        onGuess={(typed) => Promise.resolve(guessOf(typed))}
        onCreateFolder={() => Promise.resolve()}
      />,
    );
    await expectAccessible(document.body);
  });
});
