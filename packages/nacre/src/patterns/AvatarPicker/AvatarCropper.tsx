import { ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { Slider } from '../../components/Slider';
import {
  MAX_ZOOM,
  START,
  baseSize,
  cropOf,
  moveFrame,
  zoomFrame,
  type Frame,
  type PhotoSize,
} from './framing';
import styles from './AvatarPicker.module.css';

/** The side, in pixels, of a framed picture. */
export const PHOTO_SIZE = 512;

/** A picture opened for framing (`openPicture`). */
export interface OpenedPicture extends PhotoSize {
  url: string;
  image: HTMLImageElement;
}

/**
 * Open a picture to frame: a file someone chose or dropped, or one a model
 * made. Throws, in words, when it isn't a picture this browser can draw.
 * Its `url` is an object URL: `closePicture` lets it go.
 */
export async function openPicture(file: Blob): Promise<OpenedPicture> {
  if (!file.type.startsWith('image/'))
    throw new Error('That isn’t a picture. Try a PNG, JPEG or WebP.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('no size');
    return { url, image, width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('That picture couldn’t be opened. Try a PNG, JPEG or WebP.');
  }
}

export function closePicture(picture: OpenedPicture | undefined) {
  if (picture) URL.revokeObjectURL(picture.url);
}

export interface AvatarCropperProps {
  /** The picture to frame; none, and the dialog is closed. */
  picture: OpenedPicture | undefined;
  /** What shows: a circle (a person's photo) or a rounded tile (an agent's face). */
  shape?: 'circle' | 'tile';
  title?: string;
  description?: string;
  confirmLabel?: string;
  /** The framed square, as WebP (or PNG), no bigger than `maxBytes`. */
  onSave: (picture: Blob) => Promise<void> | void;
  onClose: () => void;
  /** The most the framed picture may weigh: it's drawn smaller or softer until it fits. */
  maxBytes?: number;
}

/**
 * A picture in a square, its shape marked out on it: drag it, zoom it (the
 * slider, the buttons, a scroll or a pinch), keep it. From the keyboard two
 * quiet sliders inside the stage move it. What's kept is a square drawn in
 * the browser at 512 px, and shrunk until it fits `maxBytes`, so nothing big
 * or unframed ever leaves the page.
 */
export function AvatarCropper({
  picture,
  shape = 'circle',
  title = 'Frame your photo',
  description = 'Drag it to move it, and zoom until it looks like you.',
  confirmLabel = 'Use this photo',
  onSave,
  onClose,
  maxBytes,
}: AvatarCropperProps) {
  return (
    <Dialog.Root open={!!picture} onOpenChange={(next) => !next && onClose()}>
      {picture && (
        <Framer
          key={picture.url}
          picked={picture}
          shape={shape}
          title={title}
          description={description}
          confirmLabel={confirmLabel}
          maxBytes={maxBytes}
          onSave={onSave}
        />
      )}
    </Dialog.Root>
  );
}

function Framer({
  picked,
  shape,
  title,
  description,
  confirmLabel,
  maxBytes,
  onSave,
}: {
  picked: OpenedPicture;
  shape: 'circle' | 'tile';
  title: string;
  description: string;
  confirmLabel: string;
  maxBytes: number | undefined;
  onSave: (photo: Blob) => Promise<void> | void;
}) {
  const [frame, setFrame] = useState<Frame>(START);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: Frame; side: number }>(undefined);

  // A wheel or a pinch on the trackpad zooms; it mustn't scroll the page behind.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setFrame((f) => zoomFrame(picked, f, f.zoom * Math.exp(-e.deltaY * 0.002)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [picked]);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const side = e.currentTarget.getBoundingClientRect().width;
    drag.current = { x: e.clientX, y: e.clientY, from: frame, side };
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = d.from.x + (e.clientX - d.x) / d.side;
    const y = d.from.y + (e.clientY - d.y) / d.side;
    setFrame(moveFrame(picked, d.from, x, y));
  };
  const up = () => {
    drag.current = undefined;
    setDragging(false);
  };

  const base = baseSize(picked);
  const room = { x: (base.w * frame.zoom - 1) / 2, y: (base.h * frame.zoom - 1) / 2 };
  const where = (offset: number, side: number, [less, more]: [string, string]) =>
    Math.abs(offset) < 0.005 || side < 0.005
      ? 'In the middle'
      : `${Math.round((Math.abs(offset) / side) * 100)}% ${offset < 0 ? less : more}`;
  const what = shape === 'tile' ? 'the picture' : 'your photo';

  const save = async () => {
    setSaving(true);
    setProblem(undefined);
    try {
      await onSave(await drawFramed(picked, frame, maxBytes));
    } catch (error) {
      setProblem((error as Error).message || 'That couldn’t be kept just now.');
      setSaving(false);
    }
  };

  const ratio = picked.width / picked.height;
  const look = {
    '--ap-w': Math.max(1, ratio),
    '--ap-h': Math.max(1, 1 / ratio),
    '--ap-x': frame.x,
    '--ap-y': frame.y,
    '--ap-zoom': frame.zoom,
  } as CSSProperties;

  return (
    <Dialog.Content size="sm" className={styles.dialog}>
      <Dialog.Header>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description>{description}</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body className={styles.body}>
        <div
          ref={stage}
          className={styles.stage}
          style={look}
          data-dragging={dragging || undefined}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <img src={picked.url} alt="" draggable={false} className={styles.photo} />
          <span className={styles.circle} data-shape={shape} aria-hidden />
          <input
            type="range"
            className={styles.axis}
            aria-label={`Move ${what} left or right`}
            min={-room.x}
            max={room.x}
            step={room.x / 20 || 1}
            value={frame.x}
            disabled={room.x < 0.005}
            aria-valuetext={where(frame.x, room.x, ['left', 'right'])}
            onChange={(e) => setFrame((f) => moveFrame(picked, f, Number(e.target.value), f.y))}
          />
          <input
            type="range"
            className={styles.axis}
            aria-label={`Move ${what} up or down`}
            // Up goes up: the slider's value is the photo's rise.
            min={-room.y}
            max={room.y}
            step={room.y / 20 || 1}
            value={-frame.y}
            disabled={room.y < 0.005}
            aria-valuetext={where(-frame.y, room.y, ['down', 'up'])}
            onChange={(e) => setFrame((f) => moveFrame(picked, f, f.x, -Number(e.target.value)))}
          />
        </div>
        <div className={styles.zoom}>
          <IconButton
            label="Zoom out"
            size="sm"
            variant="ghost"
            disabled={frame.zoom <= 1}
            onClick={() => setFrame((f) => zoomFrame(picked, f, f.zoom - 0.25))}
          >
            <ZoomOut />
          </IconButton>
          <Slider
            size="sm"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={[frame.zoom]}
            onValueChange={([zoom]) => setFrame((f) => zoomFrame(picked, f, zoom ?? 1))}
            aria-label="Zoom"
            getValueText={(v) => `${Math.round(v * 100)}%`}
            className={styles.slider}
          />
          <IconButton
            label="Zoom in"
            size="sm"
            variant="ghost"
            disabled={frame.zoom >= MAX_ZOOM}
            onClick={() => setFrame((f) => zoomFrame(picked, f, f.zoom + 0.25))}
          >
            <ZoomIn />
          </IconButton>
        </div>
        {problem && (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">Cancel</Button>
        </Dialog.Close>
        <Button loading={saving} onClick={() => void save()}>
          {confirmLabel}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}

/**
 * The framed square, drawn out at `PHOTO_SIZE`: WebP where the browser makes
 * it (PNG otherwise), a little softer and then smaller until it weighs no
 * more than `maxBytes`.
 */
export async function drawFramed(
  picked: OpenedPicture,
  frame: Frame,
  maxBytes = Infinity,
): Promise<Blob> {
  const crop = cropOf(picked, frame);
  const attempts: [size: number, quality: number][] = [
    [PHOTO_SIZE, 0.9],
    [PHOTO_SIZE, 0.78],
    [384, 0.8],
    [256, 0.8],
  ];
  let last: Blob | undefined;
  for (const [size, quality] of attempts) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser couldn’t frame the picture.');
    context.imageSmoothingQuality = 'high';
    context.drawImage(picked.image, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size);
    last = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, 'image/webp', quality),
    ).then((blob) => blob ?? undefined);
    if (!last) throw new Error('This browser couldn’t frame the picture.');
    if (last.size <= maxBytes) return last;
  }
  throw new Error('That picture is too detailed to keep. Try another, or zoom in a little.');
}
