import {
  AlertCircle,
  Archive,
  AudioLines,
  Braces,
  ClipboardPaste,
  Clapperboard,
  File,
  FileCode2,
  FileX2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Presentation,
  RotateCcw,
  Sheet,
  X,
} from 'lucide-react';
import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';

import { IconButton } from '../../components/IconButton';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../utils/cx';
import styles from './Attachments.module.css';
import { type AttachmentInfo, badgeOf, familyOf, type FileFamily, metaOf } from './fileType';

/**
 * `lost`: it was on a message kept from before (a draft) and is no longer on
 * this computer. The card says so in words and offers only to take it off.
 */
export type AttachmentStatus = 'uploading' | 'ready' | 'error' | 'lost';

export interface AttachmentCardProps
  extends AttachmentInfo, Omit<ComponentProps<'div'>, 'children' | keyof AttachmentInfo> {
  /** The first lines of a text attachment, shown on the card. */
  excerpt?: string;
  /** Thumbnail for images (an object URL while drafting, the served file once sent). */
  src?: string;
  status?: AttachmentStatus;
  /** Upload progress, 0–1. Without it an uploading card just spins. */
  progress?: number;
  /** Why it failed, in a few words (for `lost`, what to do instead). */
  error?: string;
  /** A quiet caveat, e.g. that the chosen model can't see images. */
  note?: string;
  /** Open the preview. */
  onOpen?: () => void;
  /** Take it off the message. Shows the corner ×, and Delete/Backspace on the card. */
  onRemove?: () => void;
  onRetry?: () => void;
  /**
   * `compact` in the composer: every card the same small size. `comfortable`
   * in the transcript: images grow to show what was sent.
   */
  density?: 'compact' | 'comfortable';
}

const GLYPHS: Record<FileFamily, typeof File> = {
  pasted: ClipboardPaste,
  text: FileText,
  code: FileCode2,
  data: Braces,
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  archive: Archive,
  image: ImageIcon,
  audio: AudioLines,
  video: Clapperboard,
  file: File,
};

/** Moves focus to a neighbouring card (or out) before this one disappears. */
function focusNeighbour(from: HTMLElement) {
  const item = from.closest('[role="listitem"]');
  const next = (
    item?.nextElementSibling ?? item?.previousElementSibling
  )?.querySelector<HTMLElement>(`.${styles.open}`);
  next?.focus();
}

/**
 * One attachment on a message: a long paste, a picture, a file. Every kind
 * has a card that says what it is at a glance — the first lines of a paste in
 * type, a thumbnail for a picture, a tinted badge for a PDF or a spreadsheet —
 * and opens a preview on click. While it uploads it breathes; if it fails it
 * says so and offers to try again.
 */
