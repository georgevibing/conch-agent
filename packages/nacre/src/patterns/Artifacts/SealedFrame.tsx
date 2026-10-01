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
}

const MIN = 120;
const MAX = 4000;

/**
 * A page the assistant made, in a frame that can't reach anything (ADR 0034).
 *
 * The iframe is `sandbox="allow-scripts"` — never `allow-same-origin`, popups,
 * forms or top navigation — so the page is nobody: no cookies, no Conch, no
 * reaching up into this page. The only thing it may say is its height, and
 * that is only believed from this very frame. A page that leaves its address
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
  className,
  ...props
}: SealedFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(initialHeight);
  const sealed = navigates && !scriptsAllowed;
  const openLink = useRef(onOpenLink);
  useEffect(() => {
    openLink.current = onOpenLink;
  }, [onOpenLink]);
  // Said in the address too, so the server serves the page the same way.
  const frameSrc = navigates
    ? `${src}${src.includes('?') ? '&' : '?'}scripts=${sealed ? 0 : 1}`
    : src;
  // Which page was stopped, and how many times each page has loaded.
  const [stoppedSrc, setStoppedSrc] = useState<string>();
  const loads = useRef(new Map<string, number>());
  const stopped = stoppedSrc === frameSrc;

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
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

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
