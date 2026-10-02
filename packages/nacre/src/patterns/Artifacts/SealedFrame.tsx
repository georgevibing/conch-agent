import { useEffect, useRef, useState, type ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { cx } from '../../utils/cx';
import styles from './Artifacts.module.css';

export interface SealedFrameProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The page, served by Conch with its own sealed headers. */
  src: string;
  /** The page's name, read to screen readers as the frame's title. */
  title: string;
  /**
   * The page has code or links that could send you to another site. It is
   * shown with its scripts off until `scriptsAllowed`.
   */
  navigates?: boolean;
  scriptsAllowed?: boolean;
  onAllowScripts?: () => void;
  /** Fill the space (full screen) instead of growing with the page. */
  fill?: boolean;
  /** Height before the page says how tall it is. */
  initialHeight?: number;
  /** The page asked to open a link (an http(s) address): ask before opening it. */
  onOpenLink?: (url: string) => void;
  /**
   * The page asked for one of its declared sources (ADR 0039). Whatever this
   * resolves to goes back to that page, and to nothing else.
   */
  onData?: (request: SealedDataRequest) => Promise<unknown>;
  /** Change it to tell the page to read its sources again (auto-refresh, Update now). */
  refresh?: number;
}

export interface SealedDataRequest {
  source: string;
  params: Record<string, string | number>;
}

const MIN = 120;
const MAX = 4000;
/** Requests one page may have waiting at once. */
const PENDING = 8;
const NAME = /^[a-z][a-z0-9_-]{0,31}$/i;

/** A page's parameters, if they're only short words and numbers. */
function params(raw: unknown): Record<string, string | number> | undefined {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 10) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of entries) {
    if (!NAME.test(key)) return undefined;
    if (typeof value === 'string' && value.length <= 64) out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else return undefined;
  }
  return out;
}

/**
 * A page the assistant made, in a frame that can't reach anything (ADR 0034).
 *
 * The iframe is `sandbox="allow-scripts"` — never `allow-same-origin`, popups,
 * forms or top navigation — so the page is nobody: no cookies, no Conch, no
 * reaching up into this page. All it may say is its height, a link it wants
 * opened, and a declared source it wants read (`onData`, ADR 0039), and
 * that is only believed from this very frame. Answers go back only to the
 * page that asked, while it's still the page that loaded. A page that leaves its address
 * anyway (the one thing a sandbox allows) is stopped and blanked.
 */
export function SealedFrame({
  src,
  title,
  navigates,
  scriptsAllowed,
  onAllowScripts,
  fill,
  initialHeight = 320,
  onOpenLink,
  onData,
  refresh,
  className,
  ...props
}: SealedFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(initialHeight);
  const sealed = navigates && !scriptsAllowed;
  const openLink = useRef(onOpenLink);
  const askData = useRef(onData);
  useEffect(() => {
    openLink.current = onOpenLink;
    askData.current = onData;
  }, [onOpenLink, onData]);
  const pending = useRef(0);
  // Said in the address too, so the server serves the page the same way.
  const frameSrc = navigates
    ? `${src}${src.includes('?') ? '&' : '?'}scripts=${sealed ? 0 : 1}`
    : src;
  // Which page was stopped, and how many times each page has loaded.
  const [stoppedSrc, setStoppedSrc] = useState<string>();
  const loads = useRef(new Map<string, number>());
  const stopped = stoppedSrc === frameSrc;
  const live = useRef({ src: frameSrc, stopped });
  useEffect(() => {
    live.current = { src: frameSrc, stopped };
  }, [frameSrc, stopped]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // A sandboxed frame's origin is "null"; who sent it is what counts.
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const data = event.data as { conch?: unknown; height?: unknown; open?: unknown } | null;
      if (!data || data.conch !== 'artifact') return;
      if (typeof data.height === 'number' && Number.isFinite(data.height))
        setHeight(Math.min(MAX, Math.max(MIN, Math.ceil(data.height))));
      if (
        typeof data.open === 'string' &&
        data.open.length <= 2048 &&
        /^https?:\/\//i.test(data.open)
      )
        openLink.current?.(data.open);
      // Live data (ADR 0039): a declared source, by name, with short values. The
      // gateway checks it all again; this only keeps nonsense from getting that far.
      const wanted = (data as { data?: unknown }).data as
        { id?: unknown; source?: unknown; params?: unknown } | undefined;
      const ask = askData.current;
      if (!ask || !wanted || typeof wanted !== 'object') return;
      const { id, source } = wanted;
      const values = params(wanted.params);
      if (typeof id !== 'string' || id.length > 32 || typeof source !== 'string') return;
      if (!NAME.test(source) || !values || pending.current >= PENDING) return;
      const asker = event.source as Window;
      const asked = live.current.src;
      pending.current++;
      void ask({ source, params: values })
        .catch(() => ({ ok: false, reason: 'failed', message: 'Conch couldn’t ask for it.' }))
        .then((result) => {
          pending.current--;
          // Only to the page that asked, still where it was, never one that tried to leave.
          const frame = ref.current?.contentWindow;
          if (!frame || frame !== asker || live.current.src !== asked || live.current.stopped)
            return;
          // A sealed page's origin is opaque ("null"): the window itself is the address.
          frame.postMessage({ conch: 'artifact-data', id, result }, '*');
        });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Read again: every source the page watches (`conch.watch`).
  const first = useRef(refresh);
  useEffect(() => {
    if (refresh === first.current) return;
    first.current = refresh;
    if (!live.current.stopped)
      ref.current?.contentWindow?.postMessage({ conch: 'artifact-data', refresh: true }, '*');
  }, [refresh]);

  return (
    <div className={cx(styles.frameWrap, className)} data-fill={fill || undefined} {...props}>
      {sealed && (
        <Callout
          tone="warning"
          title="Shown with its code off"
          action={
            onAllowScripts && (
              <Button size="sm" variant="surface" onClick={onAllowScripts}>
                Run it anyway
              </Button>
            )
          }
        >
          This page has links or code that could take you to another site. It can’t reach anything
          of yours, but Conch keeps its code off until you say so.
        </Callout>
      )}
      {stopped ? (
        <Callout tone="danger" title="Conch stopped this page" live="polite">
          It tried to go to another address, which could carry what’s on it away. Nothing of yours
          was in it.
        </Callout>
      ) : (
        <iframe
          ref={ref}
          key={frameSrc}
          src={frameSrc}
          title={title}
          sandbox={sealed ? '' : 'allow-scripts'}
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; fullscreen 'none'"
          loading="lazy"
          className={styles.frame}
          style={fill ? undefined : { blockSize: height }}
          onLoad={() => {
            const n = (loads.current.get(frameSrc) ?? 0) + 1;
            loads.current.set(frameSrc, n);
            if (n > 1) setStoppedSrc(frameSrc);
          }}
        />
      )}
    </div>
  );
}
