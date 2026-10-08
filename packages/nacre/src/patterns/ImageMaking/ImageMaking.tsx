import { Check, Copy, Download, ImageOff, Info, Maximize2, WandSparkles } from 'lucide-react';
import {
  useEffect,
  useId,
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
import styles from './ImageMaking.module.css';
import { leftWords, parseAspect } from './time';

export type ImageMakingState = 'making' | 'ready' | 'failed' | 'declined' | 'stopped';
export type ImageMakingStage = 'queued' | 'generating' | 'finishing';

export interface ImageMakingDetail {
  label: string;
  value: ReactNode;
}

export interface ImageMakingProps extends Omit<ComponentProps<'figure'>, 'title' | 'children'> {
  state: ImageMakingState;
  /** What the picture is called, or the start of what was asked for: one line. */
  title: string;
  /** Its shape while it's being made: `'3:2'`, or a width ÷ height. Square when unknown. */
  aspect?: string | number;
  /** How far it got, 0–1. Absent: it can't say, so the wait has no number. */
  progress?: number;
  /** Where it is: about to start, being made, or being saved. */
  stage?: ImageMakingStage;
  /** About how long is left, in seconds (shown as “about 12s left”). */
  secondsLeft?: number;
  /** Who is making it, in a few words (“OpenAI”). */
  by?: string;
  /** It asked first and waits for your answer: the light holds still, nothing is sent yet. */
  waiting?: boolean;
  /** It's changing a picture rather than making a new one. */
  editing?: boolean;
  /** A partial picture on the way: shown soft, under the sheen. */
  preview?: string;
  /** The finished picture. */
  src?: string;
  /** What the finished picture shows, for people who can't see it. Defaults to the title. */
  alt?: string;
  /** Why it couldn't be made, in plain words. */
  reason?: string;
  /** Not made, in other words than the state's own (“Not made: no answer in time”). */
  notMade?: string;
  /** What was asked for, in full: the first line of Details. */
  prompt?: string;
  /** The rest of Details: the model, who made it, how long it took. Never file paths. */
  details?: ImageMakingDetail[];
  /** Look closer (the full-size preview). */
  onOpen?: () => void;
  downloadHref?: string;
  /** The file name a download is saved as. */
  downloadName?: string;
  /** Copy it to the clipboard. Defaults to copying `src` as a PNG, where the browser can. */
  onCopy?: () => Promise<void> | void;
  /** Ask for changes to it: fills the message box, sends nothing. */
  onEdit?: () => void;
}

const canCopyPictures = () =>
  typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';

function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return Promise.resolve(blob);
  return createImageBitmap(blob).then(
    (bitmap) =>
      new Promise<Blob>((resolve, reject) => {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('No PNG'))), 'image/png');
      }),
  );
}

/** The picture itself, as a PNG (the one type every clipboard takes). */
async function copyPicture(src: string) {
  // The item is handed over at once with a promise, so Safari still counts the press.
  const png = fetch(src)
    .then((r) => r.blob())
    .then(toPng);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

const stageWords = (stage: ImageMakingStage | undefined, editing: boolean) =>
  stage === 'queued'
    ? 'Starting'
    : stage === 'finishing'
      ? 'Finishing'
      : editing
        ? 'Changing it'
        : 'Making it';

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
        style={{ '--im-ring': value === undefined ? 28 : Math.round(value * 100) } as CSSProperties}
      />
    </svg>
  );
}

