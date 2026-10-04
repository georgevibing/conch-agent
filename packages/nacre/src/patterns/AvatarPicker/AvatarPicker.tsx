import { Camera, ImageUp, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from 'react';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { DropdownMenu } from '../../components/DropdownMenu';
import { IconButton } from '../../components/IconButton';
import { Slider } from '../../components/Slider';
import { toast } from '../../components/Toast';
import { cx } from '../../utils/cx';
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

/** The side, in pixels, of the photo handed to `onSave`. */
export const PHOTO_SIZE = 512;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

export interface AvatarPickerProps {
  /** Whose photo: its initial shows while there's none. */
  name: string;
  /** The photo now, if there is one. */
  src?: string;
  /** A square photo, framed as chosen: WebP (or PNG where WebP can't be made). */
  onSave: (photo: Blob) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
  className?: string;
}

interface Picked extends PhotoSize {
  url: string;
  image: HTMLImageElement;
}

/**
 * Your photo, as you'd change it on a phone: press your initial (or drop a
 * picture on it), frame it in a circle, and it's there. Once there's a photo,
 * the same press offers a new one or taking it away.
 */
export function AvatarPicker({ name, src, onSave, onRemove, className }: AvatarPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked>();
  const [over, setOver] = useState(false);
  const [arrived, setArrived] = useState(false);
  const choose = () => input.current?.click();

  const open = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('That isn’t a picture. Try a PNG, JPEG or WebP.');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('no size');
      setPicked({ url, image, width: image.naturalWidth, height: image.naturalHeight });
    } catch {
      URL.revokeObjectURL(url);
      toast.error('That picture couldn’t be opened. Try a PNG, JPEG or WebP.');
    }
  };

  const close = () => {
    if (picked) URL.revokeObjectURL(picked.url);
    setPicked(undefined);
  };

  const remove = async () => {
    try {
      await onRemove();
    } catch (error) {
      toast.error((error as Error).message || 'Your photo couldn’t be taken away just now.');
    }
  };

  const drop = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      void open(e.dataTransfer.files[0]);
    },
  };

  const face = (
    <button
      type="button"
      className={cx(styles.picker, className)}
      data-over={over || undefined}
      data-arrived={arrived || undefined}
      aria-label={src ? 'Change your photo' : 'Add a photo'}
      // The ring outlasts the spring: done when it fades.
      onAnimationEnd={(e) => e.pseudoElement && setArrived(false)}
      onClick={src ? undefined : choose}
      {...drop}
    >
      <Avatar key={src ?? 'initial'} size="xl" name={name} src={src} className={styles.avatar} />
      <span className={styles.lens} aria-hidden>
        <Camera />
      </span>
      <span className={styles.badge} aria-hidden>
        <Camera />
      </span>
    </button>
  );

  return (
    <>
      {src ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>{face}</DropdownMenu.Trigger>
          <DropdownMenu.Content align="start">
            <DropdownMenu.Item icon={<ImageUp />} onSelect={choose}>
              Choose a new photo
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item icon={<Trash2 />} tone="danger" onSelect={() => void remove()}>
              Remove photo
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      ) : (
        face
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        tabIndex={-1}
        aria-label="Choose a photo"
        onChange={(e) => {
          void open(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Dialog.Root open={!!picked} onOpenChange={(next) => !next && close()}>
        {picked && (
          <Framer
            picked={picked}
            onSave={async (photo) => {
              await onSave(photo);
              close();
              setArrived(true);
            }}
          />
        )}
      </Dialog.Root>
    </>
  );
}

/** The photo in a square, a circle marked out on it: drag it, zoom it, keep it. */
function Framer({ picked, onSave }: { picked: Picked; onSave: (photo: Blob) => Promise<void> }) {
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

  // From the keyboard, the photo moves along two quiet sliders inside the stage.
  const base = baseSize(picked);
  const room = { x: (base.w * frame.zoom - 1) / 2, y: (base.h * frame.zoom - 1) / 2 };
  const where = (offset: number, side: number, [less, more]: [string, string]) =>
    Math.abs(offset) < 0.005 || side < 0.005
      ? 'In the middle'
      : `${Math.round((Math.abs(offset) / side) * 100)}% ${offset < 0 ? less : more}`;

  const save = async () => {
    setSaving(true);
    setProblem(undefined);
    try {
      await onSave(await draw(picked, frame));
    } catch (error) {
      setProblem((error as Error).message || 'Your photo couldn’t be kept just now.');
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
        <Dialog.Title>Frame your photo</Dialog.Title>
        <Dialog.Description>
          Drag it to move it, and zoom until it looks like you.
        </Dialog.Description>
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
          <span className={styles.circle} aria-hidden />
          <input
            type="range"
            className={styles.axis}
            aria-label="Move your photo left or right"
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
            aria-label="Move your photo up or down"
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
          Use this photo
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}

/** The framed square, drawn out at `PHOTO_SIZE`. */
async function draw(picked: Picked, frame: Frame): Promise<Blob> {
  const crop = cropOf(picked, frame);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PHOTO_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser couldn’t frame the photo.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    picked.image,
    crop.x,
    crop.y,
    crop.size,
    crop.size,
    0,
    0,
    PHOTO_SIZE,
    PHOTO_SIZE,
  );
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', 0.9));
  if (!blob) throw new Error('This browser couldn’t frame the photo.');
  return blob;
}
