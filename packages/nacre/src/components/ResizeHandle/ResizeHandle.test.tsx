import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ResizeHandle } from './ResizeHandle';

describe('ResizeHandle', () => {
  it('is an accessible slider that resizes with the keyboard', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { container } = renderNacre(
      <ResizeHandle
        label="Resize the browser"
        value={500}
        min={320}
        max={900}
        onValueChange={onValueChange}
      />,
    );
    const handle = screen.getByRole('slider', { name: 'Resize the browser' });
    expect(handle).toHaveAttribute('aria-valuenow', '500');
    handle.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onValueChange).toHaveBeenLastCalledWith(524);
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(onValueChange).toHaveBeenLastCalledWith(404);
    await user.keyboard('{End}');
    expect(onValueChange).toHaveBeenLastCalledWith(900);
    await expectAccessible(container);
  });

  it('grows the pane when dragged toward it, within its limits', () => {
    const onValueChange = vi.fn();
    renderNacre(
      <ResizeHandle label="Resize" value={500} min={320} max={600} onValueChange={onValueChange} />,
    );
    const handle = screen.getByRole('slider');
    fireEvent.pointerDown(handle, { button: 0, clientX: 800 });
    fireEvent.pointerMove(handle, { clientX: 740 });
    expect(onValueChange).toHaveBeenLastCalledWith(560);
    fireEvent.pointerMove(handle, { clientX: 100 });
    expect(onValueChange).toHaveBeenLastCalledWith(600);
  });

  it('resizes a drawer from above with up and down', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderNacre(
      <ResizeHandle
        axis="y"
        label="Resize the terminal"
        value={300}
        min={160}
        max={700}
        onValueChange={onValueChange}
      />,
    );
    const handle = screen.getByRole('slider', { name: 'Resize the terminal' });
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    handle.focus();
    await user.keyboard('{ArrowUp}');
    expect(onValueChange).toHaveBeenLastCalledWith(324);
    fireEvent.pointerDown(handle, { button: 0, clientY: 500 });
    fireEvent.pointerMove(handle, { clientY: 400 });
    expect(onValueChange).toHaveBeenLastCalledWith(400);
  });
});
