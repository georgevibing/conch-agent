import type { CreateTerminalBody, TerminalInfo, TerminalStatus } from '@conch/protocol';
import {
  Button,
  DropdownMenu,
  FindBar,
  IconButton,
  ResizeHandle,
  TerminalKeys,
  TerminalNotice,
  TerminalPanel,
  TerminalView,
  toast,
  useMediaQuery,
  withCtrl,
  type TerminalTab,
  type TerminalViewHandle,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Search, ShieldOff, Sparkles, SquareTerminal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useUi } from '../../app/ui';
import { useHotkey } from '../../app/useHotkey';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { useAssistantName } from '../integrations/queries';
import { terminalApi } from './api';
import styles from './TerminalDock.module.css';
import { terminalKeys, useTerminalStatus } from './queries';
import { useTerminalSession, type SessionState } from './useTerminalSession';

const MIN_HEIGHT = 160;

/** A tab's name: what the shell calls itself, unless that's just its program path. */
export function tabTitle(info: TerminalInfo): string {
  const title = info.title.trim();
  const folder = info.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? info.cwd;
  if (
    !title ||
    title === info.shell ||
    /\.(exe|com)$/i.test(title) ||
    /^[A-Z]:\\|^\//.test(title)
  ) {
    return folder ? `${info.shell} · ${folder}` : info.shell;
  }
  return title;
}

/**
 * The terminal drawer, on every screen (ADR 0015). Closed, it's nothing at all:
 * the shells keep running on the gateway, and come back exactly as they were.
 */
export function TerminalDock() {
  const open = useUi((s) => s.terminalOpen);
  const toggle = useUi((s) => s.toggleTerminal);
  const newTerminal = useUi((s) => s.newTerminal);
  useHotkey('mod+`', () => toggle());
  useHotkey('mod+shift+`', () => newTerminal());
  return open ? <Drawer /> : null;
}

