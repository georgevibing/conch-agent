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
   * The page asked for one of its declared sources (ADR 0046). Whatever this
   * resolves to goes back to that page, and to nothing else.
   */
  onData?: (request: SealedDataRequest) => Promise<unknown>;
  /** Change it to tell the page to read its sources again (auto-refresh, Update now). */
  refresh?: number;
  /**
   * A Conch app's page called one of its own tools (`conch.call`, ADR 0061).
   * `activated` says the person was pressing something in the page right
   * then (transient user activation, which a click inside the frame gives
   * this page too): a change may go without asking. Whatever this resolves
   * to goes back to that page, and to nothing else.
   */
  onCall?: (
    tool: string,
    input: Record<string, unknown>,
    activated: boolean,
  ) => Promise<SealedCallResult>;
}

/** What a page's tool call comes back as (mirrors `AppCallResult` in `@conch/protocol`). */
export type SealedCallResult =
  | { ok: true; text: string; json?: unknown }
  | { ok: false; reason: 'confirm' | 'off' | 'error' | 'missing-settings'; message: string };

export interface SealedDataRequest {
  source: string;
  params: Record<string, string | number>;
}

const MIN = 120;
const MAX = 4000;
/** Requests one page may have waiting at once. */
const PENDING = 8;
const NAME = /^[a-z][a-z0-9_-]{0,31}$/i;
/** Tool calls one page may have waiting at once, and how big one may be. */
const CALLS = 8;
const CALL_BYTES = 64 * 1024;
const CALL_ID = /^[A-Za-z0-9_-]{1,32}$/;
/**
 * How long a press keeps a window active (Chrome and Firefox: five seconds;
 * the HTML standard leaves it to the browser). A press in Conch itself within
 * this long could be what made it active, so it doesn't count as the page's.
 */
const ACTIVATION_MS = 5000;
/** An app's tool name (`AppToolName`). */
const TOOL = /^[a-z][a-z0-9_]{0,19}$/;

/**
 * A call's input as plain JSON, or nothing: a plain object, at most
 * `CALL_BYTES` once written out. Whatever else a page posts (a Blob, a Map,
 * a cycle) never gets as far as the gateway.
 */
function callInput(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const proto = Object.getPrototypeOf(raw) as unknown;
  if (proto !== Object.prototype && proto !== null) return undefined;
  try {
    const text = JSON.stringify(raw);
    if (text.length > CALL_BYTES) return undefined;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

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
 * opened, a declared source it wants read (`onData`, ADR 0046), and — for a
 * Conch app's page — one of its own app's tools it wants called (`onCall`,
 * ADR 0061), and that is only believed from this very frame. Answers go back only to the
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
  onCall,
  className,
  ...props
}: SealedFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(initialHeight);
  const sealed = navigates && !scriptsAllowed;
  const openLink = useRef(onOpenLink);
  const askData = useRef(onData);
  const askCall = useRef(onCall);
  useEffect(() => {
    openLink.current = onOpenLink;
    askData.current = onData;
    askCall.current = onCall;
  }, [onOpenLink, onData, onCall]);
  const pending = useRef(0);
  const calls = useRef(0);
  // When the person last pressed or typed in Conch itself, not in a frame.
  const pressedHere = useRef(-Infinity);
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
      const asker = event.source as Window;
      const asked = live.current.src;
      // Only to the page that asked, still where it was, never one that tried to leave.
      // A sealed page's origin is opaque ("null"): the window itself is the address.
      const answer = (message: Record<string, unknown>) => {
        const frame = ref.current?.contentWindow;
        if (!frame || frame !== asker || live.current.src !== asked || live.current.stopped) return;
        frame.postMessage(message, '*');
      };

      // Live data (ADR 0046): a declared source, by name, with short values. The
      // gateway checks it all again; this only keeps nonsense from getting that far.
      const wanted = (data as { data?: unknown }).data as
        { id?: unknown; source?: unknown; params?: unknown } | undefined;
      const ask = askData.current;
      if (ask && wanted && typeof wanted === 'object') {
        const { id, source } = wanted;
        const values = params(wanted.params);
        if (
          typeof id === 'string' &&
          id.length <= 32 &&
          typeof source === 'string' &&
          NAME.test(source) &&
          values &&
          pending.current < PENDING
        ) {
          pending.current++;
          void ask({ source, params: values })
            .catch(() => ({ ok: false, reason: 'failed', message: 'Conch couldn’t ask for it.' }))
            .then((result) => {
              pending.current--;
              answer({ conch: 'artifact-data', id, result });
            });
        }
      }

      /*
       * A Conch app's page calling its own app's tools (ADR 0061). The page's
       * side (`conch.call(tool, input)`, in the bridge `artifacts/frame.ts`
       * writes into the page) and this side speak exactly:
       *
       *   page → panel  { conch: 'artifact', call: { id, tool, input } }
       *   panel → page  { conch: 'app-call', id, result }   // result: AppCallResult
       *
       * `id` is the page's own (at most 32 of A–Z, a–z, 0–9, _ and -), `tool`
       * an app tool's name, `input` a plain object (64 KB at most as JSON).
       * The person's press is read here, as the message arrives, and never
       * taken from the page's word. Which app's tools these are is the
       * panel's to know (`onCall` is bound to the app whose page this is);
       * the gateway checks the tool, its switch and its policy again.
       */
      const call = (data as { call?: unknown }).call as
        { id?: unknown; tool?: unknown; input?: unknown } | undefined;
      const run = askCall.current;
      if (!run || !call || typeof call !== 'object') return;
      const { id } = call;
      if (typeof id !== 'string' || !CALL_ID.test(id)) return;
      /*
       * A press counts only when it was in this frame. Activation is the whole
       * window's for a few seconds, and a sealed page can take focus back the
       * moment it has some, so a click elsewhere in Conch must not lend itself
       * to the page: the window is active, the frame has focus, and nobody
       * pressed anything in Conch itself while that activation could last.
       * (A press inside the frame never reaches this document.) Erring means
       * Conch asks first, never that a change goes by itself.
       */
      const activated =
        (navigator as { userActivation?: { isActive?: boolean } }).userActivation?.isActive ===
          true &&
        document.activeElement === ref.current &&
        performance.now() - pressedHere.current > ACTIVATION_MS;
      const input = callInput(call.input);
      if (typeof call.tool !== 'string' || !TOOL.test(call.tool) || !input) {
        answer({
          conch: 'app-call',
          id,
          result: {
            ok: false,
            reason: 'error',
            message:
              'Conch can’t send that: name one of this app’s tools, with a small plain object.',
          },
        });
        return;
      }
      if (calls.current >= CALLS) {
        answer({
          conch: 'app-call',
          id,
          result: {
            ok: false,
            reason: 'error',
            message: 'Too many calls at once. Wait for one to finish, then try again.',
          },
        });
        return;
      }
      calls.current++;
      void run(call.tool, input, activated)
        .catch((): SealedCallResult => ({
          ok: false,
          reason: 'error',
          message: 'Conch couldn’t reach the app. Try again.',
        }))
        .then((result) => {
          calls.current--;
          answer({ conch: 'app-call', id, result });
        });
    };
    // Every way a press or a key can make this window active, seen before anything else.
    const pressed = () => {
      pressedHere.current = performance.now();
    };
    const presses = ['pointerdown', 'mousedown', 'keydown', 'touchend'] as const;
    for (const type of presses) window.addEventListener(type, pressed, true);
    window.addEventListener('message', onMessage);
    return () => {
      for (const type of presses) window.removeEventListener(type, pressed, true);
      window.removeEventListener('message', onMessage);
    };
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
