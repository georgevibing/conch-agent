import { ChevronLeft, ChevronRight, File, FileText, TextCursorInput } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Skeleton } from '../../components/Skeleton';
import { cx } from '../../utils/cx';
import { CodeBlock } from '../CodeBlock';
import styles from './Attachments.module.css';
import {
  type AttachmentInfo,
  badgeOf,
  extensionOf,
  familyOf,
  formatBytes,
  languageOf,
  metaOf,
  parseDelimited,
  previewModeOf,
} from './fileType';
import { META_SEP } from '../../components/MetaList';

export interface AttachmentPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What's shown; nothing renders without it. */
  attachment?: AttachmentInfo;
  /** Where an image, PDF, audio or video file can be loaded from. */
  src?: string;
  /** The text of a text attachment. Undefined while it loads. */
  text?: string;
  loading?: boolean;
  /** Why it couldn't be shown. */
  error?: string;
  /** Where to download the original. */
  downloadHref?: string;
  /** Makes the text editable (a paste that hasn't been sent yet). */
  onTextChange?: (text: string) => void;
  /** Put the text into the message itself instead of attaching it. */
  onInsert?: () => void;
  /** Where this one is among the message's attachments, for ← and →. */
  position?: { index: number; count: number };
  onNavigate?: (delta: -1 | 1) => void;
}

/** Highlighting a huge file would freeze the tab; past this it's shown as plain text. */
const HIGHLIGHT_MAX = 80_000;
/** Table previews show the first rows; the rest are counted. */
const TABLE_ROWS = 500;
const count = new Intl.NumberFormat();

