import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AvatarPicker } from './AvatarPicker';
import { MAX_ZOOM, START, cropOf, moveFrame, zoomFrame } from './framing';

const landscape = { width: 400, height: 200 };

describe('framing a photo', () => {
  it('covers the square with the short side, and shows its middle', () => {
    expect(cropOf(landscape, START)).toEqual({ x: 100, y: 0, size: 200 });
    expect(cropOf({ width: 300, height: 300 }, START)).toEqual({ x: 0, y: 0, size: 300 });
  });

  it('never moves so far that an edge shows', () => {
    // Wide: half a square of room each way across, none up or down.
    expect(moveFrame(landscape, START, 5, 5)).toEqual({ zoom: 1, x: 0.5, y: 0 });
    expect(cropOf(landscape, moveFrame(landscape, START, 5, 0))).toEqual({
      x: 0,
      y: 0,
      size: 200,
    });
  });

  it('zooms about the middle, between 1 and the most', () => {
    const near = zoomFrame(landscape, START, 2);
    expect(cropOf(landscape, near)).toEqual({ x: 150, y: 50, size: 100 });
    expect(zoomFrame(landscape, START, 10).zoom).toBe(MAX_ZOOM);
    expect(zoomFrame(landscape, START, 0.2).zoom).toBe(1);
    // Moved, then zoomed: the same spot stays in the middle.
    const moved = moveFrame(landscape, near, 0.4, 0.2);
    expect(zoomFrame(landscape, moved, 1)).toEqual({ zoom: 1, x: 0.2, y: 0 });
  });
});

describe('AvatarPicker', () => {
  beforeEach(() => {
    // jsdom has no images to decode, nor object URLs.
    HTMLImageElement.prototype.decode = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
      configurable: true,
      get: () => 600,
    });
    URL.createObjectURL = vi.fn(() => 'blob:photo');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  const file = new File([new Uint8Array([1])], 'me.png', { type: 'image/png' });

  it('is your initial, a button that adds a photo', async () => {
    const { container } = renderNacre(
      <AvatarPicker name="George" onSave={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Add a photo' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'George' })).toBeVisible();
    await expectAccessible(container);
  });

  it('opens a chosen picture in the frame; Cancel leaves things as they were', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderNacre(<AvatarPicker name="George" onSave={onSave} onRemove={vi.fn()} />);
    await user.upload(screen.getByLabelText('Choose a photo'), file);
    const dialog = await screen.findByRole('dialog', { name: 'Frame your photo' });
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveAttribute('aria-valuetext', '100%');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveAttribute('aria-valuetext', '125%');
    // Zoomed in, there's room to move it from the keyboard too.
    const across = screen.getByRole('slider', { name: 'Move your photo left or right' });
    expect(across).toHaveAttribute('aria-valuetext', 'In the middle');
    fireEvent.change(across, { target: { value: String(Number(across.getAttribute('max'))) } });
    expect(across).toHaveAttribute('aria-valuetext', '100% right');
    await expectAccessible(dialog);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });

  it('takes a picture dropped on it', async () => {
    renderNacre(<AvatarPicker name="George" onSave={vi.fn()} onRemove={vi.fn()} />);
    const face = screen.getByRole('button', { name: 'Add a photo' });
    fireEvent.dragOver(face, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(face).toHaveAttribute('data-over');
    await act(async () => {
      fireEvent.drop(face, { dataTransfer: { types: ['Files'], files: [file] } });
    });
    expect(await screen.findByRole('dialog', { name: 'Frame your photo' })).toBeVisible();
  });

  it('uses an object URL for untrusted picture bytes and saves only the rasterized canvas', async () => {
    const upload = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg"><script>globalThis.avatarScriptRan = true</script></svg>',
      ],
      '"><img src=x onerror=alert(1)>.svg',
      { type: 'image/svg+xml' },
    );
    const photo = new Blob(['rasterized pixels'], { type: 'image/webp' });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(photo),
    );
    const onSave = vi.fn();
    renderNacre(<AvatarPicker name="George" onSave={onSave} onRemove={vi.fn()} />);
    await act(async () => {
      fireEvent.drop(screen.getByRole('button', { name: 'Add a photo' }), {
        dataTransfer: { types: ['Files'], files: [upload] },
      });
    });
    const dialog = await screen.findByRole('dialog', { name: 'Frame your photo' });
    expect(URL.createObjectURL).toHaveBeenCalledWith(upload);
    expect(dialog.querySelector('img')).toHaveAttribute('src', 'blob:photo');
    expect(dialog.querySelectorAll('img')).toHaveLength(1);
    expect(dialog.querySelector('script, iframe, object, embed, [onerror]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Use this photo' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(photo));
    expect(drawImage).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalledWith(upload);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });

  it('with a photo, offers a new one or taking it away', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderNacre(<AvatarPicker name="George" src="/me.webp" onSave={vi.fn()} onRemove={onRemove} />);
    await user.click(screen.getByRole('button', { name: 'Change your photo' }));
    expect(screen.getByRole('menuitem', { name: 'Choose a new photo' })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: 'Remove photo' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
