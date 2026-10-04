import {
  AppWindowMac,
  ArrowLeft,
  ArrowRight,
  Cloud,
  Globe,
  Hand,
  Lock,
  MousePointerClick,
  Plus,
  RotateCcw,
  RotateCw,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type WheelEvent,
} from 'react';

import { Button } from '../../components/Button';
import { ContextMenu } from '../../components/ContextMenu';
import { IconButton } from '../../components/IconButton';
import { Pearl } from '../../components/Pearl';
import { Progress } from '../../components/Progress';
import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import styles from './Browser.module.css';
import {
  browserShortcut,
  buttonOf,
  isReleaseKey,
  keyInput,
  modifiersOf,
  pointOn,
  wheelDelta,
  type BrowserInput,
} from './input';

export type BrowserControl = 'agent' | 'user' | 'idle';

export interface BrowserBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserWindowTab {
  url: string;
  title: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  control: BrowserControl;
  /** The assistant is waiting for you to do something (sign in, a captcha…). */
  handoff?: { reason: string };
  /** Every tab in the chat, shown in the strip above the toolbar. */
  tabs?: BrowserWindowTabEntry[];
  /** Where it runs, when it isn't the assistant's own browser here. */
  backend?: 'chrome' | 'browserbase' | 'steel' | 'cdp';
}

export interface BrowserWindowTabEntry {
  id: string;
  title: string;
  url: string;
  active: boolean;
  /** Its page is loading: a spinner in place of the icon. */
  loading?: boolean;
  /** The site's icon, as an image URL (a data URL from the gateway). */
  icon?: string;
}

/** What a tab can do: show it, close it, open a new one, close the rest, or bring back the last closed. */
export type BrowserTabAction = 'switch' | 'close' | 'new' | 'others' | 'reopen';

/** What the assistant is about to do, for its cursor and caption. Change `key` for each new action. */
export interface BrowserWindowAction {
  key: string | number;
  action: string;
  label: string;
  box?: BrowserBox;
  /** The page it happened on: the highlight only shows there. */
  url?: string;
}

export type BrowserWindowPhase =
  'connecting' | 'off' | 'installing' | 'starting' | 'restoring' | 'running' | 'problem';

export interface BrowserWindowProps extends Omit<ComponentProps<'section'>, 'onInput'> {
  tab?: BrowserWindowTab | null;
  /** Where the browser is: shown on the screen when there's no page to show. */
  phase?: BrowserWindowPhase;
  install?: { percent: number; label: string };
  problem?: { message: string; command?: string; actionLabel?: string; onAction?: () => void };
  /** A still frame (stories, the first paint). The live view writes to `screenRef` directly. */
  frame?: string;
  /** The `<img>` the live view draws frames into, without re-rendering React. */
  screenRef?: Ref<HTMLImageElement>;
  /** The page is 1280×800 unless said otherwise; the screen keeps its shape. */
  viewport?: { width: number; height: number };
  action?: BrowserWindowAction;
  /** The assistant's name, for "Conch is browsing". */
  name?: string;
  onNavigate?: (url: string) => void;
  onHistory?: (action: 'back' | 'forward' | 'reload' | 'stop') => void;
  /** Your input on the page, while you're driving. */
  onInput?: (input: BrowserInput) => void;
  onTakeOver?: () => void;
  onHandBack?: () => void;
  /** The screen's room changed (CSS px): the page can take its shape. */
  onFit?: (size: { width: number; height: number }) => void;
  /** Show a tab, close one, open a new one, close the others, or reopen the last closed. */
  onTab?: (action: BrowserTabAction, id?: string) => void;
  onClose?: () => void;
  /** Extra controls at the end of the toolbar. */
  actions?: ReactNode;
}

/** `https://www.booking.com/hotels?x` → host and the rest, for the address bar. */
function splitUrl(url: string): { host: string; rest: string; secure: boolean } {
  try {
    const parsed = new URL(url);
    const rest = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
    return { host: parsed.host.replace(/^www\./, ''), rest, secure: parsed.protocol === 'https:' };
  } catch {
    return { host: url, rest: '', secure: false };
  }
}

/**
 * The browser as a window in the chat: the page streams in live, the
 * assistant's cursor glides to what it's about to touch, and a caption says
 * what it's doing. Click into the page (or "Take over") to drive yourself; the
 * assistant waits until you hand back. When it asks you to do something only
 * you should (sign in, pay), the window says so and glows until you're done.
 */
