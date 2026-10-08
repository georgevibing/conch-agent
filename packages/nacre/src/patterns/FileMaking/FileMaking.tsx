import {
  AppWindow,
  Check,
  Download,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  FileType as FileTypeGlyph,
  FileVideo,
  FileX,
  Info,
  Link2,
  Maximize2,
  Presentation,
  Send,
  Sheet,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { Button } from '../../components/Button';
import { Collapsible } from '../../components/Collapsible';
import { IconButton } from '../../components/IconButton';
import iconButton from '../../components/IconButton/IconButton.module.css';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../utils/cx';
import { extensionOf, parseDelimited } from '../Attachments/fileType';
import styles from './FileMaking.module.css';
import {
  badgeFor,
  fileMeta,
  fileTypeOf,
  htmlGist,
  markdownLines,
  SHAPE,
  TYPE_WORDS,
  type FileShape,
  type FileType,
} from './fileKind';

export type FileMakingState = 'making' | 'ready' | 'failed' | 'declined' | 'stopped';
export type FileMakingStage = 'queued' | 'generating' | 'finishing';

export interface FileMakingDetail {
  label: string;
  value: ReactNode;
}

/** The facts of a file every file surface shows. */
export interface FileFacts {
  /** Its name, with its extension (“Q3 report.pdf”). */
  name: string;
  mimeType?: string;
  /** How the gateway treats it (`text`, `image`, `file`). */
  kind?: 'text' | 'image' | 'file';
  /** Bytes. */
  size?: number;
  pages?: number;
  sheets?: number;
  slides?: number;
  /** Lines, for text. */
  lines?: number;
  /** Files inside, for an archive. */
  files?: number;
  /** A small picture of it (a PDF’s first page, a slide, a chart). */
  thumbnail?: string;
  /** Its first words, for text, Markdown, CSV, code or a web page: drawn as a small page. */
  excerpt?: string;
}

export interface FileMakingProps
  extends FileFacts, Omit<ComponentProps<'figure'>, 'title' | 'children' | keyof FileFacts> {
  state: FileMakingState;
  /** How far it got, 0–1. Absent: it can’t say, so the wait has no number. */
  progress?: number;
  /** Where it is: waiting its turn, being made, or being kept. */
  stage?: FileMakingStage;
  /** The step it’s on, in a few words (“Laying out pages”, “Page 2 of 5”). */
  detail?: string;
  /** What it’s doing, as a verb (“Converting”, “Combining”). Defaults to “Making it”. */
  doing?: string;
  /** What is making it, in a few words (“Chromium”). */
  by?: string;
  /** It asked first and waits for your answer: the light holds still. */
  waiting?: boolean;
  /** Its own picture, in place of the drawn one (a PDF’s first page in a frame). */
  face?: ReactNode;
  /** Why it couldn’t be made, in plain words. */
  reason?: string;
  /** Not made, in other words than the state’s own (“Not made: no answer in time”). */
  notMade?: string;
  /** What was asked for, in full: the first line of Details. */
  prompt?: string;
  /** The rest of Details: who made it, when, how long it took. Never file paths. */
  details?: FileMakingDetail[];
  /** Look closer (the preview). */
  onOpen?: () => void;
  downloadHref?: string;
  /** The name a download is saved as. Defaults to `name`. */
  downloadName?: string;
  /** Copy a link to it, where it has one. */
  onCopyLink?: () => Promise<void> | void;
  /** Send it somewhere else (a chat app). */
  onSend?: () => void;
  /** The send button’s name. */
  sendLabel?: string;
}

const GLYPHS: Record<FileType, typeof File> = {
  pdf: FileText,
  doc: FileTypeGlyph,
  sheet: FileSpreadsheet,
  slides: Presentation,
  csv: Sheet,
  markdown: FilePenLine,
  html: AppWindow,
  archive: FileArchive,
  code: FileCode2,
  data: FileJson,
  text: FileText,
  image: FileImage,
  audio: FileAudio,
  video: FileVideo,
  file: File,
};

/** How long the finished file takes to come out of the light (matches `--fm-develop`). */
const DEVELOP_MS = 900;

const stageWords = (stage: FileMakingStage | undefined, doing: string) =>
  stage === 'queued' ? 'Waiting its turn' : stage === 'finishing' ? 'Finishing' : doing;

/** A small ring that fills: or, with no number, a short arc going round. */
function Ring({ value }: { value: number | undefined }) {
  return (
    <svg
      className={styles.ring}
      viewBox="0 0 20 20"
      aria-hidden
      data-indeterminate={value === undefined || undefined}
    >
      <circle className={styles.ringTrack} cx="10" cy="10" r="8" pathLength="100" />
      <circle
        className={styles.ringFill}
        cx="10"
        cy="10"
        r="8"
        pathLength="100"
        style={{ '--fm-ring': value === undefined ? 28 : Math.round(value * 100) } as CSSProperties}
      />
    </svg>
  );
}

function Meter({
  name,
  progress,
  stage,
  detail,
  doing,
}: {
  name: string;
  progress?: number;
  stage?: FileMakingStage;
  detail?: string;
  doing: string;
}) {
  const known = progress !== undefined && Number.isFinite(progress) && stage !== 'queued';
  const value = known ? Math.min(0.99, Math.max(0, progress)) : undefined;
  const pct = value === undefined ? undefined : Math.round(value * 100);
  const words = stageWords(stage, doing);
  const said = detail ?? (pct === undefined ? undefined : stage === 'finishing' ? 'finishing' : '');
  return (
    <div
      className={styles.meter}
      role="progressbar"
      aria-label={`Making ${name}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={
        pct === undefined
          ? [`${words}…`, detail].filter(Boolean).join(', ')
          : [`${pct}%`, said].filter(Boolean).join(', ')
      }
    >
      <Ring value={value} />
      {pct === undefined ? (
        <span className={styles.meterWords}>{words}…</span>
      ) : (
        <span className={styles.meterValue}>{pct}%</span>
      )}
      {said && <span className={styles.meterDetail}>{said}</span>}
    </div>
  );
}

/** Pearl light going round the frame’s edge, with a soft bloom outside it. */
function Halo() {
  return (
    <>
      <span className={styles.bloom} aria-hidden>
        <span className={styles.band}>
          <span className={styles.spin} />
        </span>
      </span>
      <span className={styles.rim} aria-hidden>
        <span className={styles.spin} />
      </span>
    </>
  );
}

/** A slow wash of pearl light behind the file, tinted by its type. */
function Backdrop() {
  return (
    <span className={styles.backdrop} aria-hidden>
      <span className={styles.blob} data-n="1" />
      <span className={styles.blob} data-n="2" />
      <span className={styles.blob} data-n="3" />
      <span className={styles.film} />
    </span>
  );
}

const PAGE_LINES = [92, 97, 88, 95, 64, 0, 90, 96, 82, 58];
const CODE_LINES: [number, number][] = [
  [0, 46],
  [1, 62],
  [2, 54],
  [2, 70],
  [1, 30],
  [0, 18],
  [0, 52],
  [1, 66],
  [1, 40],
];
const line = (i: number, extra?: Record<string, string | number>) =>
  ({ '--i': i, ...extra }) as CSSProperties;

/**
 * The file’s shape, drawn: a page whose lines are written in, a sheet whose
 * cells fill, slides stacking, papers going into a box. Still (`still`), it’s
 * the file’s cover when there’s no picture of it.
 */
function Silhouette({ shape, badge, still }: { shape: FileShape; badge: string; still: boolean }) {
  let body: ReactNode;
  switch (shape) {
    case 'grid':
      body = (
        <span className={styles.sheetCard}>
          <span className={styles.gridHead} />
          {Array.from({ length: 40 }, (_, n) => (
            <span
              key={n}
              className={styles.cell}
              style={line((n % 4) + Math.floor(n / 4), { '--c': n % 4 })}
            />
          ))}
        </span>
      );
      break;
    case 'slides':
      body = (
        <span className={styles.slides}>
          {[3, 2, 1].map((n) => (
            <span key={n} className={styles.slide} data-n={n}>
              <span className={styles.slideTitle} />
              {n === 1 && (
                <span className={styles.bars}>
                  {[0.5, 0.8, 0.62, 1].map((h, i) => (
                    <span key={i} className={styles.bar} style={line(i, { '--h': h })} />
                  ))}
                </span>
              )}
            </span>
          ))}
        </span>
      );
      break;
    case 'box':
      body = (
        <span className={styles.boxWrap}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={styles.leaf} data-n={n} />
          ))}
          <span className={styles.box}>
            <span className={styles.boxLid} />
          </span>
        </span>
      );
      break;
    case 'window':
      body = (
        <span className={styles.window}>
          <span className={styles.windowBar}>
            <span />
            <span />
            <span />
          </span>
          <span className={styles.hero} style={line(0)} />
          <span className={styles.blocks}>
            {[1, 2, 3].map((n) => (
              <span key={n} className={styles.block} style={line(n)} />
            ))}
          </span>
          <span className={styles.line} style={line(4, { '--w': '86%' })} />
          <span className={styles.line} style={line(5, { '--w': '64%' })} />
        </span>
      );
      break;
    case 'code':
      body = (
        <span className={cx(styles.paper, styles.codePaper)}>
          {CODE_LINES.map(([indent, w], i) => (
            <span
              key={i}
              className={styles.line}
              data-tone={i % 3}
              style={line(i, { '--w': `${w}%`, '--indent': indent })}
            />
          ))}
        </span>
      );
      break;
    case 'wave':
      body = (
        <span className={styles.wave}>
          {Array.from({ length: 18 }, (_, i) => (
            <span
              key={i}
              className={styles.waveBar}
              style={line(i, { '--h': 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7)) })}
            />
          ))}
        </span>
      );
      break;
    case 'film':
      body = (
        <span className={styles.film2}>
          <span className={styles.sun} />
          <span className={styles.hill} data-n="1" />
          <span className={styles.hill} data-n="2" />
        </span>
      );
      break;
    default:
      body = (
        <span className={styles.paper}>
          <span className={styles.heading} style={line(0)} />
          {PAGE_LINES.map((w, i) =>
            w ? (
              <span key={i} className={styles.line} style={line(i + 1, { '--w': `${w}%` })} />
            ) : (
              <span key={i} className={styles.gap} />
            ),
          )}
        </span>
      );
  }
  return (
    <span
      className={styles.silhouette}
      data-shape={shape}
      data-still={still || undefined}
      aria-hidden
    >
      {body}
      {still && <span className={styles.coverBadge}>{badge}</span>}
    </span>
  );
}

/** A small, real picture of the file’s first words: a page, a table, a window. Decorative. */
function Excerpt({ type, text, name }: { type: FileType; text: string; name: string }) {
  const rows = useMemo(
    () =>
      type === 'csv'
        ? parseDelimited(text.slice(0, 8000), extensionOf(name) === 'tsv' ? '\t' : ',', 9)
        : [],
    [type, text, name],
  );
  if (type === 'csv' && rows.length) {
    const cols = Math.min(5, Math.max(...rows.map((r) => r.length)));
    return (
      <span className={cx(styles.face, styles.sheetCard, styles.real)} aria-hidden>
        <span className={styles.table} style={{ '--cols': cols } as CSSProperties}>
          {rows.slice(0, 9).map((row, r) =>
            Array.from({ length: cols }, (_, c) => (
              <span key={`${r}-${c}`} className={styles.td} data-head={r === 0 || undefined}>
                {row[c] ?? ''}
              </span>
            )),
          )}
        </span>
      </span>
    );
  }
  if (type === 'html') {
    const gist = htmlGist(text.slice(0, 20_000));
    return (
      <span className={cx(styles.face, styles.window, styles.real)} aria-hidden>
        <span className={styles.windowBar}>
          <span />
          <span />
          <span />
          {gist.title && <span className={styles.windowTitle}>{gist.title}</span>}
        </span>
        <span className={styles.realText}>
          {gist.lines.map((l, i) => (
            <span key={i} className={i === 0 ? styles.realH1 : styles.realP}>
              {l}
            </span>
          ))}
        </span>
      </span>
    );
  }
  if (type === 'code' || type === 'data') {
    return (
      <span className={cx(styles.face, styles.paper, styles.codePaper, styles.real)} aria-hidden>
        <span className={styles.realCode}>
          {text.slice(0, 1200).split('\n').slice(0, 14).join('\n')}
        </span>
      </span>
    );
  }
  const lines =
    type === 'markdown'
      ? markdownLines(text.slice(0, 6000))
      : text
          .slice(0, 3000)
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 12)
          .map((t) => ({ kind: 'p' as const, text: t }));
  return (
    <span className={cx(styles.face, styles.paper, styles.real)} aria-hidden>
      <span className={styles.realText}>
        {lines.map((l, i) => (
          <span
            key={i}
            className={
              l.kind === 'h1'
                ? styles.realH1
                : l.kind === 'h2'
                  ? styles.realH2
                  : l.kind === 'li'
                    ? styles.realLi
                    : l.kind === 'quote'
                      ? styles.realQuote
                      : styles.realP
            }
          >
            {l.text}
          </span>
        ))}
      </span>
    </span>
  );
}

/** Details, as a quiet panel under the card, its edges on the card’s. */
function DetailsPanel({
  id,
  open,
  onOpenChange,
  prompt,
  details,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt?: string;
  details?: FileMakingDetail[];
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={styles.details}>
      <Collapsible.Content id={id}>
        <div className={styles.detailsBody}>
          {prompt && (
            <p className={styles.prompt}>
              <span className={styles.promptLabel}>Asked for</span>
              {prompt}
            </p>
          )}
          {details && details.length > 0 && (
            <dl className={styles.detailList}>
              {details.map((d) => (
                <div key={d.label} className={styles.detail}>
                  <dt>{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </Collapsible.Content>
    </Collapsible>
  );
}

function DetailsButton({
  id,
  open,
  onOpenChange,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <IconButton
      size="sm"
      tone="neutral"
      label="Details"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      data-open={open || undefined}
      className={styles.detailsButton}
      onClick={() => onOpenChange(!open)}
    >
      <Info />
    </IconButton>
  );
}

/** Download as an icon button that is really a link (so it works without script). */
function DownloadLink({ href, name, label }: { href: string; name: string; label: string }) {
  return (
    <Tooltip content="Download">
      <Button
        asChild
        size="sm"
        variant="ghost"
        tone="neutral"
        className={iconButton.iconButton}
        leadingIcon={<Download />}
      >
        <a href={href} download={name} aria-label={`Download ${label}`} />
      </Button>
    </Tooltip>
  );
}

function CopyLink({ onCopyLink }: { onCopyLink: () => Promise<void> | void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <IconButton
      size="sm"
      tone="neutral"
      label={copied ? 'Copied' : 'Copy link'}
      onClick={async () => {
        try {
          await onCopyLink();
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error('Couldn’t copy the link here.');
        }
      }}
    >
      {copied ? <Check /> : <Link2 />}
    </IconButton>
  );
}

/** The type’s tile: its glyph, tinted. */
function TypeTile({ type, className }: { type: FileType; className?: string }) {
  const Glyph = GLYPHS[type];
  return (
    <span className={cx(styles.tile, className)} aria-hidden>
      <Glyph />
    </span>
  );
}

/**
 * A file being made, then the file. While it’s made, its shape draws itself
 * in pearl light (a page’s lines written in, a sheet’s cells filling, slides
 * stacking), with its name, its type and how far it got. When it’s ready the
 * picture of it rises out of the light, and it rests as a card: a picture of
 * the file (its first page, its first rows, its first words), its name, type,
 * size and pages, and what you can do with it. Not made is a calm line.
 */
export function FileMaking({
  state,
  name,
  mimeType,
  kind,
  size,
  pages,
  sheets,
  slides,
  lines,
  files,
  thumbnail,
  excerpt,
  progress,
  stage,
  detail,
  doing = 'Making it',
  by,
  waiting = false,
  face,
  reason,
  notMade,
  prompt,
  details,
  onOpen,
  downloadHref,
  downloadName,
  onCopyLink,
  onSend,
  sendLabel = 'Send to…',
  className,
  ...props
}: FileMakingProps) {
  // Only news is revealed: a file already there when this drew just shows.
  const [watched] = useState(state === 'making');
  const [settled, setSettled] = useState(false);
  // Which picture loaded, and which couldn't: a new picture starts again.
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const [brokenSrc, setBrokenSrc] = useState<string>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const picture = useRef<HTMLImageElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const metaId = `${id}-meta`;
  const detailsId = `${id}-details`;

  const type = fileTypeOf({ name, mimeType, kind });
  const shape = SHAPE[type];
  const badge = badgeFor(name, type);
  const meta = fileMeta({ badge, size, pages, sheets, slides, lines, files });

  const ready = state === 'ready';
  const thumb = ready && thumbnail && brokenSrc !== thumbnail ? thumbnail : undefined;
  // A picture waits until it has loaded; everything else is there at once.
  const shown = ready && (!thumb || loadedSrc === thumb);
  const developing = watched && shown && !settled;

  // A cached picture can finish loading before React listens.
  useEffect(() => {
    if (picture.current?.complete && picture.current.naturalWidth > 0) setLoadedSrc(thumb);
  }, [thumb]);

  useEffect(() => {
    if (!(watched && shown)) return;
    const timer = setTimeout(() => setSettled(true), DEVELOP_MS + 150);
    return () => clearTimeout(timer);
  }, [watched, shown]);

  const tint = { '--fm-h': `var(--fm-h-${type})` } as CSSProperties;

  if (state === 'failed' || state === 'declined' || state === 'stopped') {
    const words =
      notMade ??
      (state === 'declined'
        ? 'Not made: you said no'
        : state === 'stopped'
          ? 'Stopped before it was made'
          : `Couldn’t make it${reason ? `: ${reason}` : ''}`);
    const all =
      state === 'failed' && !notMade && reason && reason.length > 140
        ? [{ label: 'What went wrong', value: reason }, ...(details ?? [])]
        : details;
    const hasDetails = Boolean(prompt || all?.length);
    return (
      <figure
        className={cx(styles.root, styles.note, className)}
        data-state={state}
        data-type={type}
        aria-labelledby={titleId}
        {...props}
      >
        <figcaption className={styles.noteCaption}>
          <div className={styles.noteLine}>
            <span className={styles.noteIcon} aria-hidden>
              <FileX />
            </span>
            <span className={styles.noteText} id={titleId}>
              <span className={styles.noteWords}>{words}</span>
              <span className={styles.noteTitle}>{name}</span>
            </span>
            {hasDetails && (
              <span className={styles.noteActions}>
                <DetailsButton id={detailsId} open={detailsOpen} onOpenChange={setDetailsOpen} />
              </span>
            )}
          </div>
          {hasDetails && (
            <DetailsPanel
              id={detailsId}
              open={detailsOpen}
              onOpenChange={setDetailsOpen}
              prompt={prompt}
              details={all}
            />
          )}
        </figcaption>
      </figure>
    );
  }

  const making = state === 'making';
  const lit = making || developing;
  const hasDetails = Boolean(prompt || details?.length);
  // What the card shows of the file once it’s there.
  const restFace = face ? (
    <span className={styles.face}>{face}</span>
  ) : thumb ? (
    <img
      ref={picture}
      className={cx(styles.face, styles.thumb)}
      data-shape={shape}
      src={thumb}
      alt=""
      decoding="async"
      draggable={false}
      onLoad={() => setLoadedSrc(thumb)}
      onError={() => setBrokenSrc(thumb)}
    />
  ) : excerpt ? (
    <Excerpt type={type} text={excerpt} name={name} />
  ) : (
    <Silhouette shape={shape} badge={badge} still />
  );

  return (
    <figure
      className={cx(styles.root, className)}
      data-state={state}
      data-type={type}
      data-shape={shape}
      data-shown={shown || undefined}
      data-develop={developing || undefined}
      data-waiting={(making && waiting) || undefined}
      aria-busy={making || undefined}
      aria-labelledby={titleId}
      aria-describedby={ready ? metaId : undefined}
      {...props}
      style={{ ...tint, ...props.style }}
    >
      <div className={styles.frame}>
        {lit && <Halo />}
        <div className={styles.clip}>
          <Backdrop />
          {(!shown || developing) && (
            <span className={styles.making}>
              <Silhouette shape={shape} badge={badge} still={false} />
            </span>
          )}
          {ready && <span className={styles.rest}>{restFace}</span>}
          {making && <span className={styles.sheen} aria-hidden />}
          {developing && <span className={styles.iris} aria-hidden />}
          {making && (
            <span className={styles.typeBadge} aria-hidden>
              {badge}
            </span>
          )}
          {making && waiting && (
            <div className={styles.meter} data-waiting="">
              <span className={styles.meterWords}>Waiting for you</span>
            </div>
          )}
          {making && !waiting && (
            <Meter name={name} progress={progress} stage={stage} detail={detail} doing={doing} />
          )}
          {ready && onOpen && (
            <button
              type="button"
              className={styles.open}
              onClick={onOpen}
              aria-label={`Look closer at ${name}`}
            />
          )}
        </div>
        {watched && (
          <span className="nc-visually-hidden" role="status">
            {shown ? `${name} is ready` : ''}
          </span>
        )}
      </div>
      <figcaption className={styles.caption}>
        <div className={styles.captionRow}>
          <TypeTile type={type} />
          <span className={styles.names}>
            <span className={styles.title} id={titleId}>
              {name}
            </span>
            <span className={styles.meta} id={metaId}>
              {making
                ? by && !waiting
                  ? `${TYPE_WORDS[type]} · with ${by}`
                  : TYPE_WORDS[type]
                : meta}
            </span>
          </span>
          {ready && (
            <div className={styles.actions}>
              {onOpen && (
                <IconButton size="sm" tone="neutral" label="Look closer" onClick={onOpen}>
                  <Maximize2 />
                </IconButton>
              )}
              {downloadHref && (
                <DownloadLink href={downloadHref} name={downloadName ?? name} label={name} />
              )}
              {onCopyLink && <CopyLink onCopyLink={onCopyLink} />}
              {onSend && (
                <IconButton size="sm" tone="neutral" label={sendLabel} onClick={onSend}>
                  <Send />
                </IconButton>
              )}
              {hasDetails && (
                <DetailsButton id={detailsId} open={detailsOpen} onOpenChange={setDetailsOpen} />
              )}
            </div>
          )}
        </div>
        {ready && hasDetails && (
          <DetailsPanel
            id={detailsId}
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            prompt={prompt}
            details={details}
          />
        )}
      </figcaption>
    </figure>
  );
}

export interface FileTileProps
  extends FileFacts, Omit<ComponentProps<'div'>, 'children' | keyof FileFacts> {
  /** Look closer (the preview). */
  onOpen?: () => void;
  downloadHref?: string;
  downloadName?: string;
  /** A quiet caveat, e.g. that the chosen model can’t open it. */
  note?: string;
}

/**
 * A file on a message, small: its picture or its type’s tile, its name and
 * its facts, one press to look closer and one to download. The same glyphs,
 * tints and words as the file’s full card, so a file looks the same whoever
 * sent it.
 */
export function FileTile({
  name,
  mimeType,
  kind,
  size,
  pages,
  sheets,
  slides,
  lines,
  files,
  thumbnail,
  excerpt: _excerpt,
  onOpen,
  downloadHref,
  downloadName,
  note,
  className,
  style,
  ...props
}: FileTileProps) {
  const [broken, setBroken] = useState(false);
  const type = fileTypeOf({ name, mimeType, kind });
  const badge = badgeFor(name, type);
  const meta = fileMeta({ badge, size, pages, sheets, slides, lines, files });
  const thumb = thumbnail && !broken ? thumbnail : undefined;
  const label = [name, meta, note].filter(Boolean).join(', ');
  const face = (
    <>
      {thumb ? (
        <span className={styles.tileThumb} aria-hidden>
          <img
            src={thumb}
            alt=""
            draggable={false}
            decoding="async"
            onError={() => setBroken(true)}
          />
        </span>
      ) : (
        <TypeTile type={type} className={styles.tileBig} />
      )}
      <span className={styles.names}>
        <span className={styles.title}>{name}</span>
        <span className={styles.meta}>{meta}</span>
      </span>
    </>
  );
  return (
    <div
      className={cx(styles.fileTile, className)}
      data-type={type}
      data-note={note ? '' : undefined}
      style={{ '--fm-h': `var(--fm-h-${type})`, ...style } as CSSProperties}
      {...props}
    >
      {onOpen ? (
        <Tooltip content={note}>
          <button
            type="button"
            className={styles.tileOpen}
            data-lustre=""
            aria-label={label}
            onClick={onOpen}
          >
            {face}
          </button>
        </Tooltip>
      ) : (
        <span className={styles.tileOpen} aria-label={label} role="group">
          {face}
        </span>
      )}
      {downloadHref && (
        <span className={styles.tileActions}>
          <DownloadLink href={downloadHref} name={downloadName ?? name} label={name} />
        </span>
      )}
    </div>
  );
}
