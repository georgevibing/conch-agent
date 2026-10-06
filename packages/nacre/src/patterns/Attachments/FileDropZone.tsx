import { AlertCircle, CheckCircle2, FileUp, X } from 'lucide-react';
import { useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import styles from './FileDropZone.module.css';
import { useFileDrop } from './DropOverlay';

export type FileDropState = 'idle' | 'checking' | 'ok' | 'error';

export interface FileDropZoneProps extends Omit<
  ComponentProps<'div'>,
  'title' | 'onChange' | 'onDrop'
> {
  /** What to give it, in a few words: “Drop the file Google gave you”. */
  title: ReactNode;
  /** A line under the title: where the file usually is. */
  hint?: ReactNode;
  /** File types the picker offers (`.json,application/json`). */
  accept?: string;
  /** One file arrived, dropped or chosen. */
  onFile: (file: File) => void;
  /** The picker's button. */
  chooseLabel?: string;
  disabled?: boolean;
  /** What happened to the file that arrived. */
  state?: FileDropState;
  /** The name of the file that arrived. */
  fileName?: string;
  /** One line about it: what it is and that it's ready, or what's wrong with it. */
  message?: ReactNode;
  /** Forget the file that arrived (shows a small ✕ beside its name). */
  onClear?: () => void;
  /**
   * A second way in, for when there's no file to hand (it was opened on
   * another computer): what the link says, and what it shows when pressed.
   */
  paste?: { label: string; content: ReactNode };
}

/**
 * A place to drop one file, or choose it, or paste what's in it: the way a
 * settings page asks for a file a person downloaded somewhere else (a
 * credential, a key). The whole area takes a drop and lights up while a file
 * is over it; the one button opens the picker, so it works the same by
 * keyboard. What landed is said in words beside an icon, never by colour
 * alone, and is announced.
 */
export function FileDropZone({
  title,
  hint,
  accept,
  onFile,
  chooseLabel = 'Choose file',
  disabled = false,
  state = 'idle',
  fileName,
  message,
  onClear,
  paste,
  className,
  ...props
}: FileDropZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const hintId = useId();
  const messageId = useId();
  const [pasting, setPasting] = useState(false);
  const { dragging, props: drop } = useFileDrop({
    disabled,
    onDrop: ({ files }) => {
      const [file] = files;
      if (file) onFile(file);
    },
  });
  const landed = state !== 'idle' && (fileName || message);
  return (
    <div className={cx(styles.root, className)} {...props}>
      <div
        role="group"
        aria-labelledby={titleId}
        aria-describedby={
          [hint && hintId, landed && messageId].filter(Boolean).join(' ') || undefined
        }
        data-lustre=""
        data-dragging={dragging || undefined}
        data-state={state}
        data-disabled={disabled || undefined}
        className={styles.zone}
        {...drop}
      >
        <span className={styles.icon} aria-hidden>
          {state === 'checking' ? (
            <Spinner size="sm" />
          ) : state === 'ok' ? (
            <CheckCircle2 />
          ) : state === 'error' ? (
            <AlertCircle />
          ) : (
            <FileUp />
          )}
        </span>
        <span id={titleId} className={styles.title}>
          {dragging ? 'Let go to use this file' : title}
        </span>
        {hint && (
          <span id={hintId} className={styles.hint}>
            {hint}
          </span>
        )}
        <Button
          size="sm"
          variant={state === 'ok' ? 'ghost' : 'surface'}
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {state === 'ok' || state === 'error' ? 'Choose another file' : chooseLabel}
        </Button>
        <input
          ref={input}
          type="file"
          accept={accept}
          tabIndex={-1}
          aria-hidden
          className={styles.input}
          disabled={disabled}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            // The same file chosen twice still arrives twice.
            event.currentTarget.value = '';
            if (file) onFile(file);
          }}
        />
      </div>
      <div role="status" aria-live="polite" className={styles.result} data-state={state}>
        {landed && (
          <>
            {fileName && (
              <span className={styles.file}>
                <span className={styles.fileName}>{fileName}</span>
                {onClear && (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Forget ${fileName}`}
                    onClick={onClear}
                  >
                    <X />
                  </IconButton>
                )}
              </span>
            )}
            {message && (
              <span id={messageId} className={styles.message}>
                {message}
              </span>
            )}
          </>
        )}
      </div>
      {paste &&
        (pasting ? (
          <div className={styles.paste}>{paste.content}</div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className={styles.pasteToggle}
            disabled={disabled}
            onClick={() => setPasting(true)}
          >
            {paste.label}
          </Button>
        ))}
    </div>
  );
}