export function BrowserWindow({
  tab,
  phase = 'running',
  install,
  problem,
  frame,
  screenRef,
  viewport = { width: 1280, height: 800 },
  action,
  name = 'Conch',
  onNavigate,
  onHistory,
  onInput,
  onTakeOver,
  onHandBack,
  onFit,
  onTab,
  onClose,
  actions,
  className,
  ...props
}: BrowserWindowProps) {
  const control = tab?.control ?? 'idle';
  const driving = control === 'user';
  const handoff = tab?.handoff;
  const { host, rest, secure } = splitUrl(tab?.url ?? '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const screen = useRef<HTMLDivElement | null>(null);
  // Where your keys land while you drive: a hidden field, as remote-desktop
  // clients do, so input methods and phone keyboards work too.
  const keys = useRef<HTMLTextAreaElement | null>(null);
  const hintId = useId();
  const moveFrame = useRef(0);
  const [hasFrame, setHasFrame] = useState(Boolean(frame));

  // The caption stays up a moment after each action, then fades.
  const [expired, setExpired] = useState<string | number>();
  useEffect(() => {
    if (!action) return;
    const timer = setTimeout(() => setExpired(action.key), 2_600);
    return () => clearTimeout(timer);
  }, [action]);
  const caption = action && expired !== action.key ? action : undefined;

  // Tell the gateway how much room the page has, so it can take the panel's shape.
  const stage = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = stage.current;
    if (!el || !onFit || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      const size = { width: Math.round(width), height: Math.round(height) };
      clearTimeout(timer);
      // The first size goes at once, so the page opens in the panel's shape;
      // a drag settles before the page is resized.
      if (first) {
        first = false;
        onFit(size);
      } else timer = setTimeout(() => onFit(size), 180);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [onFit]);

  // Driving: keyboard focus goes to the page.
  useEffect(() => {
    if (driving) keys.current?.focus({ preventScroll: true });
  }, [driving]);

  const send = (input: BrowserInput) => onInput?.(input);

  function pointer(kind: 'down' | 'up' | 'move', event: PointerEvent<HTMLButtonElement>) {
    if (!driving) {
      // Touching the page takes the wheel; that first click only takes it.
      if (kind === 'down' && event.button === 0) {
        event.preventDefault();
        onTakeOver?.();
      }
      return;
    }
    const rect = screen.current?.getBoundingClientRect();
    if (!rect) return;
    const point = pointOn(rect, event.clientX, event.clientY);
    if (kind === 'move') {
      cancelAnimationFrame(moveFrame.current);
      moveFrame.current = requestAnimationFrame(() =>
        send({ type: 'mouse', action: 'move', ...point }),
      );
      return;
    }
    if (kind === 'down') {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      keys.current?.focus({ preventScroll: true });
    }
    send({
      type: 'mouse',
      action: kind,
      ...point,
      button: buttonOf(event.button),
      clickCount: Math.max(1, event.detail || 1),
      modifiers: modifiersOf(event),
    });
  }

  const onWheel = (event: WheelEvent<HTMLButtonElement>) => {
    if (!driving) return;
    const rect = screen.current?.getBoundingClientRect();
    if (!rect) return;
    send({
      type: 'mouse',
      action: 'wheel',
      ...pointOn(rect, event.clientX, event.clientY),
      ...wheelDelta(event, viewport.width / rect.width),
    });
  };

  function key(kind: 'down' | 'up', event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!driving) return;
    if (kind === 'down' && isReleaseKey(event)) {
      // The way out of the page: focus the hand-back button.
      event.preventDefault();
      document.getElementById(`${hintId}-handback`)?.focus();
      return;
    }
    const input = keyInput(kind, event.nativeEvent);
    if (!input) return;
    event.preventDefault();
    send(input);
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!driving) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    send({ type: 'text', text });
  };

  const submitAddress = () => {
    const url = draft.trim();
    setEditing(false);
    if (url) onNavigate?.(url);
  };

  const typeAddress = (text: string) => {
    setDraft(text);
    setEditing(true);
  };

  const tabs = tab?.tabs?.length
    ? tab.tabs
    : [{ id: '', title: tab?.title ?? '', url: tab?.url ?? '', active: true }];
  const activeTab = tabs.find((t) => t.active);
  const newTab = () => {
    if (!tab?.url && tabs.length <= 1) return typeAddress('');
    onTab?.('new');
    // The new tab is for going somewhere: the address is ready to type.
    typeAddress('');
  };

  // A browser's keys, wherever focus is in the window (even while you drive:
  // they're the browser's, not the page's). Some are the system's own in a
  // web page (⌘T, ⌘W); the desktop app gets them all.
  const onShortcut = (event: KeyboardEvent<HTMLElement>) => {
    const shortcut = browserShortcut(event.nativeEvent);
    if (!shortcut) return;
    const inField = event.target instanceof HTMLInputElement;
    const index = activeTab ? tabs.indexOf(activeTab) : 0;
    const at = (n: number) => tabs[(n + tabs.length) % tabs.length];
    let handled = true;
    switch (shortcut.kind) {
      case 'address':
        typeAddress(tab?.url ?? '');
        break;
      case 'new':
        if (onTab) newTab();
        else handled = false;
        break;
      case 'close':
        if (onTab && activeTab?.id && tabs.length > 1) onTab('close', activeTab.id);
        else handled = false;
        break;
      case 'reopen':
        if (onTab) onTab('reopen');
        else handled = false;
        break;
      case 'next':
      case 'previous': {
        const next = at(index + (shortcut.kind === 'next' ? 1 : -1));
        if (onTab && next?.id && tabs.length > 1) onTab('switch', next.id);
        else handled = false;
        break;
      }
      case 'nth': {
        const next = shortcut.index < 0 ? tabs.at(-1) : tabs[shortcut.index];
        if (onTab && next?.id && !next.active) onTab('switch', next.id);
        else handled = Boolean(next);
        break;
      }
      case 'back':
      case 'forward':
        // In the address field, these keys move the caret.
        if (inField) handled = false;
        else if (shortcut.kind === 'back' ? tab?.canGoBack : tab?.canGoForward)
          onHistory?.(shortcut.kind);
        break;
    }
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const box = !caption?.url || caption.url === tab?.url ? caption?.box : undefined;
  const empty = !tab?.url && !hasFrame;

  return (
    <section
      aria-label="Browser"
      className={cx(styles.window, className)}
      data-control={control}
      data-handoff={handoff ? '' : undefined}
      onKeyDownCapture={onShortcut}
      {...props}
    >
      <TabStrip
        tabs={tabs}
        onTab={tab ? onTab : undefined}
        onNew={onTab ? newTab : undefined}
        onReload={tab?.url ? () => onHistory?.('reload') : undefined}
      />
      <header className={styles.chrome}>
        <div className={styles.nav}>
          <IconButton
            size="sm"
            variant="ghost"
            label="Back"
            disabled={!tab?.canGoBack}
            onClick={() => onHistory?.('back')}
          >
            <ArrowLeft />
          </IconButton>
          <IconButton
            size="sm"
            variant="ghost"
            label="Forward"
            disabled={!tab?.canGoForward}
            onClick={() => onHistory?.('forward')}
          >
            <ArrowRight />
          </IconButton>
          {tab?.loading ? (
            <IconButton
              size="sm"
              variant="ghost"
              label="Stop loading"
              onClick={() => onHistory?.('stop')}
            >
              <X />
            </IconButton>
          ) : (
            <IconButton
              size="sm"
              variant="ghost"
              label="Reload"
              disabled={!tab?.url}
              onClick={() => onHistory?.('reload')}
            >
              <RotateCw />
            </IconButton>
          )}
        </div>

        {editing ? (
          <form
            className={styles.address}
            data-editing=""
            onSubmit={(event) => {
              event.preventDefault();
              submitAddress();
            }}
          >
            <Globe className={styles.addressIcon} aria-hidden />
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus -- opened on purpose to type
              autoFocus
              className={styles.addressInput}
              aria-label="Address"
              value={draft}
              placeholder="Type an address or search"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
              // Like any browser: the whole address is selected, ready to replace.
              onFocus={(event) => event.currentTarget.select()}
              onBlur={() => setEditing(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(false);
              }}
            />
          </form>
        ) : (
          <button
            type="button"
            className={styles.address}
            data-lustre=""
            aria-label={tab?.url ? `Address: ${tab.url}. Change it` : 'Type an address'}
            title={tab?.title || undefined}
            onClick={() => typeAddress(tab?.url ?? '')}
          >
            {tab?.url ? (
              secure ? (
                <Lock className={styles.addressIcon} aria-hidden />
              ) : (
                <Globe className={styles.addressIcon} aria-hidden />
              )
            ) : (
              <Globe className={styles.addressIcon} aria-hidden />
            )}
            {tab?.url ? (
              <span className={styles.addressText}>
                <span className={styles.host}>{host}</span>
                <span className={styles.path}>{rest}</span>
              </span>
            ) : (
              <span className={styles.addressPlaceholder}>Type an address or search</span>
            )}
          </button>
        )}

        <div className={styles.tools}>
          {tab?.backend && <WhereItRuns backend={tab.backend} />}
          {control === 'agent' && (
            <span className={styles.driver} role="status">
              <Pearl size="xs" state="thinking" label={null} />
              <span className={styles.driverText}>{name} is browsing</span>
            </span>
          )}
          {driving ? (
            <Button
              id={`${hintId}-handback`}
              size="sm"
              variant={handoff ? 'solid' : 'soft'}
              leadingIcon={<Hand />}
              onClick={onHandBack}
            >
              {handoff ? 'I’m done' : 'Hand back'}
            </Button>
          ) : (
            tab?.url && (
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<MousePointerClick />}
                onClick={onTakeOver}
              >
                Take over
              </Button>
            )
          )}
          {actions}
          {onClose && (
            <IconButton size="sm" variant="ghost" label="Close the browser panel" onClick={onClose}>
              <X />
            </IconButton>
          )}
        </div>
        <span className={styles.loading} data-on={tab?.loading ? '' : undefined} aria-hidden />
      </header>

      {handoff && (
        <div className={styles.handoffBar} role="status">
          <Pearl size="sm" state="streaming" label={null} />
          <div className={styles.handoffText}>
            <strong>Your turn</strong>
            <span>{handoff.reason}</span>
          </div>
        </div>
      )}

      <div ref={stage} className={styles.stage}>
        <div
          ref={screen}
          className={styles.screen}
          style={
            {
              aspectRatio: `${viewport.width} / ${viewport.height}`,
              '--bw-ratio': viewport.width / viewport.height,
            } as CSSProperties
          }
          data-driving={driving ? '' : undefined}
        >
          <button
            type="button"
            className={styles.surface}
            aria-label={
              driving
                ? `Page${tab?.title ? `: ${tab.title}` : ''}`
                : `Take over the page${tab?.title ? `: ${tab.title}` : ''}`
            }
            aria-describedby={hintId}
            disabled={!tab?.url}
            onClick={() => {
              // Enter or Space on the picture takes the wheel too.
              if (!driving) onTakeOver?.();
            }}
            onPointerDown={(event) => pointer('down', event)}
            onPointerUp={(event) => pointer('up', event)}
            onPointerMove={(event) => pointer('move', event)}
            onWheel={onWheel}
            onContextMenu={(event) => {
              if (driving) event.preventDefault();
            }}
          >
            <img
              ref={screenRef}
              src={frame}
              alt=""
              draggable={false}
              className={styles.frame}
              data-empty={empty ? '' : undefined}
              onLoad={() => setHasFrame(true)}
            />
          </button>
          <textarea
            ref={keys}
            className={styles.keys}
            aria-label="Type into the page"
            aria-describedby={hintId}
            tabIndex={driving ? 0 : -1}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value=""
            onChange={() => undefined}
            onKeyDown={(event) => key('down', event)}
            onKeyUp={(event) => key('up', event)}
            onPaste={onPaste}
            onCompositionEnd={(event) => {
              if (driving && event.data) send({ type: 'text', text: event.data });
            }}
            onInput={(event) => {
              // Phone keyboards type without key events: pass the text on as text.
              const native = event.nativeEvent as InputEvent;
              if (driving && native.data && !native.isComposing)
                send({ type: 'text', text: native.data });
            }}
          />
          {empty && (
            <ScreenMessage
              phase={phase}
              install={install}
              problem={problem}
              name={name}
              onType={() => typeAddress('')}
            />
          )}
          {!empty && phase === 'problem' && problem && (
            <div className={styles.problemBar} role="alert">
              <TriangleAlert aria-hidden />
              <span>{problem.message}</span>
              {problem.onAction && problem.actionLabel && (
                <Button size="sm" variant="soft" onClick={problem.onAction}>
                  {problem.actionLabel}
                </Button>
              )}
            </div>
          )}
          {box && (
            <span
              key={`box-${caption?.key}`}
              className={styles.highlight}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
              aria-hidden
            />
          )}
          <span
            className={styles.cursor}
            // Shown only while pointing at something on this page; it fades where it was.
            data-visible={box && !driving ? '' : undefined}
            data-action={caption?.action}
            style={
              action?.box
                ? {
                    left: `${(action.box.x + action.box.width / 2) * 100}%`,
                    top: `${(action.box.y + action.box.height / 2) * 100}%`,
                  }
                : undefined
            }
            aria-hidden
          >
            <span key={`ripple-${caption?.key}`} className={styles.ripple} />
          </span>
          {caption && !driving && (
            <span key={`caption-${caption.key}`} className={styles.caption} aria-live="polite">
              <span className={styles.captionDots} aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {caption.label}
            </span>
          )}
          {!driving && tab?.url && control !== 'agent' && (
            <span className={styles.takeHint} aria-hidden>
              <MousePointerClick /> Click to take over
            </span>
          )}
        </div>
        <p id={hintId} className="nc-visually-hidden">
          {driving
            ? 'You’re driving: mouse and keyboard go to the page. Press Shift+Escape to leave the page.'
            : 'Take over to use the page with your mouse and keyboard.'}
        </p>
      </div>
    </section>
  );
}