function Meter({
  progress,
  stage,
  secondsLeft,
  editing,
}: Pick<ImageMakingProps, 'progress' | 'stage' | 'secondsLeft'> & { editing: boolean }) {
  const known = progress !== undefined && Number.isFinite(progress) && stage !== 'queued';
  const value = known ? Math.min(0.99, Math.max(0, progress)) : undefined;
  const pct = value === undefined ? undefined : Math.round(value * 100);
  const left =
    known && secondsLeft !== undefined && stage !== 'finishing'
      ? leftWords(secondsLeft)
      : undefined;
  const words = stageWords(stage, editing);
  return (
    <div
      className={styles.meter}
      role="progressbar"
      aria-label={editing ? 'Changing the picture' : 'Making the picture'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={
        pct === undefined ? `${words}…` : [`${pct}%`, left].filter(Boolean).join(', ')
      }
    >
      <Ring value={value} />
      {pct === undefined ? (
        <span className={styles.meterWords}>{words}…</span>
      ) : (
        <span className={styles.meterValue}>{pct}%</span>
      )}
      {left && <span className={styles.meterLeft}>{left}</span>}
      {pct !== undefined && stage === 'finishing' && (
        <span className={styles.meterLeft}>finishing</span>
      )}
    </div>
  );
}

/** How long the finished picture takes to come out of the light (matches `--im-develop`). */
const DEVELOP_MS = 1100;

/**
 * What the frame shows while there's nothing yet: a slow mesh of pearl light
 * (five soft shapes on their own paths, a turning film, caustic veins) whose
 * hue drifts.
 */
function Nacre() {
  return (
    <div className={styles.nacre} aria-hidden>
      <span className={styles.blob} data-n="1" />
      <span className={styles.blob} data-n="2" />
      <span className={styles.blob} data-n="3" />
      <span className={styles.blob} data-n="4" />
      <span className={styles.blob} data-n="5" />
      <span className={styles.film} />
      <span className={styles.caustic} data-n="1" />
      <span className={styles.caustic} data-n="2" />
    </div>
  );
}

/** Pearl light going round the frame's edge, with a soft bloom outside it. */
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

/** Details, as a quiet panel under the card, its edges on the card's. */
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
} & Pick<ImageMakingProps, 'prompt' | 'details'>) {
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

/** The info button that opens Details: it sits with the other actions. */
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

function Actions({
  title,
  src,
  onOpen,
  downloadHref,
  downloadName,
  onCopy,
  onEdit,
  details,
}: Pick<
  ImageMakingProps,
  'title' | 'src' | 'onOpen' | 'downloadHref' | 'downloadName' | 'onCopy' | 'onEdit'
> & { details?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = onCopy ?? (src && canCopyPictures() ? () => copyPicture(src) : undefined);
  return (
    <div className={styles.actions}>
      {onOpen && (
        <IconButton size="sm" tone="neutral" label="Look closer" onClick={onOpen}>
          <Maximize2 />
        </IconButton>
      )}
      {downloadHref && (
        <Tooltip content="Download">
          <Button
            asChild
            size="sm"
            variant="ghost"
            tone="neutral"
            className={iconButton.iconButton}
            leadingIcon={<Download />}
          >
            <a
              href={downloadHref}
              download={downloadName ?? title}
              aria-label={`Download ${title}`}
            />
          </Button>
        </Tooltip>
      )}
      {copy && (
        <IconButton
          size="sm"
          tone="neutral"
          label={copied ? 'Copied' : 'Copy picture'}
          onClick={async () => {
            try {
              await copy();
              setCopied(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(false), 1600);
            } catch {
              toast.error('Couldn’t copy the picture here. Download it instead.');
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
        </IconButton>
      )}
      {onEdit && (
        <IconButton size="sm" tone="neutral" label="Change it" onClick={onEdit}>
          <WandSparkles />
        </IconButton>
      )}
      {details}
    </div>
  );
}

/**
 * A picture being made, then the picture. While it's made, the frame holds its
 * shape, slow pearl light moves inside it and goes round its edge, with how far
 * it got; a partial picture shows through, soft. When it's ready it develops in
 * place: light runs in from the edge as the picture sharpens out of it, and it
 * becomes a quiet card: the picture, its name, and what you can do with it.
 * Not made (you said no, it failed, it was stopped) is a calm line, never a
 * tick. Details (the info button) keep what was asked for and who made it.
 */
export function ImageMaking({
  state,
  title,
  aspect,
  progress,
  stage,
  secondsLeft,
  by,
  waiting = false,
  editing = false,
  preview,
  src,
  alt,
  reason,
  notMade,
  prompt,
  details,
  onOpen,
  downloadHref,
  downloadName,
  onCopy,
  onEdit,
  className,
  style,
  ...props
}: ImageMakingProps) {
  // Only news develops: a picture already there when this drew just shows.
  const [watched] = useState(state === 'making');
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const [settled, setSettled] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState<string>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const picture = useRef<HTMLImageElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const detailsId = `${id}-details`;

  const ready = state === 'ready' && Boolean(src);
  const shown = ready && loaded && !broken;
  const developing = watched && shown && !settled;

  // A cached picture can finish loading before React listens.
  useEffect(() => {
    if (picture.current?.complete && picture.current.naturalWidth > 0) setLoaded(true);
  }, [src]);

  // The light stays under the picture while it develops, then goes.
  useEffect(() => {
    if (!(watched && shown)) return;
    const timer = setTimeout(() => setSettled(true), DEVELOP_MS + 150);
    return () => clearTimeout(timer);
  }, [watched, shown]);

  if (state === 'failed' || state === 'declined' || state === 'stopped') {
    const words =
      notMade ??
      (state === 'declined'
        ? 'Not made: you said no'
        : state === 'stopped'
          ? 'Stopped before it was made'
          : `Couldn’t make it${reason ? `: ${reason}` : ''}`);
    // The line holds three lines of the reason; a longer one is in full in Details.
    const all =
      state === 'failed' && !notMade && reason && reason.length > 140
        ? [{ label: 'What went wrong', value: reason }, ...(details ?? [])]
        : details;
    const hasDetails = Boolean(prompt || all?.length);
    return (
      <figure
        className={cx(styles.root, styles.note, className)}
        data-state={state}
        aria-labelledby={titleId}
        style={style}
        {...props}
      >
        <figcaption className={styles.noteCaption}>
          <div className={styles.noteLine}>
            <span className={styles.noteIcon} aria-hidden>
              <ImageOff />
            </span>
            <span className={styles.noteText} id={titleId}>
              <span className={styles.noteWords}>{words}</span>
              <span className={styles.noteTitle}>{title}</span>
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

  const ratio = parseAspect(aspect);
  const lit = !broken && (state === 'making' || (watched && !settled));
  const hasDetails = Boolean(prompt || details?.length);
  const frameStyle = { ...style, '--im-ratio': ratio } as CSSProperties;
  const image = ready && (
    <img
      ref={picture}
      className={styles.final}
      src={src}
      alt={alt ?? title}
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => setBroken(true)}
    />
  );

  return (
    <figure
      className={cx(styles.root, className)}
      data-state={state}
      data-shown={shown || undefined}
      data-develop={(watched && shown) || undefined}
      data-waiting={(state === 'making' && waiting) || undefined}
      aria-busy={state === 'making' || undefined}
      aria-labelledby={titleId}
      style={frameStyle}
      {...props}
    >
      <div className={styles.frame}>
        {lit && <Halo />}
        <div className={styles.clip}>
          {(!shown || developing) && <Nacre />}
          {preview && !ready && (
            <img
              key={preview}
              className={styles.preview}
              src={preview}
              alt=""
              data-loaded={previewLoaded === preview || undefined}
              onLoad={() => setPreviewLoaded(preview)}
            />
          )}
          {!shown && <span className={styles.sheen} aria-hidden />}
          {!shown && <span className={styles.grain} aria-hidden />}
          {ready && onOpen && !broken ? (
            <button
              type="button"
              className={styles.open}
              onClick={onOpen}
              aria-label={`Look closer at ${title}`}
            >
              {image}
            </button>
          ) : (
            !broken && image
          )}
          {developing && <span className={styles.iris} aria-hidden />}
          {state === 'making' && waiting && (
            <div className={styles.meter} data-waiting="">
              <span className={styles.meterWords}>Waiting for you</span>
            </div>
          )}
          {state === 'making' && !waiting && (
            <Meter progress={progress} stage={stage} secondsLeft={secondsLeft} editing={editing} />
          )}
          {broken && (
            <p className={styles.broken}>
              Couldn’t load the picture. It may have gone with its chat.
            </p>
          )}
        </div>
        {watched && (
          <span className="nc-visually-hidden" role="status">
            {shown ? 'Picture ready' : ''}
          </span>
        )}
      </div>
      <figcaption className={styles.caption}>
        <div className={styles.captionRow}>
          <span className={styles.title} id={titleId}>
            {title}
          </span>
          {state === 'making' && by && !waiting && <span className={styles.by}>with {by}</span>}
          {state === 'ready' && (
            <Actions
              title={title}
              src={broken ? undefined : src}
              onOpen={broken ? undefined : onOpen}
              downloadHref={downloadHref}
              downloadName={downloadName}
              onCopy={onCopy}
              onEdit={onEdit}
              details={
                hasDetails && (
                  <DetailsButton id={detailsId} open={detailsOpen} onOpenChange={setDetailsOpen} />
                )
              }
            />
          )}
        </div>
        {state === 'ready' && hasDetails && (
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
