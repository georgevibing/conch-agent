import { Camera, ImageUp, Trash2 } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';

import { Avatar } from '../../components/Avatar';
import { DropdownMenu } from '../../components/DropdownMenu';
import { toast } from '../../components/Toast';
import { cx } from '../../utils/cx';
import { AvatarCropper, closePicture, openPicture, type OpenedPicture } from './AvatarCropper';
import styles from './AvatarPicker.module.css';

/** What a picture may be chosen from. */
export const PICTURE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

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

/**
 * Your photo, as you'd change it on a phone: press your initial (or drop a
 * picture on it), frame it in a circle, and it's there. Once there's a photo,
 * the same press offers a new one or taking it away.
 */
export function AvatarPicker({ name, src, onSave, onRemove, className }: AvatarPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<OpenedPicture>();
  const [over, setOver] = useState(false);
  const [arrived, setArrived] = useState(false);
  const choose = () => input.current?.click();

  const open = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPicked(await openPicture(file));
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const close = () => {
    closePicture(picked);
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
        accept={PICTURE_ACCEPT}
        hidden
        tabIndex={-1}
        aria-label="Choose a photo"
        onChange={(e) => {
          void open(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <AvatarCropper
        picture={picked}
        onClose={close}
        onSave={async (photo) => {
          await onSave(photo);
          close();
          setArrived(true);
        }}
      />
    </>
  );
}
