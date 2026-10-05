import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { PathPicker } from './PathPicker';

describe('PathPicker', () => {
  it('offers what was found, then the Open dialog, and types only when asked', async () => {
    const onChange = vi.fn();
    const onChoose = vi.fn(() => Promise.resolve('/Volumes/USB/Work.kdbx'));
    const { container } = renderNacre(
      <PathPicker
        label="KeePassXC database"
        value="/Users/ada/Documents/Passwords.kdbx"
        onChange={onChange}
        onChoose={onChoose}
        suggestions={[
          { path: '/Users/ada/Documents/Passwords.kdbx', title: 'Passwords', detail: 'Documents' },
          { path: '/Users/ada/Dropbox/Family.kdbx', title: 'Family', detail: 'Dropbox' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: /Passwords/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Family/ }));
    expect(onChange).toHaveBeenLastCalledWith('/Users/ada/Dropbox/Family.kdbx');
    await userEvent.click(screen.getByRole('button', { name: 'Choose another file…' }));
    expect(onChoose).toHaveBeenCalled();
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith('/Volumes/USB/Work.kdbx'));
    // No text box until asked for.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Type a path' }));
    expect(screen.getByRole('textbox', { name: 'KeePassXC database' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('shows a chosen path as its name and folder, and types straight away with no dialog', () => {
    renderNacre(
      <PathPicker
        label="Folder"
        kind="folder"
        value="/Users/ada/Projects/site"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('radio', { name: /site/ })).toHaveAccessibleDescription('~/Projects');
    expect(screen.getByRole('textbox', { name: 'Folder' })).toBeInTheDocument();
  });

  it.each(['/', '\\'])('handles long runs of %s inside and at the end of a path', (slash) => {
    const parent = `work${slash.repeat(30_000)}`;
    const began = Date.now();
    renderNacre(
      <PathPicker
        label="Folder"
        kind="folder"
        value={`${parent}notes${slash.repeat(30_000)}`}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('radio', { name: 'notes' })).toHaveAccessibleDescription(
      parent.slice(0, -1),
    );
    expect(Date.now() - began).toBeLessThan(1000);
  });

  it('says so when the Open dialog can’t come up, and offers typing instead', async () => {
    const onChoose = vi.fn(() => Promise.reject(new Error('The Open dialog didn’t come up.')));
    renderNacre(
      <PathPicker label="Folder" kind="folder" onChange={() => undefined} onChoose={onChoose} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The Open dialog didn’t come up. Type the path instead.',
    );
    expect(screen.getByRole('textbox', { name: 'Folder' })).toBeInTheDocument();
  });
});
