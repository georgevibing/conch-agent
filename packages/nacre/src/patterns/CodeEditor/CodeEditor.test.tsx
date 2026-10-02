import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';

/** CodeMirror's editable area, once it has loaded. */
const editable = async () => {
  await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull());
  return document.querySelector('.cm-content') as HTMLElement;
};

describe('CodeEditor', () => {
  it('loads CodeMirror, named for screen readers, with no axe violations', async () => {
    const { container } = renderNacre(
      <CodeEditor
        value={'{"a": 1}'}
        onChange={() => undefined}
        language="json"
        label="Code of Visitors"
      />,
    );
    expect(screen.getByRole('status', { name: 'Opening the editor…' })).toBeInTheDocument();
    const content = await editable();
    expect(content).toHaveAttribute('aria-label', 'Code of Visitors');
    expect(content).toHaveAttribute('role', 'textbox');
    expect(content.textContent).toBe('{"a": 1}');
    await expectAccessible(container);
  });

  it('says every change, undoes and redoes it, and takes text from outside', async () => {
    const onChange = vi.fn();
    const onHistory = vi.fn();
    const handle = createRef<CodeEditorHandle>();
    const { rerender } = renderNacre(
      <CodeEditor
        ref={handle}
        value="Item,Cost"
        onChange={onChange}
        onHistoryChange={onHistory}
        language="csv"
        label="Code"
      />,
    );
    await editable();
    rerender(
      <CodeEditor
        ref={handle}
        value={'Item,Cost\nRent,1200'}
        onChange={onChange}
        onHistoryChange={onHistory}
        language="csv"
        label="Code"
      />,
    );
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('Item,Cost\nRent,1200'));
    expect(onHistory).toHaveBeenLastCalledWith({ canUndo: true, canRedo: false });
    act(() => handle.current?.undo());
    expect(onChange).toHaveBeenLastCalledWith('Item,Cost');
    expect(onHistory).toHaveBeenLastCalledWith({ canUndo: false, canRedo: true });
    act(() => handle.current?.redo());
    expect(onChange).toHaveBeenLastCalledWith('Item,Cost\nRent,1200');
  });

  it('saves with ⌘S and cancels with Esc', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    renderNacre(
      <CodeEditor
        value="# Plan"
        onChange={() => undefined}
        onSave={onSave}
        onCancel={onCancel}
        language="markdown"
        label="Code"
      />,
    );
    const content = await editable();
    // jsdom isn't a Mac: the shortcut is Ctrl there, ⌘ on one.
    fireEvent.keyDown(content, { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(content, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
