import { ChevronDown, Maximize2, Minimize2, Plus, SquareTerminal, X } from 'lucide-react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import styles from './Terminal.module.css';

export interface TerminalTab {
  id: string;
  title: string;
  status: 'connecting' | 'running' | 'exited' | 'problem';
  /** New output while this tab wasn't the one in view. */
  activity?: boolean;
}

export interface TerminalPanelProps extends Omit<
  ComponentProps<'section'>,
  'children' | 'onSelect'
> {
  tabs: TerminalTab[];
  active?: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Open another terminal (with your usual shell). */
  onNew: () => void;
  /** A menu of other shells, beside +. */
  newMenu?: ReactNode;
  onHide: () => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  /** Extra toolbar actions (search, ask…). */
  actions?: ReactNode;
  /** The body for each tab; every tab stays mounted so its screen survives switching. */
  children: (tabId: string) => ReactNode;
  /** Shown when there are no tabs. */
  empty?: ReactNode;
  /** A row of keys for touch screens. */
  keys?: ReactNode;
}

/**
 * The terminal drawer: tabs for your shells, the screen, and the few
 * controls you reach for. It surfaces from the bottom of whatever you're
 * doing, and every shell keeps running while it's closed.
 */
export function TerminalPanel({
  tabs,
  active,
  onSelect,
  onClose,
  onNew,
  newMenu,
  onHide,
  maximized = false,
  onToggleMaximize,
  actions,
  children,
  empty,
  keys,
  className,
  ...props
}: TerminalPanelProps) {
  return (
    <section
      aria-label="Terminal"
      className={cx(styles.panel, className)}
      data-maximized={maximized || undefined}
      {...props}
    >
      <TabsPrimitive.Root
        value={active ?? ''}
        onValueChange={onSelect}
        activationMode="automatic"
        className={styles.tabsRoot}
      >
        <header className={styles.bar}>
          <TabsPrimitive.List className={styles.tabs} aria-label="Terminals" loop>
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={styles.tab}
                data-status={tab.status}
                data-active={tab.id === active || undefined}
              >
                <TabsPrimitive.Trigger
                  value={tab.id}
                  className={styles.tabTrigger}
                  aria-keyshortcuts="Delete"
                  onKeyDown={(event) => {
                    if (event.key === 'Delete') {
                      event.preventDefault();
                      onClose(tab.id);
                    }
                  }}
                >
                  <span className={styles.tabIcon} aria-hidden>
                    {tab.status === 'connecting' ? (
                      <Pearl size="xs" state="thinking" label={null} />
                    ) : (
                      <SquareTerminal />
                    )}
                  </span>
                  <span className={styles.tabTitle}>{tab.title}</span>
                  {tab.activity && tab.id !== active && (
                    <span className={styles.activity}>
                      <span className="nc-visually-hidden">, new output</span>
                    </span>
                  )}
                  {tab.status === 'exited' && <span className={styles.tabEnded}>ended</span>}
                </TabsPrimitive.Trigger>
                {/* A pointer shortcut: a tab list may only hold tabs, so keyboards and
                    screen readers close with Delete or "Close this terminal". */}
                <button
                  type="button"
                  className={styles.tabClose}
                  tabIndex={-1}
                  aria-hidden
                  title={`Close ${tab.title}`}
                  onClick={() => onClose(tab.id)}
                >
                  <X aria-hidden />
                </button>
              </div>
            ))}
          </TabsPrimitive.List>
          <div className={styles.new}>
            <IconButton
              size="sm"
              variant="ghost"
              label="New terminal"
              shortcut="mod+shift+`"
              onClick={onNew}
            >
              <Plus />
            </IconButton>
            {newMenu}
          </div>
          <div className={styles.barEnd}>
            {actions}
            {active && (
              <IconButton
                size="sm"
                variant="ghost"
                label="Close this terminal"
                onClick={() => onClose(active)}
              >
                <X />
              </IconButton>
            )}
            {onToggleMaximize && (
              <IconButton
                size="sm"
                variant="ghost"
                label={maximized ? 'Restore the terminal' : 'Make the terminal bigger'}
                onClick={onToggleMaximize}
              >
                {maximized ? <Minimize2 /> : <Maximize2 />}
              </IconButton>
            )}
            <IconButton
              size="sm"
              variant="ghost"
              label="Hide the terminal"
              shortcut="mod+`"
              onClick={onHide}
            >
              <ChevronDown />
            </IconButton>
          </div>
        </header>
        <div className={styles.body}>
          {tabs.length === 0
            ? (empty ?? (
                <div className={styles.empty}>
                  <SquareTerminal aria-hidden className={styles.emptyIcon} />
                  <p>No terminals open.</p>
                  <Button size="sm" variant="soft" leadingIcon={<Plus />} onClick={onNew}>
                    Open a terminal
                  </Button>
                </div>
              ))
            : tabs.map((tab) => (
                <TabsPrimitive.Content
                  key={tab.id}
                  value={tab.id}
                  forceMount
                  hidden={tab.id !== active}
                  className={styles.content}
                  // The terminal inside takes focus; the panel itself isn't a stop.
                  tabIndex={-1}
                >
                  {children(tab.id)}
                </TabsPrimitive.Content>
              ))}
        </div>
      </TabsPrimitive.Root>
      {keys}
    </section>
  );
}