const WHERE: Record<NonNullable<BrowserWindowTab['backend']>, string> = {
  chrome: 'In your Chrome',
  browserbase: 'In the cloud',
  steel: 'In the cloud',
  cdp: 'On another browser',
};

/** Where the page really is, when it isn't the assistant's own browser here. */
function WhereItRuns({ backend }: { backend: NonNullable<BrowserWindowTab['backend']> }) {
  const Icon = backend === 'chrome' ? AppWindowMac : Cloud;
  return (
    <span className={styles.where} data-backend={backend}>
      <Icon aria-hidden />
      {WHERE[backend]}
    </span>
  );
}

function titleOf(entry: BrowserWindowTabEntry): string {
  if (entry.title) return entry.title;
  if (!entry.url) return 'New tab';
  try {
    return new URL(entry.url).host.replace(/^www\./, '');
  } catch {
    return entry.url;
  }
}

/**
 * The chat's tabs, above the toolbar as in any browser: each with its site's
 * icon (a spinner while it loads), the one in view raised. Middle-click or ✕
 * closes one; a right-click has the rest; double-click the empty strip for a
 * new tab.
 */
function TabStrip({
  tabs,
  onTab,
  onNew,
  onReload,
}: {
  tabs: BrowserWindowTabEntry[];
  onTab?: BrowserWindowProps['onTab'];
  onNew?: () => void;
  onReload?: () => void;
}) {
  const several = tabs.length > 1;
  const strip = useRef<HTMLElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  // Double-click the empty strip for a new tab: a mouse shortcut for + and ⌘T.
  useEffect(() => {
    const nav = strip.current;
    if (!nav || !onNew) return;
    const onDoubleClick = (event: MouseEvent) => {
      if (event.target === nav || event.target === list.current) onNew();
    };
    nav.addEventListener('dblclick', onDoubleClick);
    return () => nav.removeEventListener('dblclick', onDoubleClick);
  }, [onNew]);
  return (
    <nav ref={strip} aria-label="Tabs" className={styles.tabs}>
      <ul ref={list} className={styles.tabList}>
        {tabs.map((entry) => {
          const title = titleOf(entry);
          return (
            <ContextMenu.Root key={entry.id || 'only'}>
              <ContextMenu.Trigger asChild disabled={!onTab || !entry.id}>
                <li
                  className={styles.tab}
                  data-active={entry.active ? '' : undefined}
                  data-alone={several ? undefined : ''}
                >
                  <button
                    type="button"
                    className={styles.tabButton}
                    aria-current={entry.active ? 'page' : undefined}
                    title={entry.url ? `${title}\n${entry.url}` : title}
                    onClick={() => {
                      if (!entry.active && entry.id) onTab?.('switch', entry.id);
                    }}
                    onAuxClick={(event) => {
                      // The middle button closes a tab, as in every browser.
                      if (event.button === 1 && several && entry.id) onTab?.('close', entry.id);
                    }}
                    onMouseDown={(event) => {
                      // …and doesn't start scrolling.
                      if (event.button === 1) event.preventDefault();
                    }}
                  >
                    <TabIcon entry={entry} />
                    <span className={styles.tabTitle}>{title}</span>
                  </button>
                  {several && entry.id && onTab && (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Close tab: ${title}`}
                      className={styles.tabClose}
                      onClick={() => onTab('close', entry.id)}
                    >
                      <X />
                    </IconButton>
                  )}
                </li>
              </ContextMenu.Trigger>
              <ContextMenu.Content>
                {onReload && entry.active && (
                  <ContextMenu.Item icon={<RotateCw />} onSelect={onReload}>
                    Reload
                  </ContextMenu.Item>
                )}
                <ContextMenu.Item icon={<Plus />} shortcut="mod+t" onSelect={() => onNew?.()}>
                  New tab
                </ContextMenu.Item>
                <ContextMenu.Item
                  icon={<RotateCcw />}
                  shortcut="mod+shift+t"
                  onSelect={() => onTab?.('reopen')}
                >
                  Reopen closed tab
                </ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Item
                  icon={<X />}
                  shortcut="mod+w"
                  disabled={!several}
                  onSelect={() => onTab?.('close', entry.id)}
                >
                  Close tab
                </ContextMenu.Item>
                <ContextMenu.Item disabled={!several} onSelect={() => onTab?.('others', entry.id)}>
                  Close other tabs
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Root>
          );
        })}
      </ul>
      {onNew && (
        <IconButton
          size="sm"
          variant="ghost"
          label="New tab"
          className={styles.newTab}
          onClick={onNew}
        >
          <Plus />
        </IconButton>
      )}
    </nav>
  );
}

/** A tab's site icon; a spinner while it loads; a globe until the site has one. */
function TabIcon({ entry }: { entry: BrowserWindowTabEntry }) {
  const [broken, setBroken] = useState<string>();
  if (entry.loading) return <Spinner size="xs" label={null} className={styles.tabIcon} />;
  if (entry.icon && broken !== entry.icon)
    return (
      <img
        src={entry.icon}
        alt=""
        className={styles.tabIcon}
        draggable={false}
        onError={() => setBroken(entry.icon)}
      />
    );
  return <Globe aria-hidden className={styles.tabIcon} />;
}

function ScreenMessage({
  phase,
  install,
  problem,
  name,
  onType,
}: {
  phase: BrowserWindowPhase;
  install?: { percent: number; label: string };
  problem?: BrowserWindowProps['problem'];
  name: string;
  onType: () => void;
}) {
  if (phase === 'installing') {
    return (
      <div className={styles.message}>
        <Pearl size="md" state="thinking" label={null} />
        <p className={styles.messageTitle}>Getting a browser ready</p>
        <Progress
          value={install?.percent ?? null}
          label={install?.label ?? 'Downloading Chromium'}
          className={styles.messageProgress}
        />
        <p className={styles.messageHint}>This happens once. Nothing for you to do.</p>
      </div>
    );
  }
  if (phase === 'starting' || phase === 'connecting' || phase === 'restoring') {
    return (
      <div className={styles.message} aria-busy="true">
        <Pearl size="md" state="thinking" label={null} />
        <p className={styles.messageTitle}>
          {phase === 'restoring'
            ? 'Opening your tabs…'
            : phase === 'starting'
              ? 'Starting the browser…'
              : 'Connecting…'}
        </p>
      </div>
    );
  }
  if (phase === 'problem' && problem) {
    return (
      <div className={styles.message} role="alert">
        <Pearl size="md" state="error" label={null} />
        <p className={styles.messageTitle}>The browser needs a hand</p>
        <p className={styles.messageHint}>{problem.message}</p>
        {problem.command && <code className={styles.command}>{problem.command}</code>}
        {problem.onAction && problem.actionLabel && (
          <Button size="sm" onClick={problem.onAction}>
            {problem.actionLabel}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className={styles.message}>
      <Pearl size="md" state="idle" label={null} />
      <p className={styles.messageTitle}>Nothing open yet</p>
      <p className={styles.messageHint}>
        When {name} browses, you’ll watch it here, and you can take over any time.
      </p>
      <Button size="sm" variant="soft" leadingIcon={<Globe />} onClick={onType}>
        Open a page yourself
      </Button>
    </div>
  );
}
