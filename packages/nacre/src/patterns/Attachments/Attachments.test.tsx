import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Composer } from '../Composer';
import { AttachmentCard, AttachmentList } from './AttachmentCard';
import { AttachmentPreview } from './AttachmentPreview';
import { DropOverlay, useFileDrop } from './DropOverlay';
import { familyOf, metaOf, parseDelimited, previewModeOf } from './fileType';

describe('fileType', () => {
  it('sorts files into families and previews', () => {
    expect(familyOf({ name: 'a.pdf', kind: 'file' })).toBe('pdf');
    expect(familyOf({ name: 'a.csv', kind: 'text' })).toBe('data');
    expect(familyOf({ name: 'a.xlsx', kind: 'file' })).toBe('sheet');
    expect(familyOf({ name: 'x', kind: 'text', pasted: true })).toBe('pasted');
    expect(previewModeOf({ name: 'a.csv', kind: 'text' })).toBe('table');
    expect(previewModeOf({ name: 'a.ts', kind: 'text' })).toBe('code');
    expect(previewModeOf({ name: 'a.heic', kind: 'file', mimeType: 'image/heic' })).toBe('none');
    expect(previewModeOf({ name: 'a.png', kind: 'image' })).toBe('image');
    expect(metaOf({ name: 'x', kind: 'text', lines: 1200 })).toBe('1,200 lines');
  });

  it('parses quoted CSV cells', () => {
    expect(parseDelimited('a,b\n"x, y","say ""hi"""\n', ',')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });
});

describe('AttachmentCard', () => {
  it('is accessible and says what it is', async () => {
    const { container } = renderNacre(
      <AttachmentList>
        <AttachmentCard
          name="Pasted text"
          kind="text"
          pasted
          lines={48}
          excerpt="log"
          onOpen={() => {}}
          onRemove={() => {}}
        />
        <AttachmentCard
          name="report.pdf"
          kind="file"
          mimeType="application/pdf"
          size={2_480_000}
          onOpen={() => {}}
        />
        <AttachmentCard
          name="a.png"
          kind="image"
          src="data:image/png;base64,AA"
          status="uploading"
          onRemove={() => {}}
        />
        <AttachmentCard
          name="b.csv"
          kind="text"
          status="error"
          error="Too big"
          onRetry={() => {}}
          onRemove={() => {}}
        />
      </AttachmentList>,
    );
    expect(screen.getByRole('button', { name: 'Pasted text, 48 lines' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'report.pdf, PDF, 2.4 MB' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /a\.png, PNG, uploading/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /b\.csv, CSV, Too big/ })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('opens on click, and Delete removes it', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    renderNacre(<AttachmentCard name="a.txt" kind="text" onOpen={onOpen} onRemove={onRemove} />);
    const card = screen.getByRole('button', { name: /^a\.txt/ });
    await user.click(card);
    expect(onOpen).toHaveBeenCalled();
    card.focus();
    await user.keyboard('{Delete}');
    expect(onRemove).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Remove a.txt' }));
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it('offers a retry when it failed', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderNacre(<AttachmentCard name="a.txt" kind="text" status="error" onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Try uploading a.txt again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('says in words when it is no longer here, and offers to take it off', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const { container } = renderNacre(
      <AttachmentList>
        <AttachmentCard
          name="cat.png"
          kind="image"
          src="blob:gone"
          status="lost"
          error="Remove it, then attach it again."
          onRemove={onRemove}
        />
      </AttachmentList>,
    );
    expect(screen.getByText('No longer here')).toBeInTheDocument();
    // Its picture went with it: no broken image.
    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.getByRole('button', { name: /cat\.png.*no longer here.*attach it again/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try uploading/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove cat.png' }));
    expect(onRemove).toHaveBeenCalled();
    await expectAccessible(container);
  });
});

describe('AttachmentPreview', () => {
  it('edits a paste in place and can put it back in the message', async () => {
    const user = userEvent.setup();
    const onTextChange = vi.fn();
    const onInsert = vi.fn();
    const { baseElement } = renderNacre(
      <AttachmentPreview
        open
        onOpenChange={() => {}}
        attachment={{ name: 'Pasted text', kind: 'text', pasted: true, lines: 2 }}
        text={'one\ntwo'}
        onTextChange={onTextChange}
        onInsert={onInsert}
      />,
    );
    const editor = screen.getByRole('textbox', { name: 'Pasted text' });
    expect(editor).toHaveFocus();
    await user.type(editor, '!');
    expect(onTextChange).toHaveBeenLastCalledWith('one\ntwo!');
    await user.click(screen.getByRole('button', { name: 'Paste into message' }));
    expect(onInsert).toHaveBeenCalled();
    await expectAccessible(baseElement);
  });

  it('shows a CSV as a table, and moves between attachments with the arrows', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const { baseElement } = renderNacre(
      <AttachmentPreview
        open
        onOpenChange={() => {}}
        attachment={{ name: 'team.csv', kind: 'text', lines: 3 }}
        text={'name,team\nAda,Platform\n'}
        position={{ index: 1, count: 3 }}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'team' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Platform' })).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(onNavigate).toHaveBeenCalledWith(1);
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    await expectAccessible(baseElement);
  });

  it('says plainly when there is no preview', () => {
    renderNacre(
      <AttachmentPreview
        open
        onOpenChange={() => {}}
        attachment={{ name: 'a.xlsx', kind: 'file' }}
        downloadHref="/x"
      />,
    );
    expect(screen.getByText(/no preview for this kind of file/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/x');
  });
});

function files(...names: string[]) {
  const list = names.map((name) => new File(['x'], name));
  return {
    types: ['Files'],
    files: list,
    items: list.map((file) => ({
      kind: 'file',
      getAsFile: () => file,
      webkitGetAsEntry: () => ({ isDirectory: false, name: file.name }),
    })),
    dropEffect: 'none',
  };
}

describe('useFileDrop', () => {
  it('shows while files hover and hands them over on drop; ignores dragged text', () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onDrop }));
    const target = document.createElement('div');
    const fire = (type: 'onDragEnter' | 'onDragLeave' | 'onDrop', dataTransfer: unknown) =>
      act(() =>
        result.current.props[type]({
          dataTransfer,
          preventDefault: () => {},
          currentTarget: target,
        } as never),
      );
    fire('onDragEnter', { types: ['text/plain'] });
    expect(result.current.dragging).toBe(false);
    fire('onDragEnter', files('a.txt'));
    expect(result.current.dragging).toBe(true);
    fire('onDrop', files('a.txt', 'b.png'));
    expect(result.current.dragging).toBe(false);
    expect(onDrop).toHaveBeenCalledWith({ files: expect.any(Array), folders: [] });
    expect(onDrop.mock.calls[0]?.[0].files).toHaveLength(2);
  });

  it('keeps a file dropped beside the chat from opening in the tab', () => {
    renderHook(() => useFileDrop({ onDrop: () => {} }));
    const event = new Event('drop', { cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('renders an overlay that never takes the pointer', () => {
    const { container } = renderNacre(<DropOverlay active hint="Up to 30 MB" />);
    expect(container.querySelector('[data-active]')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Composer attachments', () => {
  const paste = (field: HTMLElement, text: string, fileList: File[] = []) =>
    fireEvent.paste(field, {
      clipboardData: { getData: () => text, files: fileList },
    });

  it('folds a long paste into a card, and leaves short ones alone', () => {
    const onLongPaste = vi.fn();
    renderNacre(<Composer onLongPaste={onLongPaste} />);
    const field = screen.getByRole('textbox');
    paste(field, 'short');
    expect(onLongPaste).not.toHaveBeenCalled();
    paste(field, 'x'.repeat(1001));
    expect(onLongPaste).toHaveBeenCalledWith('x'.repeat(1001));
    paste(field, Array(22).fill('line').join('\n'));
    expect(onLongPaste).toHaveBeenCalledTimes(2);
  });

  it('pastes inline with Shift', () => {
    const onLongPaste = vi.fn();
    renderNacre(<Composer onLongPaste={onLongPaste} />);
    const field = screen.getByRole('textbox');
    fireEvent.keyDown(field, { key: 'V', shiftKey: true, metaKey: true });
    paste(field, 'x'.repeat(5000));
    expect(onLongPaste).not.toHaveBeenCalled();
  });

  it('attaches pasted files, but prefers text when both come (an Office copy)', () => {
    const onFiles = vi.fn();
    renderNacre(<Composer onFiles={onFiles} />);
    const field = screen.getByRole('textbox');
    const shot = new File(['x'], 'image.png', { type: 'image/png' });
    paste(field, 'A1\tB1', [shot]);
    expect(onFiles).not.toHaveBeenCalled();
    paste(field, '', [shot]);
    expect(onFiles).toHaveBeenCalledWith([shot]);
  });

  it('sends with only attachments, and holds while they upload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = renderNacre(
      <Composer
        onSubmit={onSubmit}
        canSubmitEmpty
        sendBlocked="Waiting for attachments to upload…"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Waiting for attachments to upload…' }),
    ).toBeDisabled();
    rerender(<Composer onSubmit={onSubmit} canSubmitEmpty />);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('opens the file picker from the attach button', async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    const { container } = renderNacre(<Composer onFiles={onFiles} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'a.txt');
    await user.upload(input, file);
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
  });
});
