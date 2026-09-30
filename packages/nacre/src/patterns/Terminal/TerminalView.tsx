import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import type { Terminal } from '@xterm/xterm';
import { useEffect, useImperativeHandle, useRef, type ComponentProps, type Ref } from 'react';

import { cx } from '../../utils/cx';
import { terminalColors, terminalFont } from './theme';
import styles from './Terminal.module.css';

export interface TerminalSearchResults {
  index: number;
  count: number;
}

/** What the app can do with a terminal view. */
export interface TerminalViewHandle {
  /** Output from the shell. Safe to call before xterm has loaded (it's queued). */
  write(data: Uint8Array | string): void;
  /** Clear everything (before replaying scrollback). */
  reset(): void;
  focus(): void;
  /** Type text as if pasted (bracketed paste, so shells don't run it early). */
  paste(text: string): void;
  selection(): string;
  findNext(query: string): void;
  findPrevious(query: string): void;
  clearSearch(): void;
  /** Columns and rows, once measured. */
  size(): { cols: number; rows: number } | undefined;
}

export interface TerminalViewProps extends Omit<
  ComponentProps<'div'>,
  'onResize' | 'ref' | 'onInput' | 'onSelect'
> {
  ref?: Ref<TerminalViewHandle>;
  /** Accessible name, e.g. "Terminal: zsh". */
  label?: string;
  fontSize?: number;
  cursorBlink?: boolean;
  /** Make output readable to screen readers (slower on busy output). */
  screenReader?: boolean;
  /** Keys you typed, for the shell. */
  onInput?: (data: string) => void;
  onResize?: (size: { cols: number; rows: number }) => void;
  onTitle?: (title: string) => void;
  onSelectionChange?: (text: string) => void;
  onSearchResults?: (results: TerminalSearchResults) => void;
  /** Keys the app wants for itself (return true to keep them from the shell), e.g. Ctrl+`. */
  onAppKey?: (event: KeyboardEvent) => boolean;
  /** Shift+Escape: the way out of the terminal for the keyboard. */
  onLeave?: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * A terminal screen in Nacre's colours (xterm.js). It loads xterm on first
 * use, so nothing weighs on the app until a terminal opens; renders on the GPU
 * where it can and falls back quietly where it can't; follows light and dark;
 * and fits whatever space it's given.
 */
export function TerminalView({
  ref,
  label = 'Terminal',
  fontSize = 13,
  cursorBlink = true,
  screenReader = false,
  onInput,
  onResize,
  onTitle,
  onSelectionChange,
  onSearchResults,
  onAppKey,
  onLeave,
  className,
  ...props
}: TerminalViewProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const queue = useRef<(Uint8Array | string)[]>([]);
  // The latest callbacks, without re-creating the terminal when they change.
  const handlers = useRef({
    onInput,
    onResize,
    onTitle,
    onSelectionChange,
    onSearchResults,
    onAppKey,
    onLeave,
  });
  useEffect(() => {
    handlers.current = {
      onInput,
      onResize,
      onTitle,
      onSelectionChange,
      onSearchResults,
      onAppKey,
      onLeave,
    };
  });

  useImperativeHandle(ref, () => ({
    write: (data) => {
      if (term.current) term.current.write(data);
      else queue.current.push(data);
    },
    reset: () => {
      queue.current = [];
      term.current?.reset();
    },
    focus: () => term.current?.focus(),
    paste: (text) => term.current?.paste(text),
    selection: () => term.current?.getSelection() ?? '',
    findNext: (query) =>
      void search.current?.findNext(query, { decorations: searchLook(host.current) }),
    findPrevious: (query) =>
      void search.current?.findPrevious(query, { decorations: searchLook(host.current) }),
    clearSearch: () => search.current?.clearDecorations(),
    size: () => (term.current ? { cols: term.current.cols, rows: term.current.rows } : undefined),
  }));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];

    void (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }, { SearchAddon }, { Unicode11Addon }] =
        await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-web-links'),
          import('@xterm/addon-search'),
          import('@xterm/addon-unicode11'),
          import('@xterm/xterm/css/xterm.css'),
        ]);
      if (disposed) return;
      const terminal = new Terminal({
        fontFamily: terminalFont(el),
        fontSize,
        lineHeight: 1.2,
        cursorBlink,
        cursorStyle: 'bar',
        cursorWidth: 2,
        scrollback: 10_000,
        allowProposedApi: true,
        screenReaderMode: screenReader,
        macOptionIsMeta: true,
        rightClickSelectsWord: true,
        theme: terminalColors(el),
      });
      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);
      terminal.loadAddon(new Unicode11Addon());
      terminal.unicode.activeVersion = '11';
      terminal.loadAddon(
        new WebLinksAddon((_event, uri) => {
          if (/^https?:\/\//i.test(uri)) window.open(uri, '_blank', 'noopener,noreferrer');
        }),
      );
      terminal.open(el);
      term.current = terminal;
      fit.current = fitAddon;
      search.current = searchAddon;

      // The GPU renderer where it works; the DOM one (still crisp) where it doesn't.
      let gpu: { dispose(): void } | undefined;
      const toDom = () => {
        gpu?.dispose();
        gpu = undefined;
      };
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl');
        if (!disposed) {
          const webgl = new WebglAddon();
          webgl.onContextLoss(toDom);
          terminal.loadAddon(webgl);
          gpu = webgl;
        }
      } catch {
        // Stays on the DOM renderer.
      }
      // Some browsers (and zoom/emulation setups) size the GPU canvas in CSS
      // pixels on high-density screens, which shows the text at twice its size.
      // Caught, it quietly switches to the DOM renderer.
      const checkGpu = () => {
        if (!gpu || disposed) return;
        const canvas = el.querySelector<HTMLCanvasElement>(
          '.xterm-screen canvas:not(.xterm-link-layer)',
        );
        const width = canvas?.getBoundingClientRect().width ?? 0;
        if (!canvas || width < 1) return;
        const expected = width * window.devicePixelRatio;
        if (Math.abs(canvas.width - expected) > Math.max(2, expected * 0.05)) toDom();
      };

      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true;
        if (event.key === 'Escape' && event.shiftKey) {
          handlers.current.onLeave?.();
          return false;
        }
        if (handlers.current.onAppKey?.(event)) return false;
        const mod = isMac ? event.metaKey : event.ctrlKey;
        // Ctrl+C copies when something is selected (and interrupts when not).
        if (mod && event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
          void navigator.clipboard?.writeText(terminal.getSelection()).catch(() => undefined);
          terminal.clearSelection();
          return false;
        }
        // Ctrl+V pastes (the browser's paste reaches xterm's own handler).
        if (!isMac && event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'v')
          return false;
        return true;
      });
      const subs = [
        terminal.onData((data) => handlers.current.onInput?.(data)),
        terminal.onResize((size) => handlers.current.onResize?.(size)),
        terminal.onTitleChange((title) => handlers.current.onTitle?.(title)),
        terminal.onSelectionChange(() =>
          handlers.current.onSelectionChange?.(terminal.getSelection()),
        ),
        searchAddon.onDidChangeResults(({ resultIndex, resultCount }) =>
          handlers.current.onSearchResults?.({ index: resultIndex, count: resultCount }),
        ),
      ];
      cleanups.push(() => subs.forEach((s) => s.dispose()));

      for (const data of queue.current) terminal.write(data);
      queue.current = [];

      // Fit now, again once the font has loaded (its metrics change), and on every resize.
      const refit = () => {
        try {
          fitAddon.fit();
        } catch {
          // Hidden or zero-sized for a moment.
        }
        // The GPU canvas settles a frame or two after a resize.
        setTimeout(checkGpu, 250);
      };
      refit();
      handlers.current.onResize?.({ cols: terminal.cols, rows: terminal.rows });
      void document.fonts?.ready.then(() => {
        if (disposed) return;
        terminal.options.fontFamily = terminalFont(el);
        refit();
      });
      let frame = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(refit);
      });
      observer.observe(el);
      cleanups.push(() => observer.disconnect());

      // Light, dark or a new accent: repaint in the new colours.
      const retheme = () => {
        if (!disposed) terminal.options.theme = terminalColors(el);
      };
      const scope = el.closest('[data-nacre-mode]') ?? document.documentElement;
      const mutations = new MutationObserver(retheme);
      mutations.observe(scope, { attributes: true });
      const media = window.matchMedia?.('(prefers-color-scheme: dark)');
      media?.addEventListener('change', retheme);
      cleanups.push(() => {
        mutations.disconnect();
        media?.removeEventListener('change', retheme);
      });
      cleanups.push(() => terminal.dispose());
    })();

    return () => {
      disposed = true;
      for (const cleanup of cleanups.reverse()) cleanup();
      term.current = null;
      fit.current = null;
      search.current = null;
    };
    // The terminal is created once; options below update it in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const terminal = term.current;
    if (!terminal) return;
    terminal.options.fontSize = fontSize;
    terminal.options.cursorBlink = cursorBlink;
    terminal.options.screenReaderMode = screenReader;
    try {
      fit.current?.fit();
    } catch {
      // Not laid out yet.
    }
  }, [fontSize, cursorBlink, screenReader]);

  // Padding lives on the outer box: xterm measures the box it opens in.
  return (
    <div role="group" aria-label={label} className={cx(styles.view, className)} {...props}>
      <div ref={host} className={styles.screen} />
    </div>
  );
}

/** Search highlights in the theme's accent. */
function searchLook(el: HTMLElement | null) {
  const colors = el ? terminalColors(el) : undefined;
  return {
    matchBackground: colors?.selectionBackground ?? '#888888',
    activeMatchBackground: colors?.cursor ?? '#ff8800',
    matchOverviewRuler: colors?.selectionBackground ?? '#888888',
    activeMatchColorOverviewRuler: colors?.cursor ?? '#ff8800',
  };
}
