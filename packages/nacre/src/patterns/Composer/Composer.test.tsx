import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Composer, ComposerAttachment } from './Composer';

describe('Composer', () => {
  it('is accessible', async () => {
    const { container } = renderNacre(
      <Composer attachments={<ComposerAttachment name="a.ts" meta="1 KB" onRemove={() => {}} />} />,
    );
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAccessibleDescription(
      'Press Enter to send, Shift+Enter for a new line.',
    );
    await expectAccessible(container);
  });

  it('sends trimmed text on Enter and clears when uncontrolled', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderNacre(<Composer onSubmit={onSubmit} />);
    const field = screen.getByRole('textbox');
    await user.type(field, '  hello  {Enter}');
    expect(onSubmit).toHaveBeenCalledWith('hello');
    expect(field).toHaveValue('');
  });

  it('inserts a newline on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderNacre(<Composer onSubmit={onSubmit} />);
    const field = screen.getByRole('textbox');
    await user.type(field, 'one{Shift>}{Enter}{/Shift}two');
    expect(field).toHaveValue('one\ntwo');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('ignores Enter while an IME composition is active', () => {
    const onSubmit = vi.fn();
    renderNacre(<Composer defaultValue="にほんご" onSubmit={onSubmit} />);
    const field = screen.getByRole('textbox');
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('にほんご');
  });

  it('does not send empty messages', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderNacre(<Composer onSubmit={onSubmit} />);
    await user.type(screen.getByRole('textbox'), '   {Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('sends with the button', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderNacre(<Composer defaultValue="ship it" onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSubmit).toHaveBeenCalledWith('ship it');
  });

  it('becomes a Stop button while running and stops on Escape', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    const { container } = renderNacre(
      <Composer running onStop={onStop} onSubmit={onSubmit} defaultValue="next" />,
    );
    expect(container.querySelector('[data-lustre-ambient]')).not.toBeNull();
    const stop = screen.getByRole('button', { name: 'Stop' });
    await user.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
    const field = screen.getByRole('textbox');
    field.focus();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it('can queue a follow-up while running when allowed', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderNacre(<Composer running allowSubmitWhileRunning onSubmit={onSubmit} onStop={() => {}} />);
    await user.type(screen.getByRole('textbox'), 'also check CI{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('also check CI');
  });

  it('supports controlled usage', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderNacre(<Composer value="fixed" onValueChange={onValueChange} />);
    await user.type(screen.getByRole('textbox'), 'x');
    expect(onValueChange).toHaveBeenCalledWith('fixedx');
    expect(screen.getByRole('textbox')).toHaveValue('fixed');
  });

  it('removes attachments', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderNacre(
      <Composer attachments={<ComposerAttachment name="log.txt" onRemove={onRemove} />} />,
    );
    expect(screen.getByRole('list', { name: 'Attachments' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove log.txt' }));
    expect(onRemove).toHaveBeenCalled();
  });
});