function Table({ text, delimiter }: { text: string; delimiter: string }) {
  const rows = useMemo(() => parseDelimited(text, delimiter, TABLE_ROWS + 1), [text, delimiter]);
  const [head = [], ...body] = rows;
  const shown = body.slice(0, TABLE_ROWS - 1);
  return (
    <div
      className={styles.tableWrap}
      // Scrollable regions must be keyboard-focusable (WCAG 2.1.1).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="region"
      aria-label="Table preview"
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.rowNumber}>
              <span className="nc-visually-hidden">Row</span>
            </th>
            {head.map((cell, i) => (
              <th key={i} scope="col" title={cell}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr key={r}>
              <td className={styles.rowNumber}>{r + 1}</td>
              {head.map((_, i) => (
                <td key={i} title={row[i]}>
                  {row[i]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A closer look at an attachment. Pictures fill the stage, PDFs open in the
 * browser's own viewer, CSVs become a table, code is highlighted, and a paste
 * that hasn't been sent can be edited in place — or put back into the
 * message as plain text. Anything else says what it is and offers the file.
 */
export function AttachmentPreview({
  open,
  onOpenChange,
  attachment,
  src,
  text,
  loading,
  error,
  downloadHref,
  onTextChange,
  onInsert,
  position,
  onNavigate,
}: AttachmentPreviewProps) {
  const [tableView, setTableView] = useState<'table' | 'text'>('table');
  const editorId = useId();
  const done = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  if (!attachment) return null;

  const mode = previewModeOf(attachment);
  const family = familyOf(attachment);
  const title = attachment.pasted ? 'Pasted text' : attachment.name;
  const liveLines = text === undefined ? undefined : text ? text.split('\n').length : 0;
  const meta = [
    attachment.pasted ? undefined : badgeOf(attachment),
    onTextChange && liveLines !== undefined
      ? `${count.format(liveLines)} lines · ${count.format(text?.length ?? 0)} characters`
      : metaOf(attachment),
    attachment.size !== undefined && attachment.kind !== 'file' && !onTextChange
      ? formatBytes(attachment.size)
      : undefined,
  ]
    .filter(Boolean)
    .join(META_SEP);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onNavigate || !position || position.count < 2) return;
    const target = event.target as HTMLElement;
    if (target.closest('textarea, input, [role="region"], [role="radiogroup"], [role="group"]'))
      return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onNavigate(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onNavigate(1);
    }
  };

  let body;
  if (error) {
    body = (
      <div className={styles.nothing} role="alert">
        <span className={styles.bigGlyph} aria-hidden>
          <File />
        </span>
        <span>{error}</span>
      </div>
    );
  } else if (mode === 'image') {
    body = (
      <div className={styles.stage}>
        {src ? (
          <img src={src} alt={title} />
        ) : (
          <Skeleton style={{ inlineSize: '100%', blockSize: '20rem' }} />
        )}
      </div>
    );
  } else if (mode === 'pdf' && src) {
    body = <iframe className={styles.frame} src={src} title={title} />;
  } else if (mode === 'audio' && src) {
    body = (
      <div className={styles.stage}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the person's own recording */}
        <audio controls src={src} />
      </div>
    );
  } else if (mode === 'video' && src) {
    body = (
      <div className={styles.stage}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the person's own video */}
        <video controls src={src} />
      </div>
    );
  } else if (mode === 'none') {
    body = (
      <div className={styles.nothing}>
        <span className={cx(styles.bigGlyph)} aria-hidden>
          {family === 'doc' ? <FileText /> : <File />}
        </span>
        <span>There’s no preview for this kind of file, but it’s attached as it is.</span>
      </div>
    );
  } else if (loading || text === undefined) {
    body = <Skeleton style={{ inlineSize: '100%', blockSize: '20rem' }} />;
  } else if (onTextChange) {
    body = (
      <>
        <label htmlFor={editorId} className="nc-visually-hidden">
          {title}
        </label>
        <textarea
          ref={editor}
          id={editorId}
          className={styles.editor}
          value={text}
          spellCheck={false}
          onChange={(event) => onTextChange(event.target.value)}
        />
      </>
    );
  } else if (mode === 'table') {
    const delimiter = extensionOf(attachment.name) === 'tsv' ? '\t' : ',';
    body = (
      <>
        <div className={styles.toolbar}>
          <span>
            {attachment.lines !== undefined && attachment.lines > TABLE_ROWS
              ? `First ${count.format(TABLE_ROWS - 1)} of ${count.format(attachment.lines - 1)} rows`
              : ''}
          </span>
          <SegmentedControl
            size="sm"
            value={tableView}
            onValueChange={(v) => setTableView(v as 'table' | 'text')}
            aria-label="Show as"
          >
            <SegmentedControl.Item value="table">Table</SegmentedControl.Item>
            <SegmentedControl.Item value="text">Text</SegmentedControl.Item>
          </SegmentedControl>
        </div>
        {tableView === 'table' ? (
          <Table text={text} delimiter={delimiter} />
        ) : (
          <pre
            className={styles.raw}
            // Scrollable regions must be keyboard-focusable (WCAG 2.1.1).
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            role="region"
            aria-label={title}
          >
            {text}
          </pre>
        )}
      </>
    );
  } else if (mode === 'code' && text.length <= HIGHLIGHT_MAX) {
    body = (
      <div className={styles.code}>
        <CodeBlock
          code={text}
          language={languageOf(attachment.name)}
          filename={attachment.name}
          lineNumbers
        />
      </div>
    );
  } else {
    body = (
      <pre
        className={styles.raw}
        // Scrollable regions must be keyboard-focusable (WCAG 2.1.1).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="region"
        aria-label={title}
      >
        {text}
      </pre>
    );
  }

  const many = position && position.count > 1;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        size="xl"
        className={styles.preview}
        onKeyDown={onKeyDown}
        // Start in the text when it can be edited, otherwise on Done — never on
        // ← (whose tooltip would take the first Escape).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (editor.current ?? done.current)?.focus();
        }}
      >
        <div className={styles.previewHead}>
          <div className={styles.previewTitle}>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description className={styles.previewMeta}>
              {meta || (attachment.pasted ? 'Pasted text' : 'Attachment')}
            </Dialog.Description>
          </div>
        </div>
        <div className={styles.previewBody}>{body}</div>
        <div className={styles.previewFoot}>
          {many && (
            <>
              <IconButton
                size="sm"
                label="Previous attachment"
                shortcut="left"
                onClick={() => onNavigate?.(-1)}
              >
                <ChevronLeft />
              </IconButton>
              <span className={styles.counter}>
                {position.index} of {position.count}
              </span>
              <IconButton
                size="sm"
                label="Next attachment"
                shortcut="right"
                onClick={() => onNavigate?.(1)}
              >
                <ChevronRight />
              </IconButton>
            </>
          )}
          <span className={styles.spacer} />
          {downloadHref && (
            <Button asChild variant="ghost" size="sm">
              <a href={downloadHref} download={attachment.name}>
                Download
              </a>
            </Button>
          )}
          {onInsert && (
            <Button
              variant="surface"
              size="sm"
              leadingIcon={<TextCursorInput />}
              onClick={onInsert}
            >
              Paste into message
            </Button>
          )}
          <Dialog.Close asChild>
            <Button ref={done} variant="solid" size="sm">
              Done
            </Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