export interface TerminalNoticeProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: 'info' | 'ended' | 'problem';
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  /** Show the working pearl (connecting, restoring). */
  busy?: boolean;
}

/** A calm card over the screen: connecting, ended (with Restart), or what's needed. */
export function TerminalNotice({
  tone = 'info',
  title,
  detail,
  actions,
  busy = false,
  className,
  ...props
}: TerminalNoticeProps) {
  return (
    <div
      role={tone === 'problem' ? 'alert' : 'status'}
      className={cx(styles.notice, className)}
      data-tone={tone}
      {...props}
    >
      <div className={styles.noticeCard}>
        {busy && <Pearl size="sm" state="thinking" label={null} />}
        <p className={styles.noticeTitle}>{title}</p>
        {detail && <p className={styles.noticeDetail}>{detail}</p>}
        {actions && <div className={styles.noticeActions}>{actions}</div>}
      </div>
    </div>
  );
}

export interface TerminalKeysProps extends ComponentProps<'div'> {
  /** Send these bytes to the shell. */
  onKey: (sequence: string) => void;
  /** Ctrl is held for the next key. */
  ctrl: boolean;
  onCtrlChange: (on: boolean) => void;
}

const KEYS: { label: string; aria: string; seq: string }[] = [
  { label: 'Esc', aria: 'Escape', seq: '\x1b' },
  { label: 'Tab', aria: 'Tab', seq: '\t' },
  { label: '←', aria: 'Left', seq: '\x1b[D' },
  { label: '↑', aria: 'Up', seq: '\x1b[A' },
  { label: '↓', aria: 'Down', seq: '\x1b[B' },
  { label: '→', aria: 'Right', seq: '\x1b[C' },
  { label: '|', aria: 'Pipe', seq: '|' },
  { label: '~', aria: 'Tilde', seq: '~' },
  { label: '/', aria: 'Slash', seq: '/' },
  { label: '-', aria: 'Dash', seq: '-' },
];

/** The keys phones don't have, for touch screens. Ctrl holds for the next key typed. */
export function TerminalKeys({
  onKey,
  ctrl,
  onCtrlChange,
  className,
  ...props
}: TerminalKeysProps) {
  return (
    <div
      role="toolbar"
      aria-label="Terminal keys"
      className={cx(styles.keys, className)}
      {...props}
    >
      <button
        type="button"
        className={styles.key}
        aria-pressed={ctrl}
        onClick={() => onCtrlChange(!ctrl)}
        // Keep the terminal's keyboard up on phones.
        onPointerDown={(event) => event.preventDefault()}
      >
        Ctrl
      </button>
      {KEYS.map((key) => (
        <button
          key={key.aria}
          type="button"
          className={styles.key}
          aria-label={key.aria}
          onClick={() => onKey(key.seq)}
          onPointerDown={(event) => event.preventDefault()}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}

/** Ctrl + a typed key, as the control character a terminal expects (Ctrl+C → \x03). */
export function withCtrl(data: string): string {
  if (data.length !== 1) return data;
  const code = data.toUpperCase().charCodeAt(0);
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data;
}
