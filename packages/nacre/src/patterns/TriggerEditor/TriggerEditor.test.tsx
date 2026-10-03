import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import type { TriggerValue } from '../Routines/types';
import { fakeTriggerPreview, PEOPLE, ROUTINES } from './fixtures';
import { defaultTrigger, TriggerEditor } from './TriggerEditor';

function Harness({
  initial,
  onChange,
  people = PEOPLE,
  onChooseFolder,
}: {
  initial: TriggerValue;
  onChange?: (v: TriggerValue, onlyIf: string) => void;
  people?: typeof PEOPLE;
  onChooseFolder?: () => Promise<string | undefined>;
}) {
  const [value, setValue] = useState(initial);
  const [onlyIf, setOnlyIf] = useState('');
  return (
    <TriggerEditor
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v, onlyIf);
      }}
      onlyIf={onlyIf}
      onOnlyIfChange={(v) => {
        setOnlyIf(v);
        onChange?.(value, v);
      }}
      preview={fakeTriggerPreview(value, onlyIf)}
      people={people}
      peopleNote="Connect Gmail to pick from people you write to."
      routines={ROUTINES}
      {...(onChooseFolder && { onChooseFolder })}
    />
  );
}

describe('TriggerEditor', () => {
  it('offers plain choices, and keeps another app behind Advanced', async () => {
    const { container } = renderNacre(<Harness initial={{ kind: 'mail', from: [], words: [] }} />);
    for (const name of [
      /An email arrives/,
      /Before a meeting/,
      /A page changes/,
      /A folder changes/,
      /A task finishes/,
      /Another routine runs/,
    ])
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Another app sends a message/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByRole('radio', { name: /Another app sends a message/ })).toBeInTheDocument();
    expect(screen.getByText('When an email arrives')).toBeInTheDocument();
    expect(screen.getByText('Free until something happens.')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('picks people you write to with a tap, and takes anyone else typed', async () => {
    const onChange = vi.fn();
    renderNacre(<Harness initial={{ kind: 'mail', from: [], words: [] }} onChange={onChange} />);
    const anna = screen.getByRole('button', { name: 'Anna Smith' });
    await userEvent.click(anna);
    expect(anna).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('When Anna Smith emails you')).toBeInTheDocument();
    await userEvent.type(
      screen.getByRole('textbox', { name: /Someone else/ }),
      'Zoe@Example.com{Enter}',
    );
    expect(onChange).toHaveBeenLastCalledWith(
      {
        kind: 'mail',
        from: [
          { address: 'anna.smith@example.com', name: 'Anna Smith' },
          { address: 'zoe@example.com' },
        ],
        words: [],
      },
      '',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove zoe@example.com' }));
    await userEvent.type(screen.getByRole('textbox', { name: /About/ }), 'invoice, receipt');
    expect(
      screen.getByText('When Anna Smith emails you about “invoice” or “receipt”'),
    ).toBeInTheDocument();
  });

  it('says how to have people to pick from when there are none', () => {
    renderNacre(<Harness initial={{ kind: 'mail', from: [], words: [] }} people={[]} />);
    expect(screen.getByText('Connect Gmail to pick from people you write to.')).toBeInTheDocument();
  });

  it('switching choices keeps the words that still fit', async () => {
    const onChange = vi.fn();
    renderNacre(
      <Harness initial={{ kind: 'mail', from: [], words: ['standup'] }} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /Before a meeting/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      { kind: 'calendar', minutesBefore: 15, withOthers: true, words: ['standup'] },
      '',
    );
    expect(screen.getByRole('switch', { name: /Only meetings with other people/ })).toBeChecked();
  });

  it('chooses a folder with the Open dialog, never by typing first', async () => {
    const choose = vi.fn(async () => '/Users/ada/Downloads');
    const onChange = vi.fn();
    renderNacre(
      <Harness
        initial={{ kind: 'folder', path: '' }}
        onChange={onChange}
        onChooseFolder={choose}
      />,
    );
    expect(screen.queryByRole('textbox', { name: /Folder/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Choose a folder/ }));
    expect(choose).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'folder', path: '/Users/ada/Downloads' }, '');
  });

  it('says why it can’t be saved yet, and takes an only-if', async () => {
    const onChange = vi.fn();
    renderNacre(<Harness initial={{ kind: 'page', url: '', every: 60 }} onChange={onChange} />);
    expect(screen.getByText(/That isn’t a web address/)).toBeInTheDocument();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Page address' }),
      'https://example.com/pricing',
    );
    expect(screen.getByText('When example.com/pricing changes')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /Only if/ }), 'the price drops');
    expect(
      screen.getByText('When example.com/pricing changes, only if the price drops'),
    ).toBeInTheDocument();
  });

  it('makes a fresh trigger of each kind', () => {
    expect(defaultTrigger('page')).toEqual({ kind: 'page', url: '', every: 60 });
    expect(defaultTrigger('hook')).toEqual({ kind: 'hook' });
    expect(defaultTrigger('routine')).toEqual({ kind: 'routine', routineId: '' });
  });

  it('is accessible with every choice', async () => {
    for (const value of [
      { kind: 'calendar', minutesBefore: 30, withOthers: false, words: [] },
      { kind: 'page', url: 'https://example.com', every: 60 },
      { kind: 'folder', path: '/Users/ada/Downloads' },
      { kind: 'routine', routineId: 'r_brief' },
      { kind: 'hook' },
    ] as TriggerValue[]) {
      const { container, unmount } = renderNacre(<Harness initial={value} />);
      await expectAccessible(container);
      unmount();
    }
  });
});
