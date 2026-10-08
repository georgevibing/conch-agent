import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Story } from '../Story/Story';
import { notReady, places, withSetup } from './fixtures';
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

  it('says when a place isn’t ready, and its next step in words, not a button', async () => {
    renderNacre(
      <WorkPlacePicker
        options={withSetup(notReady, () => {})}
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
    expect(screen.getByRole('radio', { name: /Daytona/ })).toHaveAccessibleDescription(
      'Needs a Daytona key. It’s free to start. Add a key, opens Settings',
    );
    expect(screen.queryByRole('button', { name: /Add a key/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Make this my default' })).toBeInTheDocument();
  });

  it('goes to set up a place when its row is pressed, instead of choosing it', async () => {
    const onValueChange = vi.fn();
    const onSetup = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <WorkPlacePicker
        options={withSetup(notReady, onSetup)}
        value="computer"
        onValueChange={onValueChange}
        onOpenChange={onOpenChange}
        isDefault
        open
      />,
    );
    await user.click(await screen.findByRole('radio', { name: /Daytona/ }));
    expect(onSetup).toHaveBeenCalledWith('cloud');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('passes over a row that needs setting up with the arrows, and opens it with Enter', async () => {
    const onValueChange = vi.fn();
    const onSetup = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <WorkPlacePicker
        options={withSetup(notReady, onSetup)}
        value="computer"
        onValueChange={onValueChange}
        isDefault
        open
      />,
    );
    expect(await screen.findByRole('radio', { name: /This computer/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /A container/ })).toHaveFocus();
    expect(onSetup).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onSetup).toHaveBeenCalledWith('container');
    onSetup.mockClear();
    await user.keyboard(' ');
    expect(onSetup).toHaveBeenCalledWith('container');
    onSetup.mockClear();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /build-box/ })).toHaveFocus();
    await user.keyboard(' ');
    expect(onValueChange).toHaveBeenCalledWith('ssh:build-box');
    expect(onSetup).not.toHaveBeenCalled();
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
      <WorkPlacePicker
        options={withSetup(notReady, () => {})}
        value="computer"
        onValueChange={() => {}}
        isDefault
        open
      />,
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
