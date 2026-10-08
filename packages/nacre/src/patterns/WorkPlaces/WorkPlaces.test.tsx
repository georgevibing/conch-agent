import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Story } from '../Story/Story';
import { notReady, places } from './fixtures';
import { WorkedAt } from './WorkedAt';
import { WorkPlacePicker } from './WorkPlacePicker';

describe('WorkPlacePicker', () => {
  it('names the place on its chip and moves the work with a press', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <WorkPlacePicker options={places} value="computer" onValueChange={onValueChange} isDefault />,
    );
    await user.click(screen.getByRole('button', { name: 'Where work runs: This computer' }));
    await user.click(await screen.findByRole('radio', { name: /build-box/ }));
    expect(onValueChange).toHaveBeenCalledWith('ssh:build-box');
  });

  it('works from the keyboard', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <WorkPlacePicker options={places} value="computer" onValueChange={onValueChange} isDefault />,
    );
    screen.getByRole('button', { name: /Where work runs/ }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('radio', { name: /This computer/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');
    expect(onValueChange).toHaveBeenCalledWith('container');
  });

  it('says when a place isn’t ready, and offers its next step', async () => {
    renderNacre(
      <WorkPlacePicker
        options={notReady.map((o) =>
          o.value === 'container'
            ? { ...o, action: <button type="button">Install Podman</button> }
            : o,
        )}
        value="container"
        onValueChange={() => {}}
        isDefault={false}
        onMakeDefault={() => {}}
        open
      />,
    );
    expect(
      screen.getByRole('button', { name: /Where work runs: A container, needs setting up/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Needs Docker or Podman on this computer.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install Podman' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make this my default' })).toBeInTheDocument();
  });

  it('says plainly when the provider runs its own commands here', async () => {
    renderNacre(
      <WorkPlacePicker
        options={places}
        value="container"
        onValueChange={() => {}}
        isDefault
        open
        note="Codex CLI runs its own commands on this computer."
      />,
    );
    expect(
      await screen.findByText('Codex CLI runs its own commands on this computer.'),
    ).toBeInTheDocument();
  });

  it('is accessible, open and closed', async () => {
    const { container } = renderNacre(
      <WorkPlacePicker options={notReady} value="cloud" onValueChange={() => {}} isDefault open />,
    );
    await screen.findByRole('radiogroup');
    await expectAccessible(container.ownerDocument.body);
  });
});

describe('WorkedAt', () => {
  it('says where a command ran, in full for a screen reader', async () => {
    const { container } = renderNacre(
      <>
        <WorkedAt kind="container" name="a container" />
        <WorkedAt kind="ssh" name="build-box" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Ran in a container' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ran on build-box' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('sits on a story’s row when every command ran there, and on each step when they differ', () => {
    const { rerender } = renderNacre(
      <Story
        headline="Ran the tests"
        family="run"
        status="done"
        defaultOpen
        steps={[
          {
            id: 's1',
            text: 'Ran the tests',
            status: 'success',
            family: 'run',
            where: { kind: 'cloud', name: 'the cloud' },
          },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: /ran in the cloud/ })).toBeInTheDocument();
    rerender(
      <Story
        headline="Built and tested"
        family="run"
        status="done"
        defaultOpen
        steps={[
          {
            id: 's1',
            text: 'Built it',
            status: 'success',
            family: 'run',
            where: { kind: 'container', name: 'a container' },
          },
          {
            id: 's2',
            text: 'Ran the tests',
            status: 'success',
            family: 'run',
            where: { kind: 'ssh', name: 'build-box' },
          },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Ran in a container' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ran on build-box' })).toBeInTheDocument();
  });
});
