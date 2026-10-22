import { ChevronLeft, ChevronRight, ExternalLink, File, TextCursorInput } from 'lucide-react';
import { Fragment, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Skeleton } from '../../components/Skeleton';
import { CodeBlock } from '../CodeBlock';
import styles from './Attachments.module.css';
import { AttachmentViewBody, GridTable } from './AttachmentViewBody';
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
  typeWordOf,
} from './fileType';
import { GLYPHS } from './glyphs';
import { notebookView, type AttachmentViewData } from './view';
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
  /**
   * What the gateway's readers made of a file the browser can't show itself
   * (`GET /api/attachments/:id/view`): its words, sheets, folders, an email,
   * a recording's words. `null`: nothing could read it.
   */
  view?: AttachmentViewData | null;
  /** The view is on its way. */
  viewLoading?: boolean;
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

function Table({ text, delimiter, label }: { text: string; delimiter: string; label: string }) {
  const rows = useMemo(() => parseDelimited(text, delimiter, TABLE_ROWS + 1), [text, delimiter]);
  const [head = [], ...body] = rows;
  return <GridTable head={head} rows={body.slice(0, TABLE_ROWS - 1)} label={label} />;
}

/** What a file is, when there's nothing more to show of it: its glyph, its kind, its facts. */
function WhatItIs({
  attachment,
  summary,
  known,
}: {
  attachment: AttachmentInfo;
  summary?: string;
  /** What a reader found out about it (its kind, what it was built for), in place of ours. */
  known?: { label: string; value: string }[];
}) {
  const family = familyOf(attachment);
  const Glyph = GLYPHS[family];
  const facts = [
    { label: 'Kind', value: typeWordOf(attachment) },
    attachment.size !== undefined && { label: 'Size', value: formatBytes(attachment.size) },
    attachment.mimeType &&
      attachment.mimeType !== 'application/octet-stream' && {
        label: 'Type',
        value: attachment.mimeType,
      },
  ].filter((f): f is { label: string; value: string } => Boolean(f));
  const shown = known?.length ? known : facts;
  return (
    <div className={styles.nothing}>
      <span className={styles.bigGlyph} data-family={family} aria-hidden>
        <Glyph />
      </span>
      {summary && <span className={styles.whatSummary}>{summary}</span>}
      <dl className={styles.whatFacts}>
        {shown.map((f) => (
          <Fragment key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </Fragment>
        ))}
      </dl>
      <span>
        {summary
          ? 'It’s attached as it is. Download it to open it in its own app.'
          : 'There’s no preview for this kind of file, but it’s attached as it is.'}
      </span>
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
  view,
  viewLoading,
  onTextChange,
  onInsert,
  position,
  onNavigate,
}: AttachmentPreviewProps) {
  const [tableView, setTableView] = useState<'table' | 'text'>('table');
  const editorId = useId();
  const done = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const player = useRef<HTMLMediaElement | null>(null);
  const mode = attachment ? previewModeOf(attachment) : 'none';
  const notebook = useMemo(
    () => (mode === 'notebook' && text !== undefined ? notebookView(text) : undefined),
    [mode, text],
  );
  if (!attachment) return null;

  const title = attachment.pasted ? 'Pasted text' : attachment.name;
  const liveLines = text === undefined ? undefined : text ? text.split('\n').length : 0;
  const word = typeWordOf(attachment);
  const badge = badgeOf(attachment);
  const meta = [
    attachment.pasted ? undefined : badge,
    attachment.pasted || word.toUpperCase() === badge.toUpperCase() ? undefined : word,
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
  } else if ((mode === 'audio' || mode === 'video') && src) {
    const seek = (seconds: number) => {
      const media = player.current;
      if (!media) return;
      media.currentTime = seconds;
      void media.play().catch(() => {});
    };
    const keep = (el: HTMLMediaElement | null) => {
      player.current = el;
    };
    const said = view && view.parts.length > 0;
    body = (
      <>
        <div className={styles.stage} data-media={mode}>
          {mode === 'audio' ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- its words are drawn below, when heard
            <audio ref={keep} controls src={src} />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- its words are drawn below, when heard
            <video ref={keep} controls playsInline src={src} />
          )}
        </div>
        {said ? (
          <AttachmentViewBody view={view} name={title} under onSeek={seek} />
        ) : viewLoading ? (
          <p className={styles.viewSummary} role="status">
            Listening for what’s said in it…
          </p>
        ) : view?.summary ? (
          <p className={styles.viewSummary}>{view.summary}</p>
        ) : null}
      </>
    );
  } else if (mode === 'view' && view && (view.parts.length > 0 || view.summary)) {
    // Only facts (a program, a font): the same calm panel as a file nothing reads, with them.
    const onlyFacts = view.parts.every((p) => p.kind === 'facts');
    body = onlyFacts ? (
      <WhatItIs
        attachment={attachment}
        summary={view.summary}
        known={view.parts.flatMap((p) => (p.kind === 'facts' ? p.facts : []))}
      />
    ) : (
      <AttachmentViewBody view={view} name={title} />
    );
  } else if (mode === 'view' && viewLoading) {
    body = <Skeleton style={{ inlineSize: '100%', blockSize: '20rem' }} />;
  } else if (mode === 'none' || (mode === 'view' && attachment.kind !== 'text')) {
    body = <WhatItIs attachment={attachment} />;
  } else if (mode === 'notebook' && notebook) {
    body = <AttachmentViewBody view={notebook} name={title} />;
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
          <Table text={text} delimiter={delimiter} label="Table preview" />
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
          {/* A phone's browser shows a framed PDF's first page at most; its own viewer shows all. */}
          {mode === 'pdf' && src && !error && (
            <Button asChild variant="ghost" size="sm" leadingIcon={<ExternalLink />}>
              <a href={src} target="_blank" rel="noopener noreferrer">
                Open
              </a>
            </Button>
          )}
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
