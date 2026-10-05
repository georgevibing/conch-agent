import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Composer, ComposerAttachment, ComposerChip, ComposerQueued } from './Composer';

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

  it('offers Talk in Send’s place while the box is empty, and Send once you type', async () => {
    const user = userEvent.setup();
    const onTalk = vi.fn();
    const onSubmit = vi.fn();
    const { container } = renderNacre(
      <Composer voice={{ label: 'Talk with Conch', onClick: onTalk }} onSubmit={onSubmit} />,
    );
    await user.click(screen.getByRole('button', { name: 'Talk with Conch' }));
    expect(onTalk).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
    await expectAccessible(container);

    await user.type(screen.getByRole('textbox'), 'hi');
    expect(screen.queryByRole('button', { name: 'Talk with Conch' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSubmit).toHaveBeenCalledWith('hi');
    // Empty again: Talk is back.
    expect(screen.getByRole('button', { name: 'Talk with Conch' })).toBeEnabled();
  });

  it('keeps Stop, not Talk, while running', () => {
    renderNacre(
      <Composer
        running
        onStop={() => {}}
        voice={{ label: 'Talk with Conch', onClick: () => {} }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Talk with Conch' })).toBeNull();
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

describe('Composer extensions', () => {
  it('lets onTextareaKeyDown claim Enter, spreads textareaProps and renders the overlay', async () => {
    const onSubmit = vi.fn();
    const claim = vi.fn((e: { key: string; preventDefault(): void }) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    renderNacre(
      <Composer
        label="Message"
        defaultValue="hello"
        onSubmit={onSubmit}
        onTextareaKeyDown={claim}
        textareaProps={{ 'aria-autocomplete': 'list' }}
        overlay={<div>Overlay here</div>}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Message' });
    expect(field).toHaveAttribute('aria-autocomplete', 'list');
    expect(screen.getByText('Overlay here')).toBeInTheDocument();
    field.focus();
    await userEvent.keyboard('{Enter}');
    expect(claim).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  describe('history', () => {
    const sent = ['first', 'second\nline two', 'third'];

    it('brings back what was sent with ↑, newest first, and walks forward with ↓', async () => {
      const user = userEvent.setup();
      renderNacre(<Composer history={sent} />);
      const field = screen.getByRole<HTMLTextAreaElement>('textbox');
      await user.click(field);
      await user.keyboard('{ArrowUp}');
      expect(field).toHaveValue('third');
      expect(field.selectionStart).toBe('third'.length);
      await user.keyboard('{ArrowUp}');
      expect(field).toHaveValue('second\nline two');
      // The caret is at the end of a two-line message: ↑ there moves it up a line first.
      expect(field.selectionStart).toBe('second\nline two'.length);
      field.setSelectionRange(0, 0);
      await user.keyboard('{ArrowUp}');
      expect(field).toHaveValue('first');
      // The oldest stays.
      await user.keyboard('{ArrowUp}');
      expect(field).toHaveValue('first');
      await user.keyboard('{ArrowDown}');
      expect(field).toHaveValue('second\nline two');
      await user.keyboard('{ArrowDown}{ArrowDown}');
      expect(field).toHaveValue('');
    });

    it('leaves the arrows alone in a message of your own', async () => {
      const user = userEvent.setup();
      renderNacre(<Composer history={sent} />);
      const field = screen.getByRole('textbox');
      await user.type(field, 'mine{ArrowUp}{ArrowDown}');
      expect(field).toHaveValue('mine');
    });

    it('lets a recalled message you changed be yours', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderNacre(<Composer history={sent} onSubmit={onSubmit} />);
      const field = screen.getByRole('textbox');
      await user.click(field);
      await user.keyboard('{ArrowUp}!{ArrowUp}{ArrowDown}');
      expect(field).toHaveValue('third!');
      await user.keyboard('{Enter}');
      expect(onSubmit).toHaveBeenCalledWith('third!');
    });

    it('works when the value is controlled', async () => {
      const user = userEvent.setup();
      function Controlled() {
        const [value, setValue] = useState('');
        return <Composer history={sent} value={value} onValueChange={setValue} />;
      }
      renderNacre(<Controlled />);
      const field = screen.getByRole('textbox');
      await user.click(field);
      await user.keyboard('{ArrowUp}{ArrowUp}');
      expect(field).toHaveValue('second\nline two');
    });

    it('gives way to a menu that claims the key, and to selecting with Shift', async () => {
      const user = userEvent.setup();
      renderNacre(
        <Composer
          history={sent}
          onTextareaKeyDown={(event) => {
            if (event.key === 'ArrowDown') event.preventDefault();
          }}
        />,
      );
      const field = screen.getByRole('textbox');
      await user.click(field);
      await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
      expect(field).toHaveValue('');
      await user.keyboard('{ArrowUp}{ArrowDown}');
      expect(field).toHaveValue('third');
    });
  });
});

describe('ComposerChip', () => {
  it('is an accessible toolbar button that keeps its full name when truncated', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = renderNacre(
      <Composer
        toolbar={
          <ComposerChip
            icon={<svg />}
            aria-label="Working folder: conch-agent-experiments"
            onClick={onClick}
          >
            conch-agent-experiments
          </ComposerChip>
        }
      />,
    );
    const chip = screen.getByRole('button', { name: 'Working folder: conch-agent-experiments' });
    expect(chip).toHaveAttribute('type', 'button');
    await user.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });
});

describe('ComposerQueued', () => {
  it('shows the waiting message in the composer, with edit and remove', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    const { container } = renderNacre(
      <Composer
        running
        allowSubmitWhileRunning
        queued={
          <ComposerQueued
            text="Then run the tests"
            meta="Sends when Conch is done"
            onEdit={onEdit}
            onRemove={onRemove}
          />
        }
      />,
    );
    expect(screen.getByRole('status', { name: 'Queued message' })).toHaveTextContent(
      'Then run the testsSends when Conch is done',
    );
    await user.click(screen.getByRole('button', { name: 'Edit queued message' }));
    expect(onEdit).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Don’t send queued message' }));
    expect(onRemove).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });
});