export function AttachmentCard({
  name,
  kind,
  mimeType,
  size,
  lines,
  pasted,
  width,
  height,
  excerpt,
  src,
  status = 'ready',
  progress,
  error,
  note,
  onOpen,
  onRemove,
  onRetry,
  density = 'compact',
  className,
  style,
  ...props
}: AttachmentCardProps) {
  const info: AttachmentInfo = { name, kind, mimeType, size, lines, pasted, width, height };
  const family = familyOf(info);
  const Glyph = family === 'sheet' && kind === 'text' ? Sheet : GLYPHS[family];
  const meta = metaOf(info);
  const badge = badgeOf(info);
  const shownName = pasted ? 'Pasted text' : name;
  const photo = kind === 'image' && src;
  const aspect = photo && width && height ? width / height : undefined;
  const lost = status === 'lost';

  const label = [
    shownName,
    pasted ? undefined : badge,
    meta,
    status === 'uploading' ? 'uploading' : undefined,
    status === 'error' ? (error ?? 'upload failed') : undefined,
    lost ? 'no longer here' : undefined,
    lost ? error : undefined,
    note,
  ]
    .filter(Boolean)
    .join(', ');

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!onRemove || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
    event.preventDefault();
    focusNeighbour(event.currentTarget);
    onRemove();
  };

  let face: ReactNode;
  if (lost) {
    // Its picture or its words are gone with it: only what it was is left to show.
    face = (
      <>
        <span className={styles.head}>
          <span className={styles.glyph} aria-hidden>
            <Glyph />
          </span>
          <span className={styles.name} data-clamp="2">
            {shownName}
          </span>
        </span>
        <span className={styles.lostLine} aria-hidden>
          <FileX2 />
          No longer here
        </span>
      </>
    );
  } else if (photo) {
    face = <img className={styles.photo} src={src} alt="" draggable={false} decoding="async" />;
  } else if (kind === 'text' && excerpt !== undefined) {
    face = (
      <>
        {!pasted && <span className={styles.name}>{name}</span>}
        <span className={styles.excerpt} data-lines={pasted ? 4 : 2} aria-hidden>
          {excerpt.slice(0, 400)}
        </span>
        <span className={styles.foot}>
          <span className={styles.badge}>{badge}</span>
          {meta && <span className={styles.meta}>{meta}</span>}
        </span>
      </>
    );
  } else {
    face = (
      <>
        <span className={styles.head}>
          <span className={styles.glyph} aria-hidden>
            <Glyph />
          </span>
          <span className={styles.name} data-clamp="2">
            {shownName}
          </span>
        </span>
        <span className={styles.foot}>
          <span className={styles.badge}>{badge}</span>
          {meta && <span className={styles.meta}>{meta}</span>}
        </span>
      </>
    );
  }

  const openButton = (
    <button
      type="button"
      className={styles.open}
      aria-label={label}
      data-lustre=""
      onClick={onOpen}
      onKeyDown={onKeyDown}
      disabled={!onOpen && !onRemove}
    >
      {face}
      {status === 'uploading' && (
        <span className={styles.progress} aria-hidden>
          <svg viewBox="0 0 24 24" data-indeterminate={progress === undefined || undefined}>
            <circle cx="12" cy="12" r="9" className={styles.track} />
            <circle
              cx="12"
              cy="12"
              r="9"
              pathLength={100}
              className={styles.value}
              strokeDasharray={`${Math.round((progress ?? 0.3) * 100)} 100`}
            />
          </svg>
        </span>
      )}
      {status === 'error' && (
        <span className={styles.failed} aria-hidden>
          <AlertCircle />
        </span>
      )}
      {note && status !== 'error' && !lost && <span className={styles.noteDot} aria-hidden />}
    </button>
  );

  return (
    <div
      role="listitem"
      data-kind={kind}
      data-family={family}
      data-status={status}
      data-density={density}
      data-photo={photo && !lost ? '' : undefined}
      data-note={note ? '' : undefined}
      className={cx(styles.card, className)}
      style={
        aspect
          ? ({ ...style, '--att-aspect': Math.min(Math.max(aspect, 0.5), 2.4) } as typeof style)
          : style
      }
      {...props}
    >
      <Tooltip content={status === 'error' || lost ? error : note}>{openButton}</Tooltip>
      {status === 'error' && onRetry && (
        <IconButton
          size="sm"
          shape="circle"
          variant="surface"
          label={`Try uploading ${shownName} again`}
          className={styles.retry}
          onClick={onRetry}
        >
          <RotateCcw />
        </IconButton>
      )}
      {onRemove && (
        <IconButton
          size="sm"
          shape="circle"
          variant="surface"
          label={`Remove ${shownName}`}
          tooltip={false}
          className={styles.remove}
          onClick={(event) => {
            focusNeighbour(event.currentTarget);
            onRemove();
          }}
        >
          <X />
        </IconButton>
      )}
    </div>
  );
}

export interface AttachmentListProps extends ComponentProps<'div'> {
  /** Accessible name for the list. */
  label?: string;
  /** `end` lines the cards up at the end, as they sit above your own message. */
  align?: 'start' | 'end';
}

/** A wrapping row of attachment cards. */
export function AttachmentList({
  label = 'Attachments',
  align = 'start',
  className,
  ...props
}: AttachmentListProps) {
  return (
    <div
      role="list"
      aria-label={label}
      data-align={align}
      className={cx(styles.list, className)}
      {...props}
    />
  );
}