function Drawer() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const name = useAssistantName();
  const { data: status } = useTerminalStatus();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const height = useUi((s) => s.terminalHeight);
  const setHeight = useUi((s) => s.setTerminalHeight);
  const max = useUi((s) => s.terminalMax);
  const setMax = useUi((s) => s.setTerminalMax);
  const setOpen = useUi((s) => s.setTerminalOpen);
  const active = useUi((s) => s.terminalActive);
  const setActive = useUi((s) => s.setTerminalActive);
  const paste = useUi((s) => s.terminalPaste);
  const pasteInTerminal = useUi((s) => s.pasteInTerminal);
  const asked = useUi((s) => s.terminalNew);
  const setComposerText = useUi((s) => s.setComposerText);
  const narrow = useMediaQuery('(max-width: 820px)');
  const touch = useMediaQuery('(pointer: coarse)');
  const views = useRef(new Map<string, TerminalViewHandle>());
  const [sessionStates, setSessionStates] = useState<Record<string, SessionState['kind']>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState('');
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ index: -1, count: 0 });
  const [ctrl, setCtrl] = useState(false);
  const roomFor = () => Math.max(MIN_HEIGHT + 40, window.innerHeight - 180);
  const [room, setRoom] = useState(roomFor);
  const replaced = useRef(new Set<string>());
  const creating = useRef(false);

  const terminals = status?.terminals ?? [];
  const current = terminals.find((t) => t.id === active) ?? terminals.at(-1);
  const refresh = () => client.invalidateQueries({ queryKey: terminalKeys.status });

  /** Open a terminal (asking "Confirm it's you" when this device needs it). */
  const create = useCallback(
    async (body: CreateTerminalBody = {}, note?: string) => {
      if (creating.current) return undefined;
      creating.current = true;
      let made: TerminalInfo | undefined;
      try {
        await guard(async () => {
          made = await terminalApi.create(body);
        });
      } catch (error) {
        toast.error('Couldn’t open a terminal', {
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        creating.current = false;
      }
      const opened = made as TerminalInfo | undefined;
      if (opened) {
        if (note) setNotes((n) => ({ ...n, [opened.id]: note }));
        setActive(opened.id);
        await refresh();
      }
      return opened;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- guard is stable for our purposes
    [setActive],
  );

  const close = async (id: string) => {
    views.current.delete(id);
    await terminalApi.close(id).catch(() => undefined);
    await refresh();
  };

  // Opening the drawer with nothing in it means "give me a terminal".
  const started = useRef(false);
  useEffect(() => {
    if (!status || started.current) return;
    if (!status.available || status.terminals.length > 0) {
      started.current = true;
      return;
    }
    // Marked when it actually runs, so a refetch in between doesn't cancel it for good.
    const timer = setTimeout(() => {
      started.current = true;
      void create();
    }, 0);
    return () => clearTimeout(timer);
  }, [status, create]);

  const turnOn = async () => {
    try {
      await guard(async () => {
        const next = await terminalApi.updateSettings({ enabled: true });
        // Now it can do what opening the drawer meant: give you a terminal.
        started.current = false;
        client.setQueryData(terminalKeys.status, next);
      });
    } catch (error) {
      toast.error('Couldn’t turn the terminal on', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  // ⌘⇧` (or the + button elsewhere) asks for another one.
  const seenAsk = useRef(asked);
  useEffect(() => {
    if (asked === seenAsk.current) return;
    seenAsk.current = asked;
    const timer = setTimeout(() => void create(), 0);
    return () => clearTimeout(timer);
  }, [asked, create]);

  // "Run in terminal": typed into the terminal in view, never with Enter.
  useEffect(() => {
    if (paste === null) return;
    const target = current && views.current.get(current.id);
    if (!target) {
      if (!status?.available || terminals.length > 0) return;
      const timer = setTimeout(() => void create(), 0);
      return () => clearTimeout(timer);
    }
    target.paste(paste);
    target.focus();
    pasteInTerminal(null);
  }, [paste, current, status, terminals.length, create, pasteInTerminal]);

  // Room to grow into: most of the main area, keeping some of the page above.
  useEffect(() => {
    const onResize = () => setRoom(roomFor());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const restart = async (info: TerminalInfo, safeMode: boolean) => {
    const shell = status?.shells.find((s) => s.name === info.shell)?.id;
    const made = await create({ shell, cwd: info.cwd, safeMode });
    if (made) await close(info.id);
  };

  // A terminal that vanished (Conch restarted) is replaced by a fresh one in the same place.
  const replace = async (info: TerminalInfo) => {
    if (replaced.current.has(info.id)) return;
    replaced.current.add(info.id);
    const shell = status?.shells.find((s) => s.name === info.shell)?.id;
    await create(
      { shell, cwd: info.cwd },
      'Conch restarted, so this is a fresh terminal in the same folder.',
    );
    await refresh();
  };

  const ask = () => {
    const text = selection.trim();
    if (!text) return;
    setComposerText(`About this output from my terminal:\n\n\`\`\`\n${text}\n\`\`\`\n\n`);
    if (!conversationId) void navigate('/');
  };

  const tabs: TerminalTab[] = terminals.map((info) => ({
    id: info.id,
    title: titles[info.id] ?? tabTitle(info),
    status:
      info.status === 'exited' || sessionStates[info.id] === 'exited'
        ? 'exited'
        : sessionStates[info.id] === 'connecting'
          ? 'connecting'
          : sessionStates[info.id] === 'denied'
            ? 'problem'
            : 'running',
    activity: activity[info.id],
  }));

  const size = max
    ? undefined
    : Math.min(room, Math.max(MIN_HEIGHT, narrow ? Math.max(height, 320) : height));

  const unavailable = status && !status.available;

  return (
    <div
      className={styles.dock}
      data-max={max || undefined}
      style={size ? { blockSize: size } : undefined}
    >
      {!max && (
        <ResizeHandle
          axis="y"
          label="Resize the terminal"
          value={size ?? height}
          min={MIN_HEIGHT}
          max={room}
          onValueChange={setHeight}
          className={styles.handle}
        />
      )}
      <TerminalPanel
        tabs={tabs}
        active={current?.id}
        onSelect={(id) => {
          setActive(id);
          setActivity((a) => ({ ...a, [id]: false }));
          requestAnimationFrame(() => views.current.get(id)?.focus());
        }}
        onClose={(id) => void close(id)}
        onNew={() => void create()}
        newMenu={
          status?.available ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton size="sm" variant="ghost" label="More ways to open a terminal">
                  <ChevronDown />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start">
                {status.shells.map((shell) => (
                  <DropdownMenu.Item
                    key={shell.id}
                    icon={<SquareTerminal />}
                    onSelect={() => void create({ shell: shell.id })}
                  >
                    {shell.name}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  icon={<ShieldOff />}
                  onSelect={() => void create({ safeMode: true })}
                >
                  Without your shell profile
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          ) : undefined
        }
        onHide={() => setOpen(false)}
        maximized={max}
        onToggleMaximize={() => setMax(!max)}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Sparkles />}
              disabled={!selection.trim()}
              onClick={ask}
              title={selection.trim() ? undefined : 'Select some output first'}
            >
              Ask {name}
            </Button>
            <IconButton
              size="sm"
              variant="ghost"
              label="Find in terminal"
              aria-pressed={finding}
              onClick={() => setFinding((f) => !f)}
            >
              <Search />
            </IconButton>
          </>
        }
        empty={
          unavailable ? (
            <TerminalNotice
              tone="problem"
              title={
                status.settings.enabled
                  ? 'Terminals only open on the computer Conch runs on'
                  : 'The terminal is turned off'
              }
              detail={
                status.settings.enabled
                  ? status.unavailable
                  : status.remote
                    ? 'You can turn it on in Settings, and let your other devices in there too.'
                    : 'Turn it on to open real shells on this computer, right here.'
              }
              actions={
                <>
                  <Button
                    size="sm"
                    variant={status.settings.enabled || status.remote ? 'solid' : 'ghost'}
                    onClick={() => useUi.getState().openSettings('terminal')}
                  >
                    Open settings
                  </Button>
                  {/* Off on this very computer: one click turns it back on. */}
                  {!status.settings.enabled && !status.remote && (
                    <Button size="sm" onClick={() => void turnOn()}>
                      Turn it on
                    </Button>
                  )}
                </>
              }
            />
          ) : undefined
        }
        keys={
          touch ? (
            <TerminalKeys
              ctrl={ctrl}
              onCtrlChange={setCtrl}
              onKey={(seq) => {
                const view = current && views.current.get(current.id);
                if (!view) return;
                // Keys from the row go straight to the shell.
                view.focus();
                window.dispatchEvent(new CustomEvent('conch:terminal-key', { detail: seq }));
              }}
            />
          ) : undefined
        }
      >
        {(id) => {
          const info = terminals.find((t) => t.id === id);
          if (!info) return null;
          return (
            <Screen
              info={info}
              note={notes[id]}
              visible={id === current?.id}
              ctrl={ctrl}
              onCtrlUsed={() => setCtrl(false)}
              settings={status?.settings}
              register={(handle) => {
                if (handle) views.current.set(id, handle);
                else views.current.delete(id);
              }}
              ticket={async (terminalId) => {
                let ticket: Awaited<ReturnType<typeof terminalApi.ticket>> | undefined;
                const ok = await guard(async () => {
                  ticket = await terminalApi.ticket(terminalId);
                });
                return ok ? ticket : undefined;
              }}
              onState={(state) =>
                // Only when it changed: this runs after every render of the view.
                setSessionStates((s) => (s[id] === state.kind ? s : { ...s, [id]: state.kind }))
              }
              onTitle={(title) => setTitles((t) => ({ ...t, [id]: tabTitle({ ...info, title }) }))}
              onOutput={() => {
                if (id !== current?.id) setActivity((a) => (a[id] ? a : { ...a, [id]: true }));
              }}
              onSelection={setSelection}
              onSearchResults={setResults}
              onRestart={(safeMode) => void restart(info, safeMode)}
              onClose={() => void close(id)}
              onGone={() => void replace(info)}
              onLeave={() =>
                document.querySelector<HTMLElement>('textarea[aria-label^="Message"]')?.focus()
              }
            />
          );
        }}
      </TerminalPanel>
      {finding && current && (
        <div className={styles.find}>
          <FindBar
            query={query}
            onQueryChange={(q) => {
              setQuery(q);
              if (q) views.current.get(current.id)?.findNext(q);
              else views.current.get(current.id)?.clearSearch();
            }}
            count={results.count}
            current={results.index}
            onNext={() => views.current.get(current.id)?.findNext(query)}
            onPrev={() => views.current.get(current.id)?.findPrevious(query)}
            onClose={() => {
              setFinding(false);
              views.current.get(current.id)?.clearSearch();
              views.current.get(current.id)?.focus();
            }}
            label="Find in terminal"
            placeholder="Find in terminal"
            focusKey={current.id}
          />
        </div>
      )}
      {dialog}
    </div>
  );
}

function Screen({
  info,
  note,
  visible,
  ctrl,
  onCtrlUsed,
  settings,
  register,
  ticket,
  onState,
  onTitle,
  onOutput,
  onSelection,
  onSearchResults,
  onRestart,
  onClose,
  onGone,
  onLeave,
}: {
  info: TerminalInfo;
  note?: string;
  visible: boolean;
  ctrl: boolean;
  onCtrlUsed: () => void;
  settings?: TerminalStatus['settings'];
  register: (handle: TerminalViewHandle | null) => void;
  ticket: Parameters<typeof useTerminalSession>[2]['ticket'];
  onState: (state: SessionState) => void;
  onTitle: (title: string) => void;
  onOutput: () => void;
  onSelection: (text: string) => void;
  onSearchResults: (results: { index: number; count: number }) => void;
  onRestart: (safeMode: boolean) => void;
  onClose: () => void;
  onGone: () => void;
  onLeave: () => void;
}) {
  const view = useRef<TerminalViewHandle | null>(null);
  const [latest, setLatest] = useState(info);
  const session = useTerminalSession(info.id, view, {
    ticket,
    onInfo: setLatest,
    onTitle,
    onOutput,
    note,
  });
  const { state } = session;

  useEffect(() => onState(state), [state, onState]);
  useEffect(() => {
    if (state.kind === 'gone') onGone();
  }, [state.kind, onGone]);
  useEffect(() => {
    if (visible && state.kind === 'running') requestAnimationFrame(() => view.current?.focus());
  }, [visible, state.kind]);

  // Keys from the touch row.
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: Event) => session.input((event as CustomEvent<string>).detail);
    window.addEventListener('conch:terminal-key', onKey);
    return () => window.removeEventListener('conch:terminal-key', onKey);
  }, [visible, session]);

  return (
    <>
      <TerminalView
        ref={(handle) => {
          view.current = handle;
          register(handle);
        }}
        label={`Terminal: ${tabTitle(latest)}`}
        fontSize={settings?.fontSize}
        cursorBlink={settings?.cursorBlink}
        screenReader={settings?.screenReader}
        onInput={(data) => {
          if (ctrl) {
            session.input(withCtrl(data));
            onCtrlUsed();
          } else {
            session.input(data);
          }
        }}
        onResize={session.resize}
        onSelectionChange={visible ? onSelection : undefined}
        onSearchResults={visible ? onSearchResults : undefined}
        onLeave={onLeave}
        onAppKey={(event) => {
          // ⌘` / Ctrl+` hides the drawer and ⌘⇧` opens another: those keys are the app's.
          const mod = event.ctrlKey || event.metaKey;
          return mod && (event.key === '`' || event.code === 'Backquote');
        }}
      />
      {state.kind === 'connecting' && (
        <TerminalNotice busy title="Connecting…" detail="Your shell keeps running meanwhile." />
      )}
      {state.kind === 'exited' && (
        <TerminalNotice
          tone="ended"
          title={
            latest.endedEarly
              ? `The shell stopped right away (code ${state.code})`
              : state.code === 0
                ? 'The shell ended'
                : `The shell ended (code ${state.code})`
          }
          detail={
            latest.endedEarly && !latest.safeMode
              ? 'That usually means something in your shell profile failed. Start without it, and fix it from there.'
              : undefined
          }
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button
                size="sm"
                variant={latest.endedEarly && !latest.safeMode ? 'surface' : 'solid'}
                onClick={() => onRestart(false)}
              >
                Restart
              </Button>
              {latest.endedEarly && !latest.safeMode && (
                <Button size="sm" onClick={() => onRestart(true)}>
                  Start without your profile
                </Button>
              )}
            </>
          }
        />
      )}
      {state.kind === 'denied' && (
        <TerminalNotice
          tone="problem"
          title={
            state.code === 'verify-required'
              ? 'Confirm it’s you'
              : 'This terminal isn’t available here'
          }
          detail={state.message}
          actions={
            state.code === 'terminal-remote-off' || state.code === 'terminal-off' ? (
              <Button size="sm" onClick={() => useUi.getState().openSettings('terminal')}>
                Open settings
              </Button>
            ) : undefined
          }
        />
      )}
    </>
  );
}
